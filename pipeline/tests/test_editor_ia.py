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
