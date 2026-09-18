"""Funciones puras del pipeline de noticias — sin red ni llamadas a IA,
para poder probarlas sin mocks pesados."""
from __future__ import annotations

import hashlib
import calendar
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

CAMPOS_NOTA = {"id", "categoria", "titulo", "resumen", "cuerpo", "fuente", "link", "fecha"}
CATEGORIAS_VALIDAS = {
    "nacional", "internacional", "trending",
    # Regionales: contenido propio de Evaristo Tenorio (Minuto a Minuto
    # Noticias Vallarta Bahía) — autorización expresa del dueño para usar
    # texto e imágenes tal cual, sin reescritura IA. Ver
    # fetch_news.py::obtener_entradas_vallarta.
    "puerto-vallarta", "bahia-banderas", "jalisco", "nayarit",
}


def id_de_link(link: str) -> str:
    return hashlib.sha1(link.encode("utf-8")).hexdigest()[:12]


def _imagen_de_entry(item) -> str | None:
    """Busca una imagen ya embebida en la entrada RSS (media:thumbnail,
    media:content o un enclosure de imagen) — sin red, solo lee lo que
    feedparser ya trajo consigo. Si ningún feed trae nada aquí,
    fetch_news.py intenta sacar el og:image de la página original como
    último recurso (eso sí necesita red, por eso vive fuera de este módulo
    "puro")."""
    media_thumbnail = getattr(item, "media_thumbnail", None)
    if media_thumbnail:
        url = media_thumbnail[0].get("url")
        if url:
            return url

    media_content = getattr(item, "media_content", None)
    if media_content:
        for m in media_content:
            tipo = m.get("type") or m.get("medium") or ""
            if not tipo or "image" in tipo:
                url = m.get("url")
                if url:
                    return url

    enclosures = getattr(item, "enclosures", None)
    if enclosures:
        for enc in enclosures:
            tipo = enc.get("type", "")
            url = enc.get("href") or enc.get("url")
            if url and (not tipo or tipo.startswith("image/")):
                return url

    # Google Trends (namespace ht:) trae su propia miniatura por tema —
    # feedparser expone <ht:picture> como el atributo "ht_picture". Sin
    # esto, Trending se queda siempre sin imagen: sus notas no tienen un
    # link a un artículo real (ver comentario en parse_entries_from_parsed),
    # así que el fallback de og:image en fetch_news.py no aplica ahí.
    ht_picture = getattr(item, "ht_picture", None)
    if ht_picture:
        return ht_picture

    return None


def parse_entries_from_parsed(
    parsed, fuente: str, categoria: str, feed_url: str | None = None
) -> list[dict]:
    """parsed: resultado de feedparser.parse(url), o un objeto equivalente
    (en tests, un SimpleNamespace con .entries).

    Algunos feeds (p.ej. Google Trends RSS) no traen un <link> propio por
    entrada: feedparser rellena entry.link con el link del feed completo, así
    que todas las entradas terminan con el mismo link (y por tanto el mismo
    id). Si eso pasa —o si el link simplemente falta— se genera un link
    sintético de búsqueda a partir del título, que sí es distinto por nota.
    """
    entradas = []
    for item in parsed.entries:
        titulo = getattr(item, "title", None)
        if not titulo:
            continue
        link = getattr(item, "link", None)
        if not link or (feed_url is not None and link == feed_url):
            link = f"https://www.google.com/search?q={quote(titulo)}"
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
            "imagen": _imagen_de_entry(item),
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
    notas: list[dict],
    dias: int = 4,
    ahora: datetime | None = None,
    max_por_categoria: int = 28,
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

    # Tope por categoría: news.json no debe crecer sin límite — el frontend
    # solo muestra ~10 notas por vista, así que conservar cientos es puro
    # peso muerto (tamaño del archivo y del repo). Se queda con las N más
    # recientes de CADA categoría, no un tope global. 28 y no 20: el hero+
    # grid de cada categoría ya usa 20, el sidebar "Más noticias" del
    # frontend (app.js::render) muestra hasta 8 más (notas 21-28) — con
    # tope 20 nunca sobraba nada para esa lista fuera de Inicio (que mezcla
    # las 3 categorías y sí tenía de sobra).
    por_categoria: dict[str, list[dict]] = {}
    for nota in resultado:
        por_categoria.setdefault(nota.get("categoria"), []).append(nota)

    limitado = []
    for notas_categoria in por_categoria.values():
        notas_categoria.sort(key=lambda n: n["fecha"], reverse=True)
        limitado.extend(notas_categoria[:max_por_categoria])
    return limitado


def limpiar_texto_vallarta(texto: str) -> str:
    """Minuto a Minuto Noticias marca énfasis con asteriscos/guiones bajos
    en texto plano (*negrita*, _cursiva_) que nunca se convierten a HTML —
    se quitan porque nuestro sitio no interpreta markdown, se verían
    literales en la nota."""
    return texto.replace("*", "").replace("_", "").strip()


def resumen_de_cuerpo(cuerpo: str, max_len: int = 180) -> str:
    """Recorta el cuerpo completo a un resumen corto para la tarjeta —
    corta en el último espacio antes del límite para no partir una palabra
    a la mitad."""
    texto = " ".join(cuerpo.split())
    if len(texto) <= max_len:
        return texto
    corte = texto.rfind(" ", 0, max_len)
    if corte == -1:
        corte = max_len
    return texto[:corte].rstrip() + "…"


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
        "imagenUrl": entrada.get("imagen"),
    }
    validate_nota(nota)
    return nota
