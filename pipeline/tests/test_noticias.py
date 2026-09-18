from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from pipeline.noticias import (
    build_nota,
    filter_new_entries,
    id_de_link,
    limpiar_texto_vallarta,
    parse_entries_from_parsed,
    resumen_de_cuerpo,
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


def test_parse_entries_from_parsed_ignora_entradas_sin_titulo():
    parsed = SimpleNamespace(entries=[
        SimpleNamespace(link="https://x.com/n2", title=None, summary=""),
    ])

    entradas = parse_entries_from_parsed(parsed, fuente="X", categoria="nacional")

    assert entradas == []


def test_parse_entries_from_parsed_genera_link_sintetico_si_falta_link():
    parsed = SimpleNamespace(entries=[
        SimpleNamespace(link=None, title="Sin link", summary=""),
    ])

    entradas = parse_entries_from_parsed(parsed, fuente="X", categoria="nacional")

    assert len(entradas) == 1
    assert entradas[0]["link"] == "https://www.google.com/search?q=Sin%20link"


def test_parse_entries_from_parsed_da_links_distintos_si_colisionan_con_el_feed():
    # Caso real: Google Trends RSS no trae <link> por entrada, así que
    # feedparser rellena entry.link con el link del FEED completo para
    # cada entrada — sin el fix, las 3 quedarían con el mismo link/id.
    feed_url = "https://trends.google.com/trending/rss?geo=MX"
    parsed = SimpleNamespace(entries=[
        SimpleNamespace(link=feed_url, title="Tema A", summary=""),
        SimpleNamespace(link=feed_url, title="Tema B", summary=""),
        SimpleNamespace(link=feed_url, title="Tema C", summary=""),
    ])

    entradas = parse_entries_from_parsed(
        parsed, fuente="Google Trends", categoria="trending", feed_url=feed_url
    )

    links = [e["link"] for e in entradas]
    assert len(links) == 3
    assert len(set(links)) == 3  # distintos entre sí
    assert all(link != feed_url for link in links)  # ninguno es el link del feed

    ids = [id_de_link(link) for link in links]
    assert len(set(ids)) == 3  # y por tanto ids distintos


def test_parse_entries_from_parsed_usa_fecha_actual_si_falta_published_parsed():
    parsed = SimpleNamespace(entries=[_entry()])

    entradas = parse_entries_from_parsed(parsed, fuente="X", categoria="nacional")

    assert entradas[0]["fecha"]  # no vacío, no valida el valor exacto


def test_parse_entries_from_parsed_sin_imagen_si_el_feed_no_trae_nada():
    parsed = SimpleNamespace(entries=[_entry()])

    entradas = parse_entries_from_parsed(parsed, fuente="X", categoria="nacional")

    assert entradas[0]["imagen"] is None


def test_parse_entries_from_parsed_toma_imagen_de_media_thumbnail():
    entry = _entry()
    entry.media_thumbnail = [{"url": "https://x.com/foto.jpg"}]
    parsed = SimpleNamespace(entries=[entry])

    entradas = parse_entries_from_parsed(parsed, fuente="X", categoria="nacional")

    assert entradas[0]["imagen"] == "https://x.com/foto.jpg"


def test_parse_entries_from_parsed_toma_imagen_de_media_content():
    entry = _entry()
    entry.media_content = [{"url": "https://x.com/foto.jpg", "medium": "image"}]
    parsed = SimpleNamespace(entries=[entry])

    entradas = parse_entries_from_parsed(parsed, fuente="X", categoria="nacional")

    assert entradas[0]["imagen"] == "https://x.com/foto.jpg"


def test_parse_entries_from_parsed_ignora_media_content_que_no_es_imagen():
    entry = _entry()
    entry.media_content = [{"url": "https://x.com/video.mp4", "medium": "video"}]
    parsed = SimpleNamespace(entries=[entry])

    entradas = parse_entries_from_parsed(parsed, fuente="X", categoria="nacional")

    assert entradas[0]["imagen"] is None


def test_parse_entries_from_parsed_toma_imagen_de_enclosure():
    entry = _entry()
    entry.enclosures = [{"href": "https://x.com/foto.jpg", "type": "image/jpeg"}]
    parsed = SimpleNamespace(entries=[entry])

    entradas = parse_entries_from_parsed(parsed, fuente="X", categoria="nacional")

    assert entradas[0]["imagen"] == "https://x.com/foto.jpg"


def test_parse_entries_from_parsed_toma_imagen_de_ht_picture_google_trends():
    entry = _entry()
    entry.ht_picture = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ABC123"
    parsed = SimpleNamespace(entries=[entry])

    entradas = parse_entries_from_parsed(parsed, fuente="Google Trends", categoria="trending")

    assert entradas[0]["imagen"] == "https://encrypted-tbn0.gstatic.com/images?q=tbn:ABC123"


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


def test_trim_news_limita_a_28_mas_recientes_por_categoria():
    ahora = datetime(2026, 9, 16, tzinfo=timezone.utc)
    notas = [
        {
            "categoria": "nacional",
            "fecha": (ahora - timedelta(hours=i)).isoformat(),
            "titulo": f"nota {i}",
        }
        for i in range(35)
    ]

    resultado = trim_news(notas, dias=4, ahora=ahora)

    assert len(resultado) == 28
    titulos = {n["titulo"] for n in resultado}
    # Las 28 más recientes son las de i=0..27 (menor i = más reciente)
    assert titulos == {f"nota {i}" for i in range(28)}


def test_trim_news_limita_categorias_de_forma_independiente():
    ahora = datetime(2026, 9, 16, tzinfo=timezone.utc)
    notas = [
        {
            "categoria": "nacional",
            "fecha": (ahora - timedelta(hours=i)).isoformat(),
            "titulo": f"nac {i}",
        }
        for i in range(35)
    ] + [
        {
            "categoria": "internacional",
            "fecha": (ahora - timedelta(hours=i)).isoformat(),
            "titulo": f"intl {i}",
        }
        for i in range(5)
    ]

    resultado = trim_news(notas, dias=4, ahora=ahora)

    nacionales = [n for n in resultado if n["categoria"] == "nacional"]
    internacionales = [n for n in resultado if n["categoria"] == "internacional"]
    assert len(nacionales) == 28  # tope alcanzado y aplicado
    assert len(internacionales) == 5  # por debajo del tope, no se recorta


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
    assert nota["imagenUrl"] is None


def test_build_nota_carga_imagenUrl_desde_la_entrada():
    entrada = {
        "link": "https://x.com/n1",
        "titulo": "Original",
        "resumen": "Original resumen",
        "fuente": "El Universal",
        "categoria": "nacional",
        "fecha": "2026-09-16T15:00:00+00:00",
        "imagen": "https://x.com/foto.jpg",
    }
    reescrita = {"titulo": "Reescrito", "resumen": "Resumen IA", "cuerpo": "Cuerpo IA"}

    nota = build_nota(entrada, reescrita)

    assert nota["imagenUrl"] == "https://x.com/foto.jpg"


def test_build_nota_acepta_categoria_regional():
    entrada = {
        "link": "https://minutoaminutonoticiasvallartabahia.com/n1",
        "titulo": "Nota de Vallarta",
        "resumen": "Resumen corto",
        "cuerpo": "Cuerpo completo",
        "fuente": "Minuto a Minuto Noticias",
        "categoria": "puerto-vallarta",
        "fecha": "2026-09-16T15:00:00+00:00",
        "imagen": None,
    }

    # Sin reescritura IA: la propia entrada hace las veces de "reescrita"
    # (ya trae titulo/resumen/cuerpo puestos por el scraper).
    nota = build_nota(entrada, entrada)

    assert nota["categoria"] == "puerto-vallarta"
    assert nota["cuerpo"] == "Cuerpo completo"


def test_limpiar_texto_vallarta_quita_asteriscos_y_guiones_bajos():
    texto = "*Puerto Vallarta hace algo*\n\n_El resumen va aquí_\n\nCuerpo normal sin marcado."

    assert limpiar_texto_vallarta(texto) == (
        "Puerto Vallarta hace algo\n\nEl resumen va aquí\n\nCuerpo normal sin marcado."
    )


def test_resumen_de_cuerpo_corta_en_espacio_y_agrega_puntos_suspensivos():
    cuerpo = "Una palabra " * 40  # bastante más largo que 180 caracteres

    resumen = resumen_de_cuerpo(cuerpo, max_len=30)

    assert len(resumen) <= 31  # 30 + el "…"
    assert resumen.endswith("…")
    assert not resumen[:-1].endswith(" ")  # no corta a media palabra


def test_resumen_de_cuerpo_no_toca_textos_cortos():
    assert resumen_de_cuerpo("Texto corto.", max_len=180) == "Texto corto."


def test_trim_news_conserva_regionales_mas_tiempo_que_el_resto():
    ahora = datetime(2026, 9, 18, tzinfo=timezone.utc)
    notas = [
        # 10 días de antigüedad: ya fuera de la ventana normal de 4 días,
        # pero muy dentro de los 60 días de las regionales.
        {"categoria": "puerto-vallarta", "fecha": (ahora - timedelta(days=10)).isoformat(), "titulo": "pv vieja"},
        {"categoria": "nacional", "fecha": (ahora - timedelta(days=10)).isoformat(), "titulo": "nac vieja"},
    ]

    resultado = trim_news(notas, dias=4, dias_regional=60, ahora=ahora)

    titulos = {n["titulo"] for n in resultado}
    assert titulos == {"pv vieja"}


def test_trim_news_limita_regionales_a_25_no_28():
    ahora = datetime(2026, 9, 18, tzinfo=timezone.utc)
    notas = [
        {
            "categoria": "puerto-vallarta",
            "fecha": (ahora - timedelta(hours=i)).isoformat(),
            "titulo": f"pv {i}",
        }
        for i in range(30)
    ]

    resultado = trim_news(notas, dias=4, dias_regional=60, ahora=ahora)

    assert len(resultado) == 25
