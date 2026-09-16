# El Pulso Noticias — Pipeline + Sitio (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el pipeline real (RSS → reescritura con IA → `news.json`) y conectar el sitio estático a datos reales, automatizado con GitHub Actions cada 6 horas.

**Architecture:** Script de Python (`pipeline/fetch_news.py`) jala RSS de 9 fuentes, dedup contra `historial.json`, reescribe cada nota nueva con OpenAI (`gpt-4o-mini`) y guarda todo en `news.json` en la raíz del repo. Un workflow de GitHub Actions corre el script cada 6h y commitea los JSON actualizados; ese push dispara el rebuild de GitHub Pages. El sitio (`index.html`/`style.css`/`app.js`, ya prototipados en `prototipo/`) se copia a la raíz del repo y se conecta a `news.json` real en vez de datos de ejemplo.

**Tech Stack:** Python 3.12, `feedparser`, SDK oficial `openai`, `python-dotenv`, `pytest`. GitHub Actions + GitHub Pages. Frontend: HTML/CSS/JS plano (sin build step).

## Global Constraints

- Categorías válidas, exactas: `nacional`, `internacional`, `trending`.
- Modelo de IA: `gpt-4o-mini`, respuesta forzada a JSON con claves exactas `titulo`, `resumen`, `cuerpo`.
- Prompt de sistema exacto (spec `2026-09-16-pipeline-sitio-noticias-design.md`): *"Actúa como un presentador y redactor profesional de un noticiero tradicional y serio. Reescribe el título y el cuerpo de la nota con un tono informativo, objetivo, claro y profesional. Devuelve el resultado estrictamente en un formato JSON estructurado sin texto adicional."*
- Cron del pipeline: cada 6 horas (`0 */6 * * *`).
- `historial.json` se recorta a los últimos 14 días; `news.json` se recorta a los últimos 4 días (decisión de implementación — el sitio es "minuto a minuto", no hace falta guardar notas más viejas).
- `OPENAI_API_KEY` nunca en texto plano en el repo — `.env` local (ya está en `.gitignore`) y GitHub Secret en Actions.
- Todo texto de una nota (título/resumen/cuerpo/fuente) que llegue al DOM debe pasar por un escapador que también codifique comillas — nunca `innerHTML` con texto crudo de la nota.
- Cualquier URL de nota usada como `href` debe validarse (`http:`/`https:` únicamente) antes de asignarse.
- Sin frameworks de test pesados: `pytest` simple para funciones puras; no hay UI de test runner ni fixtures complejas.
- Fuentes RSS reales verificadas (ver spec) — no usar las URLs de CNN Español/Telemundo/AP/AFP originales, ya confirmadas rotas o inútiles.

---

### Task 1: Scaffolding del pipeline

**Files:**
- Create: `pipeline/requirements.txt`
- Create: `pipeline/__init__.py` (vacío, para que `pipeline` sea un paquete importable en tests)
- Create: `pipeline/tests/__init__.py` (vacío)
- Create: `.env.example`
- Modify: `.gitignore` (ya existe — confirmar que cubre `__pycache__/`, `.env`, `.venv/`)

**Interfaces:**
- Produces: entorno con `feedparser`, `openai`, `python-dotenv`, `pytest` instalables vía `pip install -r pipeline/requirements.txt`.

- [ ] **Step 1: Crear `pipeline/requirements.txt`**

```
feedparser==6.0.11
openai==1.54.4
python-dotenv==1.0.1
pytest==8.3.3
```

- [ ] **Step 2: Crear paquetes vacíos**

```bash
mkdir -p pipeline/tests
touch pipeline/__init__.py pipeline/tests/__init__.py
```

- [ ] **Step 3: Crear `.env.example`**

```
OPENAI_API_KEY=sk-...
```

- [ ] **Step 4: Verificar `.gitignore`**

Confirmar que `D:\Empresa\EVARISTO MINUTO A MINUTO\.gitignore` contiene estas líneas (ya debería, de un commit anterior):

```
.env
__pycache__/
*.pyc
.venv/
```

Si falta alguna, agregarla.

- [ ] **Step 5: Instalar dependencias y verificar**

Run: `pip install -r pipeline/requirements.txt`
Expected: instala sin errores; `python -c "import feedparser, openai, dotenv, pytest"` no lanza `ImportError`.

- [ ] **Step 6: Commit**

```bash
git add pipeline/requirements.txt pipeline/__init__.py pipeline/tests/__init__.py .env.example
git commit -m "Agrega scaffolding del pipeline de noticias (dependencias, paquetes vacíos)"
```

---

### Task 2: Funciones puras de `pipeline/noticias.py`

**Files:**
- Create: `pipeline/noticias.py`
- Test: `pipeline/tests/test_noticias.py`

**Interfaces:**
- Consumes: nada (funciones puras, sin red ni IA).
- Produces:
  - `id_de_link(link: str) -> str`
  - `parse_entries_from_parsed(parsed, fuente: str, categoria: str) -> list[dict]` — cada dict con claves `link, titulo, resumen, fuente, categoria, fecha` (fecha ISO 8601 UTC).
  - `filter_new_entries(entradas: list[dict], historial: dict[str, str]) -> list[dict]`
  - `trim_historial(historial: dict[str, str], dias: int = 14, ahora: datetime | None = None) -> dict[str, str]`
  - `trim_news(notas: list[dict], dias: int = 4, ahora: datetime | None = None) -> list[dict]`
  - `validate_nota(nota: dict) -> None` (lanza `ValueError` si la nota es inválida)
  - `build_nota(entrada: dict, reescrita: dict) -> dict` — nota final con claves `id, categoria, titulo, resumen, cuerpo, fuente, link, fecha`

- [ ] **Step 1: Escribir tests que fallan**

Crear `pipeline/tests/test_noticias.py`:

```python
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
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `pytest pipeline/tests/test_noticias.py -v`
Expected: `ModuleNotFoundError: No module named 'pipeline.noticias'`

- [ ] **Step 3: Implementar `pipeline/noticias.py`**

```python
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
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `pytest pipeline/tests/test_noticias.py -v`
Expected: 14 tests, todos `PASS`.

- [ ] **Step 5: Commit**

```bash
git add pipeline/noticias.py pipeline/tests/test_noticias.py
git commit -m "Agrega funciones puras del pipeline (dedup, recorte, validación de notas)"
```

---

### Task 3: Reescritura con IA en `pipeline/editor_ia.py`

**Files:**
- Create: `pipeline/editor_ia.py`
- Test: `pipeline/tests/test_editor_ia.py`

**Interfaces:**
- Consumes: nada de Task 2 directamente (independiente); comparte la forma de `entrada` (`titulo`, `resumen`) que produce `parse_entries_from_parsed`.
- Produces:
  - `PROMPT_SISTEMA: str`
  - `rewrite_entry_with_ai(entrada: dict, call_openai: Callable[[str, str], str]) -> dict | None` — dict con `titulo, resumen, cuerpo` o `None` si falla esa nota puntual.
  - `make_openai_caller(client, modelo: str = "gpt-4o-mini") -> Callable[[str, str], str]` — fábrica que usa el SDK real de OpenAI (no se prueba con red real, solo se usa en `fetch_news.py`).

La llamada real a OpenAI se inyecta como función (`call_openai`) para poder probar `rewrite_entry_with_ai` sin red ni credenciales.

- [ ] **Step 1: Escribir tests que fallan**

Crear `pipeline/tests/test_editor_ia.py`:

```python
import json

from pipeline.editor_ia import PROMPT_SISTEMA, rewrite_entry_with_ai

ENTRADA = {"titulo": "Título original", "resumen": "Resumen original", "link": "https://x.com/1"}


def test_prompt_sistema_incluye_las_instrucciones_del_spec():
    assert "presentador y redactor profesional" in PROMPT_SISTEMA
    assert "JSON" in PROMPT_SISTEMA


def test_rewrite_entry_with_ai_devuelve_los_tres_campos():
    def call_openai_falso(prompt_sistema, entrada_usuario):
        return json.dumps({
            "titulo": "Título reescrito",
            "resumen": "Resumen reescrito",
            "cuerpo": "Cuerpo reescrito",
        })

    resultado = rewrite_entry_with_ai(ENTRADA, call_openai_falso)

    assert resultado == {
        "titulo": "Título reescrito",
        "resumen": "Resumen reescrito",
        "cuerpo": "Cuerpo reescrito",
    }


def test_rewrite_entry_with_ai_devuelve_none_si_la_llamada_falla():
    def call_openai_que_falla(prompt_sistema, entrada_usuario):
        raise RuntimeError("timeout de red")

    assert rewrite_entry_with_ai(ENTRADA, call_openai_que_falla) is None


def test_rewrite_entry_with_ai_devuelve_none_si_el_json_es_invalido():
    def call_openai_texto_plano(prompt_sistema, entrada_usuario):
        return "esto no es JSON"

    assert rewrite_entry_with_ai(ENTRADA, call_openai_texto_plano) is None


def test_rewrite_entry_with_ai_devuelve_none_si_falta_una_clave():
    def call_openai_incompleto(prompt_sistema, entrada_usuario):
        return json.dumps({"titulo": "T", "resumen": "R"})  # falta "cuerpo"

    assert rewrite_entry_with_ai(ENTRADA, call_openai_incompleto) is None


def test_rewrite_entry_with_ai_devuelve_none_si_una_clave_esta_vacia():
    def call_openai_vacio(prompt_sistema, entrada_usuario):
        return json.dumps({"titulo": "T", "resumen": "", "cuerpo": "C"})

    assert rewrite_entry_with_ai(ENTRADA, call_openai_vacio) is None
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `pytest pipeline/tests/test_editor_ia.py -v`
Expected: `ModuleNotFoundError: No module named 'pipeline.editor_ia'`

- [ ] **Step 3: Implementar `pipeline/editor_ia.py`**

```python
"""Reescritura de notas con el Agente Editor (OpenAI).

La llamada real al API se inyecta como función (`call_openai`) para poder
probar `rewrite_entry_with_ai` sin red ni credenciales.
"""
from __future__ import annotations

import json
from typing import Callable

PROMPT_SISTEMA = (
    "Actúa como un presentador y redactor profesional de un noticiero "
    "tradicional y serio. Reescribe el título y el cuerpo de la nota con un "
    "tono informativo, objetivo, claro y profesional. Devuelve el resultado "
    "estrictamente en un formato JSON estructurado sin texto adicional, con "
    'las claves exactas "titulo", "resumen" y "cuerpo".'
)

CallOpenAI = Callable[[str, str], str]


def rewrite_entry_with_ai(entrada: dict, call_openai: CallOpenAI) -> dict | None:
    """Devuelve {"titulo", "resumen", "cuerpo"} o None si falla esta nota puntual."""
    entrada_usuario = (
        f"Título original: {entrada['titulo']}\n"
        f"Resumen original: {entrada['resumen']}"
    )
    try:
        respuesta = call_openai(PROMPT_SISTEMA, entrada_usuario)
        data = json.loads(respuesta)
    except Exception:
        return None

    claves = ("titulo", "resumen", "cuerpo")
    if not all(k in data for k in claves):
        return None
    if not all(isinstance(data[k], str) and data[k].strip() for k in claves):
        return None
    return {k: data[k] for k in claves}


def make_openai_caller(client, modelo: str = "gpt-4o-mini") -> CallOpenAI:
    """Fábrica del call_openai real, usando el SDK oficial de OpenAI."""

    def call(prompt_sistema: str, entrada_usuario: str) -> str:
        respuesta = client.chat.completions.create(
            model=modelo,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": prompt_sistema},
                {"role": "user", "content": entrada_usuario},
            ],
        )
        return respuesta.choices[0].message.content

    return call
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `pytest pipeline/tests/test_editor_ia.py -v`
Expected: 6 tests, todos `PASS`.

- [ ] **Step 5: Commit**

```bash
git add pipeline/editor_ia.py pipeline/tests/test_editor_ia.py
git commit -m "Agrega reescritura de notas con IA (Agente Editor), con inyección de dependencia para pruebas"
```

---

### Task 4: Orquestador `pipeline/fetch_news.py`

**Files:**
- Create: `pipeline/fetch_news.py`

**Interfaces:**
- Consumes: todo lo de Task 2 (`pipeline.noticias`) y Task 3 (`pipeline.editor_ia`).
- Produces: `news.json` y `historial.json` en la raíz del repo. Este archivo no lleva unit tests (hace red real e IA real) — se prueba manualmente en Task 7.

- [ ] **Step 1: Implementar `pipeline/fetch_news.py`**

```python
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

FEEDS = [
    {"url": "https://www.eluniversal.com.mx/arc/outboundfeeds/rss/", "fuente": "El Universal", "categoria": "nacional"},
    {"url": "https://www.reforma.com/rss/portada.xml", "fuente": "Reforma", "categoria": "nacional"},
    {"url": "https://heraldodemexico.com.mx/rss", "fuente": "El Heraldo", "categoria": "nacional"},
    {"url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCjmSHs_B8h2E2wLiCKu7oWQ", "fuente": "Latinus", "categoria": "nacional"},
    {"url": "https://elpais.com/rss/elpais/portada.xml", "fuente": "El País", "categoria": "internacional"},
    {"url": "https://feeds.bbci.co.uk/mundo/rss.xml", "fuente": "BBC Mundo", "categoria": "internacional"},
    {"url": "https://rss.dw.com/xml/rss-es-all", "fuente": "DW Español", "categoria": "internacional"},
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
            parsed = feedparser.parse(feed["url"])
            if getattr(parsed, "bozo", False) and not parsed.entries:
                print(f"[aviso] feed sin entradas o con error: {feed['fuente']} ({feed['url']})")
                continue
        except Exception as exc:
            print(f"[aviso] no se pudo leer feed {feed['fuente']}: {exc}")
            continue
        entradas = parse_entries_from_parsed(parsed, feed["fuente"], feed["categoria"])
        nuevas.extend(filter_new_entries(entradas, historial))
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
```

- [ ] **Step 2: Verificar que importa sin errores**

Run: `python -c "import pipeline.fetch_news"`
Expected: sin salida, sin error (confirma que no hay errores de sintaxis ni de imports).

- [ ] **Step 3: Commit**

```bash
git add pipeline/fetch_news.py
git commit -m "Agrega orquestador del pipeline (fetch_news.py)"
```

---

### Task 5: Automatización con GitHub Actions

**Files:**
- Create: `.github/workflows/update_news.yml`

**Interfaces:**
- Consumes: `pipeline/fetch_news.py` (Task 4), secret `OPENAI_API_KEY` del repo de GitHub.
- Produces: commits automáticos de `news.json` + `historial.json` cada 6 horas.

- [ ] **Step 1: Crear el workflow**

```yaml
name: Actualizar noticias

on:
  schedule:
    - cron: "0 */6 * * *"
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  actualizar:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configurar Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Instalar dependencias
        run: pip install -r pipeline/requirements.txt

      - name: Correr el pipeline
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: python pipeline/fetch_news.py

      - name: Commitear noticias actualizadas
        run: |
          git config user.name "el-pulso-bot"
          git config user.email "actions@github.com"
          git add news.json historial.json
          git diff --cached --quiet || git commit -m "Actualiza noticias automáticamente"
          git push
```

- [ ] **Step 2: Validar sintaxis YAML**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/update_news.yml'))"`
Expected: sin error (si `pyyaml` no está instalado, correr `pip install pyyaml` primero solo para esta verificación puntual).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/update_news.yml
git commit -m "Agrega GitHub Actions para correr el pipeline cada 6 horas"
```

**Nota para cuando exista el repo remoto:** falta agregar el secret `OPENAI_API_KEY` en Settings → Secrets and variables → Actions del repo de GitHub, y habilitar GitHub Pages (Settings → Pages → Deploy from branch → rama por defecto, carpeta `/ (root)`). Estos dos pasos son manuales en la UI de GitHub, no se pueden hacer desde este plan.

---

### Task 6: Sitio de producción en la raíz del repo

**Files:**
- Create: `index.html` (copia de `prototipo/index.html`, con un cambio)
- Create: `style.css` (copia idéntica de `prototipo/style.css`)
- Create: `app.js` (copia de `prototipo/app.js`, con un cambio)
- Create: `news.json` (semilla inicial, vacía)
- Create: `historial.json` (semilla inicial, vacía)

**Interfaces:**
- Consumes: `news.json` en la raíz, con la forma `{"generado": string|null, "notas": Nota[]}` que produce `pipeline/fetch_news.py` (Task 4).
- `prototipo/` se queda tal cual, como referencia de diseño local con datos de ejemplo — no se modifica ni se borra.

- [ ] **Step 1: Copiar los archivos del prototipo a la raíz**

```bash
cp prototipo/index.html index.html
cp prototipo/style.css style.css
cp prototipo/app.js app.js
```

(`LOGO.PNG` ya existe en la raíz — no hace falta copiarlo.)

- [ ] **Step 2: Apuntar `app.js` a `news.json` real**

En `app.js`, dentro de `init()`, cambiar:

```javascript
  const res = await fetch('sample-news.json');
```

por:

```javascript
  const res = await fetch('news.json');
```

- [ ] **Step 3: Agregar modo oscuro automático (pendiente del spec de diseño)**

El spec pide `prefers-color-scheme` automático y el prototipo no lo tenía. Agregar al final de `style.css` (tanto en `style.css` de la raíz como en `prototipo/style.css`, para que ambos se vean igual):

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg-page: #14121f;
    --card-bg: #201d30;
    --text-title: #f0eefa;
    --text-body: #b8b3d1;
    --text-meta: #7d78a0;
    --border: #322c4a;
  }
  .card-photo, .hero-photo {
    background: repeating-linear-gradient(135deg, #2a2540 0 10px, #241f38 10px 20px);
  }
  .modal-body { color: #e5e2f2; }
}
```

- [ ] **Step 4: Crear las semillas iniciales**

Crear `news.json`:

```json
{
  "generado": null,
  "notas": []
}
```

Crear `historial.json`:

```json
{}
```

(Así el sitio no rompe con un 404 antes de que corra el primer pipeline; simplemente se ve vacío hasta el primer run de Actions o la primera corrida local.)

- [ ] **Step 5: Verificar en el navegador**

```bash
python -m http.server 8752
```

Abrir `http://localhost:8752/index.html`: debe cargar sin errores de consola (el feed se ve vacío, es esperado), con el header/ticker/footer renderizando igual que en `prototipo/`.

- [ ] **Step 6: Commit**

```bash
git add index.html style.css app.js news.json historial.json
git commit -m "Agrega el sitio de producción en la raíz, conectado a news.json real"
```

---

### Task 7: Corrida end-to-end local con datos reales

**Files:** ninguno nuevo — valida que Tasks 1-6 funcionan juntas.

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Confirmar que `.env` tiene la API key**

```bash
cat .env
```

Expected: una línea `OPENAI_API_KEY=sk-...` (ya se creó en una sesión anterior).

- [ ] **Step 2: Correr el pipeline real**

```bash
python pipeline/fetch_news.py
```

Expected en la salida: al menos una línea `Entradas nuevas encontradas: N` con `N > 0`, y al final `Listo: N notas nuevas, M notas vigentes en news.json`. Si algún feed falla, debe aparecer como `[aviso] ...` sin detener el resto (comportamiento esperado, no un error del script).

- [ ] **Step 3: Revisar `news.json` generado**

```bash
python -c "import json; d = json.load(open('news.json', encoding='utf-8')); print(len(d['notas']), 'notas'); print(d['notas'][0] if d['notas'] else 'vacío')"
```

Expected: imprime el conteo de notas y una nota de ejemplo con las claves `id, categoria, titulo, resumen, cuerpo, fuente, link, fecha` todas con contenido (no placeholders).

- [ ] **Step 4: Ver el sitio con datos reales**

```bash
python -m http.server 8752
```

Abrir `http://localhost:8752/index.html` (o refrescar si ya estaba abierto). Verificar:
- El ticker "AL MOMENTO" muestra títulos reales.
- Las pestañas Nacional/Internacional/Trending filtran correctamente.
- "Leer más" abre el modal con el cuerpo reescrito por la IA y el link a la fuente original funciona.

- [ ] **Step 5: Correr toda la suite de tests una vez más antes de cerrar la fase**

Run: `pytest pipeline/ -v`
Expected: todos los tests de Task 2 y Task 3 en `PASS` (20 tests en total).

- [ ] **Step 6: Commit final de la fase (si `news.json`/`historial.json` cambiaron con datos reales)**

```bash
git add news.json historial.json
git commit -m "Primera corrida real del pipeline de noticias"
```

---

## Pendientes fuera de este plan (requieren acción manual del usuario, no de código)

- Crear el repositorio remoto en GitHub y hacer el primer `git push`.
- Agregar el secret `OPENAI_API_KEY` en la configuración del repo de GitHub.
- Habilitar GitHub Pages en el repo.
- Decidir y comprar el dominio (pendiente desde el spec de diseño).
