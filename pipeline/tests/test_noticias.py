from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from pipeline.noticias import (
    build_nota,
    filter_new_entries,
    id_de_link,
    parse_entries_from_parsed,
    trim_historial,
    trim_news,
    validate_nota,
)


def test_id_de_link_es_estable_y_unico():
    a = id_de_link("https://example.com/nota-1")
    b = id_de_link("https://example.com/nota-1")
    c = id_de_link("https://example.com/nota-2")
    assert a == b
    assert a != c
    assert len(a) == 12


def _entry(link="https://x.com/n1", title="Título", summary="Resumen", published_parsed=None):
    ns = SimpleNamespace(link=link, title=title, summary=summary)
    if published_parsed is not None:
        ns.published_parsed = published_parsed
    return ns


def test_parse_entries_from_parsed_extrae_campos():
    publicado = datetime(2026, 9, 16, 15, 0, tzinfo=timezone.utc).timetuple()
    parsed = SimpleNamespace(entries=[_entry(published_parsed=publicado)])

    entradas = parse_entries_from_parsed(parsed, fuente="El Universal", categoria="nacional")

    assert len(entradas) == 1
    e = entradas[0]
    assert e["link"] == "https://x.com/n1"
    assert e["titulo"] == "Título"
    assert e["resumen"] == "Resumen"
    assert e["fuente"] == "El Universal"
    assert e["categoria"] == "nacional"
    assert e["fecha"] == "2026-09-16T15:00:00+00:00"


def test_parse_entries_from_parsed_ignora_entradas_sin_link_o_titulo():
    parsed = SimpleNamespace(entries=[
        SimpleNamespace(link=None, title="Sin link", summary=""),
        SimpleNamespace(link="https://x.com/n2", title=None, summary=""),
    ])

    entradas = parse_entries_from_parsed(parsed, fuente="X", categoria="nacional")

    assert entradas == []


def test_parse_entries_from_parsed_usa_fecha_actual_si_falta_published_parsed():
    parsed = SimpleNamespace(entries=[_entry()])

    entradas = parse_entries_from_parsed(parsed, fuente="X", categoria="nacional")

    assert entradas[0]["fecha"]  # no vacío, no valida el valor exacto


def test_filter_new_entries_excluye_las_que_ya_estan_en_historial():
    entradas = [
        {"link": "https://x.com/1", "titulo": "A"},
        {"link": "https://x.com/2", "titulo": "B"},
    ]
    historial = {"https://x.com/1": "2026-09-16T00:00:00+00:00"}

    nuevas = filter_new_entries(entradas, historial)

    assert nuevas == [{"link": "https://x.com/2", "titulo": "B"}]


def test_trim_historial_descarta_entradas_viejas():
    ahora = datetime(2026, 9, 16, tzinfo=timezone.utc)
    historial = {
        "https://x.com/vieja": "2026-08-01T00:00:00+00:00",
        "https://x.com/reciente": "2026-09-15T00:00:00+00:00",
    }

    resultado = trim_historial(historial, dias=14, ahora=ahora)

    assert resultado == {"https://x.com/reciente": "2026-09-15T00:00:00+00:00"}


def test_trim_news_descarta_notas_viejas():
    ahora = datetime(2026, 9, 16, tzinfo=timezone.utc)
    notas = [
        {"fecha": "2026-09-01T00:00:00+00:00", "titulo": "vieja"},
        {"fecha": "2026-09-15T12:00:00+00:00", "titulo": "reciente"},
    ]

    resultado = trim_news(notas, dias=4, ahora=ahora)

    assert resultado == [{"fecha": "2026-09-15T12:00:00+00:00", "titulo": "reciente"}]


def _nota_valida():
    return {
        "id": "abc123",
        "categoria": "nacional",
        "titulo": "Título",
        "resumen": "Resumen",
        "cuerpo": "Cuerpo",
        "fuente": "El Universal",
        "link": "https://x.com/n1",
        "fecha": "2026-09-16T15:00:00+00:00",
    }


def test_validate_nota_acepta_nota_bien_formada():
    validate_nota(_nota_valida())  # no debe lanzar


def test_validate_nota_rechaza_campo_faltante():
    nota = _nota_valida()
    del nota["cuerpo"]
    with pytest.raises(ValueError):
        validate_nota(nota)


def test_validate_nota_rechaza_categoria_invalida():
    nota = _nota_valida()
    nota["categoria"] = "deportes"
    with pytest.raises(ValueError):
        validate_nota(nota)


def test_validate_nota_rechaza_campo_vacio():
    nota = _nota_valida()
    nota["titulo"] = "   "
    with pytest.raises(ValueError):
        validate_nota(nota)


def test_build_nota_combina_entrada_y_reescrita():
    entrada = {
        "link": "https://x.com/n1",
        "titulo": "Original",
        "resumen": "Original resumen",
        "fuente": "El Universal",
        "categoria": "nacional",
        "fecha": "2026-09-16T15:00:00+00:00",
    }
    reescrita = {"titulo": "Reescrito", "resumen": "Resumen IA", "cuerpo": "Cuerpo IA"}

    nota = build_nota(entrada, reescrita)

    assert nota["id"] == id_de_link("https://x.com/n1")
    assert nota["titulo"] == "Reescrito"
    assert nota["resumen"] == "Resumen IA"
    assert nota["cuerpo"] == "Cuerpo IA"
    assert nota["fuente"] == "El Universal"
    assert nota["categoria"] == "nacional"
    assert nota["link"] == "https://x.com/n1"
    assert nota["fecha"] == "2026-09-16T15:00:00+00:00"
