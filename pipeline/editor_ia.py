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
