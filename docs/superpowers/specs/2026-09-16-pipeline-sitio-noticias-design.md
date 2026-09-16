# Diseño — El Pulso Noticias: pipeline de noticias + sitio (Fase 1)

Diseño visual de referencia (paleta, tipografía, componentes): ver `2026-09-16-diseno-visual-referencia.md`.

## Alcance

Fase 1 (este spec): pipeline de contenido que jala noticias, las reescribe con IA y las publica en un sitio web estático que se actualiza solo.

Fuera de alcance — fases posteriores, specs aparte:
- **Fase 2**: autoposteo a Facebook/Instagram/TikTok/X (cada API pide su propio proceso de aprobación/app review) y cualquier API de noticias de paga (NewsAPI/Currents).
- **Fase 3**: PWA (el mismo sitio, instalable en el celular con ícono y pantalla completa vía `manifest.json` + service worker) — decidido en vez de app nativa por costo/esfuerzo (sin cuentas de desarrollador de pago, mismo código que el sitio).

## Cobertura editorial

- **Nacional** (México, general — política, nota roja, espectáculos, deportes, mezcla amplia)
- **Internacional**
- **Trending** (lo más buscado del momento en México, vía Google Trends)

## Fuentes de datos (todas gratis, sin API key, sin límite de requests)

| Categoría | Fuente | Método |
| --- | --- | --- |
| Nacional | El Universal, Reforma, El Heraldo, Latinus | RSS propio de cada medio (Latinus vía RSS del canal de YouTube si no publica feed de texto) |
| Internacional | CNN en español, El País, Telemundo, Associated Press, Agencia France-Presse, Google News (sección internacional/español) | RSS propio de cada medio + RSS de búsqueda de Google News |
| Trending | Google Trends | RSS diario de tendencias, `geo=MX` |

Justificación: NewsAPI.org en tier gratis prohíbe uso en producción/comercial y retrasa artículos 24h; Currents API gratis limita a 600 requests/mes. RSS directo no tiene esas restricciones y da control exacto sobre qué medios se incluyen.

## Arquitectura

```
pipeline/fetch_news.py   → jala RSS, dedup, llama a OpenAI, escribe news.json
historial.json           → URLs ya procesadas (evita repetir notas)
news.json                → salida: notas listas para el frontend
.github/workflows/update_news.yml → cron cada 3h: corre el script, commitea y pushea
index.html / style.css / app.js   → sitio estático, lee news.json
```

### 1. Pipeline (`pipeline/fetch_news.py`, Python)

1. Recorre la lista de feeds RSS (nacional + internacional + Google News + Google Trends) con `feedparser`.
2. Filtra contra `historial.json` (dedup por URL/link) — solo procesa notas nuevas.
3. Por cada nota nueva, llama a la API de OpenAI (`gpt-4o-mini`) con el rol de "Agente Editor":
  - **Prompt de sistema**: *"Actúa como un presentador y redactor profesional de un noticiero tradicional y serio. Reescribe el título y el cuerpo de la nota con un tono informativo, objetivo, claro y profesional. Devuelve el resultado estrictamente en un formato JSON estructurado sin texto adicional."*
  - Entrada: título + resumen/extracto original del RSS.
  - Salida esperada (JSON): `{ "titulo": "...", "resumen": "...", "cuerpo": "..." }`
4. Arma el objeto final de la nota: categoría (`nacional`/`internacional`/`trending`), título y cuerpo reescritos, fuente original (nombre del medio), link original, fecha de publicación, fecha de procesamiento.
5. Guarda todas las notas (nuevas + las que ya estaban vigentes) en `news.json`.
6. Agrega las URLs nuevas a `historial.json` y recorta entradas viejas (más de N días) para que no crezca sin límite.

### 2. Automatización (`.github/workflows/update_news.yml`)

- Cron cada 6 horas.
- Pasos: checkout → instalar dependencias (`feedparser`, `openai`) → correr `fetch_news.py` (con `OPENAI_API_KEY` como GitHub Secret) → commit de `news.json` + `historial.json` si hubo cambios → push.
- El push a la rama activa el rebuild/publish de GitHub Pages.

### 3. Frontend (`index.html` + `style.css` + `app.js`, HTML/CSS/JS plano)

- Fetch asíncrono de `news.json` al cargar.
- Tabs: **Nacional / Internacional / Trending**.
- Nota principal destacada en grande + grid de tarjetas (3-4 columnas responsivas), siguiendo el patrón visual del diseño de referencia (categoría en badge de color, título, fecha, fuente).
- Botón "Leer más" abre modal con el cuerpo completo reescrito por la IA, crédito a la fuente original y link de salida.
- Modo oscuro automático vía `prefers-color-scheme`.
- Elementos a portar del diseño de referencia: franja "AL MOMENTO" con ticker animado (últimas notas en scroll horizontal) y reloj "EN VIVO · ACTUALIZADO".

### 4. Hosting

GitHub Pages, mismo repositorio del pipeline — un solo lugar, un solo push activa todo.

## Manejo de errores

- Feed individual caído/timeout → se salta esa fuente, el run continúa con las demás; se deja log visible en la salida del Action.
- Falla la llamada a OpenAI en una nota puntual → se descarta solo esa nota, no se detiene el run completo.
- `historial.json` se recorta periódicamente (últimos N días) para no crecer indefinidamente en el repo.

## Testing

- Corrida local del script con `.env` (`OPENAI_API_KEY`) contra un subconjunto de feeds, revisando que `news.json` quede bien formado.
- Un `assert` dentro del script que valida la estructura de cada nota (campos requeridos presentes) antes de guardarla en `news.json` — ponytail: sin framework de tests, es la mínima verificación necesaria para un pipeline de este tamaño.

## Variables de entorno / secretos

- `OPENAI_API_KEY` — GitHub Secret, nunca en el código ni en el repo.

## Pendiente para el usuario (fuera del código)

- **Dominio: sin decidir todavía.** `elpulsonoticias.com` y `.com.mx`, `elpulsodigital.mx`, `pulsonoticias.mx` salen ocupados en verificación WHOIS (posible squatting sobre variantes obvias del nombre). `elpulsonews.com` confirmado disponible como opción de respaldo. No bloquea el desarrollo — GitHub Pages da una URL gratis (`usuario.github.io/repo`) mientras se decide, y el dominio propio se apunta después.
- Crear la cuenta/API key de OpenAI y cargarla como secret del repo.
