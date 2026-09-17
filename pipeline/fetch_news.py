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
import sys
from datetime import datetime, timezone
from pathlib import Path

import feedparser
import requests
from dotenv import load_dotenv
from openai import OpenAI

sys.path.insert(0, str(Path(__file__).parent.parent))
from pipeline.editor_ia import make_openai_caller, rewrite_entry_with_ai
from pipeline.noticias import (
    build_nota,
    filter_new_entries,
    parse_entries_from_parsed,
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
    {"url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCjmSHs_B8h2E2wLiCKu7oWQ", "fuente": "Latinus", "categoria": "nacional"},
    {"url": "https://elpais.com/rss/elpais/portada.xml", "fuente": "El País", "categoria": "internacional"},
    {"url": "https://feeds.bbci.co.uk/mundo/rss.xml", "fuente": "BBC Mundo", "categoria": "internacional"},
    {"url": "https://es.euronews.com/rss?level=theme&name=news", "fuente": "Euronews", "categoria": "internacional"},
    {"url": "https://news.google.com/rss?hl=es-419&gl=MX&ceid=MX:es-419", "fuente": "Google News", "categoria": "internacional"},
    {"url": "https://trends.google.com/trending/rss?geo=MX", "fuente": "Google Trends", "categoria": "trending"},
]


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
            entradas = parse_entries_from_parsed(parsed, feed["fuente"], feed["categoria"])
            nuevas.extend(filter_new_entries(entradas, historial))
        except Exception as exc:
            print(f"[aviso] no se pudo leer feed {feed['fuente']}: {exc}")
            continue
    return nuevas


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
        historial[entrada["link"]] = entrada["fecha"]

    todas = trim_news(notas_vigentes + notas_nuevas)
    historial = trim_historial(historial)

    guardar_json(NEWS_PATH, {"generado": datetime.now(timezone.utc).isoformat(), "notas": todas})
    guardar_json(HISTORIAL_PATH, historial)
    print(f"Listo: {len(notas_nuevas)} notas nuevas, {len(todas)} notas vigentes en news.json")


if __name__ == "__main__":
    main()
