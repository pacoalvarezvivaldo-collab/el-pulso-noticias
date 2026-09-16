"""Funciones puras del pipeline de noticias — sin red ni llamadas a IA,
para poder probarlas sin mocks pesados."""
from __future__ import annotations

import hashlib
import calendar
from datetime import datetime, timedelta, timezone

CAMPOS_NOTA = {"id", "categoria", "titulo", "resumen", "cuerpo", "fuente", "link", "fecha"}
CATEGORIAS_VALIDAS = {"nacional", "internacional", "trending"}


def id_de_link(link: str) -> str:
    return hashlib.sha1(link.encode("utf-8")).hexdigest()[:12]


def parse_entries_from_parsed(parsed, fuente: str, categoria: str) -> list[dict]:
    """parsed: resultado de feedparser.parse(url), o un objeto equivalente
    (en tests, un SimpleNamespace con .entries)."""
    entradas = []
    for item in parsed.entries:
        link = getattr(item, "link", None)
        titulo = getattr(item, "title", None)
        if not link or not titulo:
            continue
        resumen = getattr(item, "summary", "") or ""
        published_parsed = getattr(item, "published_parsed", None)
        if published_parsed:
            fecha = datetime.fromtimestamp(
                calendar.timegm(published_parsed), tz=timezone.utc
            ).isoformat()
        else:
            fecha = datetime.now(timezone.utc).isoformat()
        entradas.append({
            "link": link,
            "titulo": titulo,
            "resumen": resumen,
            "fuente": fuente,
            "categoria": categoria,
            "fecha": fecha,
        })
    return entradas


def filter_new_entries(entradas: list[dict], historial: dict[str, str]) -> list[dict]:
    return [e for e in entradas if e["link"] not in historial]


def trim_historial(
    historial: dict[str, str], dias: int = 14, ahora: datetime | None = None
) -> dict[str, str]:
    ahora = ahora or datetime.now(timezone.utc)
    limite = ahora - timedelta(days=dias)
    resultado = {}
    for link, fecha_iso in historial.items():
        try:
            fecha = datetime.fromisoformat(fecha_iso)
        except ValueError:
            continue
        if fecha >= limite:
            resultado[link] = fecha_iso
    return resultado


def trim_news(
    notas: list[dict], dias: int = 4, ahora: datetime | None = None
) -> list[dict]:
    ahora = ahora or datetime.now(timezone.utc)
    limite = ahora - timedelta(days=dias)
    resultado = []
    for nota in notas:
        try:
            fecha = datetime.fromisoformat(nota["fecha"])
        except (KeyError, ValueError):
            continue
        if fecha >= limite:
            resultado.append(nota)
    return resultado


def validate_nota(nota: dict) -> None:
    faltantes = CAMPOS_NOTA - nota.keys()
    if faltantes:
        raise ValueError(f"Nota incompleta, faltan campos: {faltantes}")
    if nota["categoria"] not in CATEGORIAS_VALIDAS:
        raise ValueError(f"Categoría inválida: {nota['categoria']!r}")
    for campo in ("titulo", "resumen", "cuerpo", "fuente", "link"):
        valor = nota[campo]
        if not isinstance(valor, str) or not valor.strip():
            raise ValueError(f"Campo '{campo}' vacío o inválido")


def build_nota(entrada: dict, reescrita: dict) -> dict:
    nota = {
        "id": id_de_link(entrada["link"]),
        "categoria": entrada["categoria"],
        "titulo": reescrita["titulo"],
        "resumen": reescrita["resumen"],
        "cuerpo": reescrita["cuerpo"],
        "fuente": entrada["fuente"],
        "link": entrada["link"],
        "fecha": entrada["fecha"],
    }
    validate_nota(nota)
    return nota
