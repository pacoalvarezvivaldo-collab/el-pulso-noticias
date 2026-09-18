#!/usr/bin/env python3
"""Pipeline de El Pulso Noticias: RSS -> reescritura con IA -> news.json.

Uso local:
    pip install -r pipeline/requirements.txt
    echo "OPENAI_API_KEY=sk-..." > .env
    python pipeline/fetch_news.py

En GitHub Actions, OPENAI_API_KEY se toma del Secret del repo (ver
.github/workflows/update_news.yml), no del .env.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import feedparser
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from openai import OpenAI

sys.path.insert(0, str(Path(__file__).parent.parent))
from pipeline.editor_ia import make_openai_caller, rewrite_entry_with_ai
from pipeline.noticias import (
    build_nota,
    filter_new_entries,
    limpiar_texto_vallarta,
    parse_entries_from_parsed,
    resumen_de_cuerpo,
    trim_historial,
    trim_news,
)

RAIZ = Path(__file__).parent.parent
HISTORIAL_PATH = RAIZ / "historial.json"
NEWS_PATH = RAIZ / "news.json"

# Varios sitios (sobre todo YouTube) bloquean o responden distinto a clientes
# sin User-Agent de navegador — feedparser por sí solo no manda uno útil.
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ElPulsoNoticiasBot/1.0"

FEEDS = [
    {"url": "https://www.eluniversal.com.mx/arc/outboundfeeds/rss/", "fuente": "El Universal", "categoria": "nacional"},
    {"url": "https://www.reforma.com/rss/portada.xml", "fuente": "Reforma", "categoria": "nacional"},
    {"url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC-FVhfqCwhzpJ4DTJOMMofA", "fuente": "Latinus", "categoria": "nacional"},
    {"url": "https://elpais.com/rss/elpais/portada.xml", "fuente": "El País", "categoria": "internacional"},
    {"url": "https://feeds.bbci.co.uk/mundo/rss.xml", "fuente": "BBC Mundo", "categoria": "internacional"},
    {"url": "https://es.euronews.com/rss?level=theme&name=news", "fuente": "Euronews", "categoria": "internacional"},
    {"url": "https://news.google.com/rss?hl=es-419&gl=MX&ceid=MX:es-419", "fuente": "Google News", "categoria": "internacional"},
    {"url": "https://trends.google.com/trending/rss?geo=MX", "fuente": "Google Trends", "categoria": "trending"},
]

# Contenido propio de Evaristo Tenorio (dueño del medio) — autorización
# expresa para usar texto e imágenes tal cual, sin reescritura IA (a
# diferencia de FEEDS arriba). Por eso corren por un camino aparte en
# main(): ver obtener_entradas_vallarta.
FUENTE_VALLARTA = "Minuto a Minuto Noticias"
FEEDS_VALLARTA = [
    {"url": "https://minutoaminutonoticiasvallartabahia.com/category/puerto-vallarta/feed/", "categoria": "puerto-vallarta"},
    {"url": "https://minutoaminutonoticiasvallartabahia.com/category/bahia-de-banderas/feed/", "categoria": "bahia-banderas"},
    {"url": "https://minutoaminutonoticiasvallartabahia.com/category/jalisco/feed/", "categoria": "jalisco"},
    {"url": "https://minutoaminutonoticiasvallartabahia.com/category/nayarit/feed/", "categoria": "nayarit"},
]


# Búsqueda de og:image por regex en vez de un parser HTML completo: es una
# sola etiqueta bien conocida, no vale la pena una dependencia (bs4/lxml)
# para esto — ponytail: regex, upgrade a un parser real si algún día el
# formato de las páginas fuente lo exige.
OG_IMAGE_RE = re.compile(
    r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', re.IGNORECASE
)
OG_IMAGE_RE_ALT = re.compile(
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', re.IGNORECASE
)


def obtener_imagen_og(url: str) -> str | None:
    """Último recurso cuando el RSS no trae imagen propia: lee el <head> de
    la página original y saca su og:image. Nunca debe tronar el pipeline —
    cualquier falla (timeout, 403, HTML raro) simplemente deja la nota sin
    imagen."""
    try:
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=8)
        resp.raise_for_status()
        html = resp.text[:200_000]  # no hace falta la página completa
        match = OG_IMAGE_RE.search(html) or OG_IMAGE_RE_ALT.search(html)
        return match.group(1) if match else None
    except Exception:
        return None


def cargar_json(path: Path, default):
    if not path.exists():
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def guardar_json(path: Path, data) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def obtener_entradas_nuevas(historial: dict) -> list[dict]:
    nuevas = []
    for feed in FEEDS:
        try:
            resp = requests.get(feed["url"], headers={"User-Agent": USER_AGENT}, timeout=15)
            resp.raise_for_status()
            parsed = feedparser.parse(resp.content)
            if getattr(parsed, "bozo", False) and not parsed.entries:
                print(f"[aviso] feed sin entradas o con error: {feed['fuente']} ({feed['url']})")
                continue
            entradas = parse_entries_from_parsed(
                parsed, feed["fuente"], feed["categoria"], feed_url=feed["url"]
            )
            nuevas.extend(filter_new_entries(entradas, historial))
        except Exception as exc:
            print(f"[aviso] no se pudo leer feed {feed['fuente']}: {exc}")
            continue

    # Dedup dentro de la misma corrida: distintos feeds (o, tras el fix del
    # link sintético de Trends, en teoría el mismo feed) pueden traer la
    # misma nota. Sin esto se reescribe con IA y se renderiza dos veces.
    vistos: set[str] = set()
    deduplicadas = []
    for entrada in nuevas:
        if entrada["link"] in vistos:
            continue
        vistos.add(entrada["link"])
        deduplicadas.append(entrada)

    for entrada in deduplicadas:
        if entrada.get("imagen") or entrada["link"].startswith("https://www.google.com/search?q="):
            continue
        entrada["imagen"] = obtener_imagen_og(entrada["link"])

    return deduplicadas


def obtener_cuerpo_y_og_image(url: str) -> tuple[str | None, str | None]:
    """El RSS de Minuto a Minuto solo trae un extracto corto y sin imagen —
    a diferencia de obtener_imagen_og (que solo saca la imagen), esto
    también saca el cuerpo completo real de '.entry-content' con
    BeautifulSoup (una sola etiqueta con regex ya no alcanza para un bloque
    con HTML anidado). Nunca debe tronar el pipeline: cualquier falla deja
    la nota sin ese dato, tal como el resto del pipeline."""
    try:
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=10)
        resp.raise_for_status()
        html = resp.text
        soup = BeautifulSoup(html, "html.parser")
        contenedor = soup.select_one(".entry-content")
        cuerpo = (
            limpiar_texto_vallarta(contenedor.get_text("\n\n", strip=True))
            if contenedor else None
        )
        match = OG_IMAGE_RE.search(html[:200_000]) or OG_IMAGE_RE_ALT.search(html[:200_000])
        imagen = match.group(1) if match else None
        return cuerpo or None, imagen
    except Exception:
        return None, None


def obtener_entradas_vallarta(historial: dict) -> list[dict]:
    """Puerto Vallarta / Bahía de Banderas / Jalisco / Nayarit: contenido
    propio de Evaristo, se usa tal cual (sin pasar por rewrite_entry_with_ai
    como el resto de FEEDS) — build_nota() recibe la misma entrada dos
    veces (como 'entrada' y como 'reescrita') porque para cuando llega ahí
    ya trae titulo/resumen/cuerpo puestos aquí mismo."""
    nuevas = []
    for feed in FEEDS_VALLARTA:
        try:
            resp = requests.get(feed["url"], headers={"User-Agent": USER_AGENT}, timeout=15)
            resp.raise_for_status()
            parsed = feedparser.parse(resp.content)
            if getattr(parsed, "bozo", False) and not parsed.entries:
                print(f"[aviso] feed sin entradas o con error: {FUENTE_VALLARTA} ({feed['url']})")
                continue
            entradas = parse_entries_from_parsed(
                parsed, FUENTE_VALLARTA, feed["categoria"], feed_url=feed["url"]
            )
            nuevas.extend(filter_new_entries(entradas, historial))
        except Exception as exc:
            print(f"[aviso] no se pudo leer feed {FUENTE_VALLARTA} ({feed['categoria']}): {exc}")
            continue

    vistos: set[str] = set()
    completas = []
    for entrada in nuevas:
        if entrada["link"] in vistos:
            continue
        vistos.add(entrada["link"])

        cuerpo, imagen = obtener_cuerpo_y_og_image(entrada["link"])
        if not cuerpo:
            print(f"[aviso] se descarta nota de Vallarta (sin cuerpo): {entrada['titulo']}")
            continue

        entrada["cuerpo"] = cuerpo
        entrada["resumen"] = resumen_de_cuerpo(cuerpo)
        entrada["imagen"] = imagen
        completas.append(entrada)

    return completas


def main() -> None:
    load_dotenv()
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("ERROR: falta OPENAI_API_KEY (ponla en .env o como variable de entorno)")
        sys.exit(1)

    client = OpenAI(api_key=api_key)
    call_openai = make_openai_caller(client)

    historial = cargar_json(HISTORIAL_PATH, {})
    news_actual = cargar_json(NEWS_PATH, {"generado": None, "notas": []})
    notas_vigentes = news_actual.get("notas", [])

    entradas_nuevas = obtener_entradas_nuevas(historial)
    print(f"Entradas nuevas encontradas: {len(entradas_nuevas)}")

    notas_nuevas = []
    for entrada in entradas_nuevas:
        reescrita = rewrite_entry_with_ai(entrada, call_openai)
        if reescrita is None:
            print(f"[aviso] se descarta nota (falló reescritura IA): {entrada['titulo']}")
            continue
        notas_nuevas.append(build_nota(entrada, reescrita))
        # Se guarda cuándo el PIPELINE vio este link (no la fecha de
        # publicación del feed): trim_historial mide antigüedad desde este
        # valor, y si aquí quedara la fecha de publicación, una nota ya
        # vieja al llegar se purgaría del historial en la misma corrida y
        # volvería a parecer "nueva" (y a re-pagarse a la IA) para siempre.
        historial[entrada["link"]] = datetime.now(timezone.utc).isoformat()

    entradas_vallarta = obtener_entradas_vallarta(historial)
    print(f"Entradas nuevas de Vallarta encontradas: {len(entradas_vallarta)}")

    for entrada in entradas_vallarta:
        try:
            # Sin reescritura IA: la propia entrada (ya trae
            # titulo/resumen/cuerpo puestos en obtener_entradas_vallarta)
            # hace las veces de "reescrita".
            notas_nuevas.append(build_nota(entrada, entrada))
        except ValueError as exc:
            print(f"[aviso] se descarta nota de Vallarta (inválida): {entrada['titulo']} — {exc}")
            continue
        historial[entrada["link"]] = datetime.now(timezone.utc).isoformat()

    todas = trim_news(notas_vigentes + notas_nuevas)
    historial = trim_historial(historial)

    guardar_json(NEWS_PATH, {"generado": datetime.now(timezone.utc).isoformat(), "notas": todas})
    guardar_json(HISTORIAL_PATH, historial)
    print(f"Listo: {len(notas_nuevas)} notas nuevas, {len(todas)} notas vigentes en news.json")


if __name__ == "__main__":
    main()
