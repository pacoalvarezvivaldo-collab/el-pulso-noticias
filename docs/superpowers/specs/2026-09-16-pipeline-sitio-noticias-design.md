# Diseño — El Pulso Noticias: pipeline de noticias + sitio (Fase 1)

Diseño visual de referencia (paleta, tipografía, componentes): ver `2026-09-16-diseno-visual-referencia.md`.

## Alcance

Fase 1 (este spec): pipeline de contenido que jala noticias, las reescribe con IA y las publica en un sitio web estático que se actualiza solo.

Fuera de alcance — fases posteriores, specs aparte:
- **Fase 2**: autoposteo a Facebook/Instagram/TikTok/X (cada API pide su propio proceso de aprobación/app review) y cualquier API de noticias de paga (NewsAPI/Currents).
- **Fase 3**: PWA (el mismo sitio, instalable en el celular con ícono y pantalla completa vía `manifest.json` + service worker) — decidido en vez de app nativa por costo/esfuerzo (sin cuentas de desarrollador de pago, mismo código que el sitio).
- **Fase 4**: narración en video/reels con voz IA (ElevenLabs — voces "Abel" hombre y "Angelica" mujer ya elegidas por el usuario, archivos de muestra en el proyecto) para dar las noticias en formato corto para redes. Depende del pipeline de esta fase 1 como fuente del texto ya reescrito.

## Cobertura editorial

- **Nacional** (México, general — política, nota roja, espectáculos, deportes, mezcla amplia)
- **Internacional**
- **Trending** (lo más buscado del momento en México, vía Google Trends)

## Fuentes de datos (todas gratis, sin API key, sin límite de requests)

Verificadas por HTTP real (16-sep-2026) contra la lista original que dio el usuario. 4 de las 9 fuentes pedidas no exponen RSS público utilizable:
- **CNN en Español**: sin RSS público (todas las rutas probadas dan 404).
- **Telemundo**: la URL de RSS redirige a la página HTML normal, no hay feed real.
- **Associated Press**: bloquea con 403, no ofrece RSS público gratuito (el wire es solo para clientes de pago).
- **Agencia France-Presse**: sí responde un feed, pero es el blog corporativo de AFP (noticias sobre AFP, en francés), no su cobertura de noticias en español — no sirve.

Se reemplazan por BBC Mundo y DW Español, ambos con RSS público confirmado y cobertura internacional en español de calidad equivalente.

**Actualización (17-sep-2026, tras la corrida real del pipeline):** al ejecutar el pipeline de verdad (no solo `curl`), aparecieron 2 problemas más:
- **El Heraldo** (pedido por el usuario): su URL de RSS dejó de servir XML — ahora regresa la página HTML normal sin importar el User-Agent. Se probaron 6 variantes de URL, ninguna funciona. **Se quitó de la lista** (nacional queda con El Universal, Reforma y Latinus). Pendiente: si el usuario encuentra la URL correcta del RSS actual de El Heraldo, se vuelve a agregar.
- **DW Español**: el servicio `rss.dw.com` ya no reconoce ningún feed ("Error: no feed by that name" en cualquier ruta probada) — parece un servicio de RSS discontinuado por DW. **Se reemplazó por Euronews en español**, mismo perfil editorial (noticias internacionales serias), RSS confirmado funcionando.
- **Latinus** (YouTube): `feedparser` por sí solo recibía 404 de YouTube sin un User-Agent de navegador (aunque `curl` con `-A "Mozilla/5.0"` sí funcionaba) — el pipeline ahora jala cada feed con `requests` mandando un User-Agent explícito y le pasa los bytes ya descargados a `feedparser`, en vez de dejar que `feedparser` haga la petición HTTP él mismo.

**Actualización (17-sep-2026, revisión final de rama):** el `channel_id` de Latinus usado hasta este punto (`UCjmSHs_B8h2E2wLiCKu7oWQ`) resultó estar mal identificado — traía videos random (gaming, comida) sin relación con el medio, aunque el feed reportaba `title: "latinus"`. El usuario confirmó el canal real vía `https://latinus.us/` → link a `youtube.com/channel/UC-FVhfqCwhzpJ4DTJOMMofA` ("Latinus_us", contenido real verificado: "Loret en Latinus", segmentos #ObjetivoCiudadano). **Corregido a `UC-FVhfqCwhzpJ4DTJOMMofA`.**

| Categoría | Fuente | URL del feed |
| --- | --- | --- |
| Nacional | El Universal | `https://www.eluniversal.com.mx/arc/outboundfeeds/rss/` |
| Nacional | Reforma | `https://www.reforma.com/rss/portada.xml` |
| Nacional | Latinus (canal de YouTube, sin feed de texto propio) | `https://www.youtube.com/feeds/videos.xml?channel_id=UC-FVhfqCwhzpJ4DTJOMMofA` |
| Internacional | El País | `https://elpais.com/rss/elpais/portada.xml` |
| Internacional | BBC Mundo | `https://feeds.bbci.co.uk/mundo/rss.xml` |
| Internacional | Euronews (español) | `https://es.euronews.com/rss?level=theme&name=news` |
| Internacional | Google News (sección internacional, español México) | `https://news.google.com/rss?hl=es-419&gl=MX&ceid=MX:es-419` |
| Trending | Google Trends (diario, México) | `https://trends.google.com/trending/rss?geo=MX` |

Justificación: NewsAPI.org en tier gratis prohíbe uso en producción/comercial y retrasa artículos 24h; Currents API gratis limita a 600 requests/mes. RSS directo no tiene esas restricciones y da control exacto sobre qué medios se incluyen.

## Arquitectura

```
pipeline/fetch_news.py   → jala RSS, dedup, llama a OpenAI, escribe news.json
historial.json           → URLs ya procesadas (evita repetir notas)
news.json                → salida: notas listas para el frontend
.github/workflows/update_news.yml → cron cada 6h: corre el script, commitea y pushea
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

## Seguridad

- El contenido de las notas viene de RSS externo + reescritura por IA — no es confiable. El frontend debe **escapar** título/resumen/cuerpo/fuente (incluyendo comillas, no solo `<`/`>`) antes de insertarlos en el DOM, tanto en texto como dentro de atributos HTML, para evitar XSS si algún feed o la salida del modelo trae HTML/JS embebido.
- El `link` de cada nota también debe validarse antes de usarlo como `href` — solo permitir `http:`/`https:`, nunca asignar el valor crudo (podría venir un esquema `javascript:` malicioso desde el feed).

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
