<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

# El Pulso Noticias — Memoria del proyecto

Sitio de noticias del cliente Evaristo Tenorio. Categorías: **Nacional**,
**Internacional**, **Trending** (Google Trends México). Contenido reescrito
por IA a partir de RSS — el sitio se presenta como fuente propia, **nunca
se muestra ni se enlaza el medio original** (decisión explícita del
cliente: la reescritura con IA existe justo para que sea "fuente propia").

## Arquitectura

```
pipeline/fetch_news.py         RSS → reescritura OpenAI (gpt-4o-mini) → news.json
historial.json / news.json     estado del pipeline (recorte 4 días, máx 20/categoría)
.github/workflows/update_news.yml   cron cada 6h (0 */6 * * *, UTC), commitea y pushea
index.html / style.css / app.js     sitio estático (GitHub Pages), lee news.json + Convex
convex/                        backend del panel (notas manuales + banners)
panel.html / panel.js / panel.css   panel del cliente (login con password compartida)
```

**Repo:** `github.com/pacoalvarezvivaldo-collab/el-pulso-noticias` (público).
**Sitio:** https://el-pulso-noticias.vercel.app/ (Vercel, proyecto `paco-v/el-pulso-noticias` — deploy automático en cada push a `master`, sin build step, cache-control `max-age=0` así que se refresca casi al instante, sin el límite fijo de 10 min de GitHub Pages).
**Panel:** https://el-pulso-noticias.vercel.app/panel.html
**Convex prod:** `pacoalvarezvivaldo:evaristo-el-pulso-noticias:production` — `https://beaming-koala-776.convex.cloud` (cliente) / `https://beaming-koala-776.convex.site` (HTTP actions, es lo que usan `panel.js`/`app.js` vía `convex-config.js`).

**GitHub Pages: apagado (18-sep-2026)** — el sitio se movió a Vercel por el
límite fijo de caché de 10 min de GH Pages (sin forma de configurarlo).
`.github/workflows/update_news.yml` sigue igual (sigue pusheando
`news.json`/`historial.json` al repo), Vercel solo cambia dónde se sirve
el resultado — no hay nada de Vercel que configurar en el pipeline.

El pipeline (`OPENAI_API_KEY`) corre como GitHub Actions Secret del repo, no
en local. Convex ya tiene `npx convex login` hecho en esta máquina — para
desplegar cambios de `convex/` basta `npx convex deploy -y` desde este
directorio, no hace falta dejar ninguna terminal abierta después.

**Gotcha ya resuelto pero a tener en cuenta:** el workflow de Actions
(`update_news.yml`) quedó huérfano y NUNCA se registró en GitHub desde el
primer push del repo (efecto colateral del primer intento de push que
falló por falta del scope `workflow` en el token de `gh`) — corrió cero
veces en automático hasta que lo noté (18-sep-2026) y forcé un commit
trivial al archivo para que GitHub lo reindexara. Si algún workflow nuevo
parece "no correr nunca", revisar primero `gh api repos/.../actions/workflows`
para confirmar que GitHub realmente lo tiene registrado.

## Panel del cliente (Evaristo)

Login de contraseña única compartida (`PANEL_PASSWORD`, env var en Convex
prod — ya la cambió el cliente, no queda en texto plano en el repo). Dos
pestañas:
- **Nota**: categoría + título + resumen + cuerpo + imagen opcional → se
  mezcla con las notas del pipeline en la misma categoría. Tiene
  **prioridad solo 24h** desde que se publica (queda fija arriba de
  hero/grid/ticker); pasadas las 24h compite en orden normal, sigue
  existiendo hasta que Convex la recorte a los 4 días (igual que las del
  pipeline).
- **Banner**: imagen + link opcional + **vigencia en días opcional** →
  aparece en la barra lateral del sitio (desktop) y como banner inline
  arriba del feed (móvil). Con varios banners activos **rotan uno a la
  vez cada 8s**, no se apilan. Sin vigencia especificada, el banner es
  permanente hasta que Evaristo lo borre a mano.

Backend: tablas Convex `notasManual` y `banners`, HTTP actions en
`convex/http.ts` (`/api/notas`, `/api/subir-imagen-url`, `/api/banners`,
`/api/banners/eliminar`) con CORS abierto porque panel/sitio son HTML/JS
plano sin SDK de Convex, en otro dominio (GitHub Pages). `convex/crons.ts`
tiene 2 cron diarios: borra notas manuales vencidas (+4 días) y banners
vencidos (si tienen `expiraEn`), liberando también su imagen de storage
en ambos casos — antes de esto las imágenes huérfanas se quedaban para
siempre (fuga de storage ya corregida).

**Bug real ya corregido (18-sep-2026):** `GET /api/notas` de Convex
devuelve el array directo, pero `app.js` esperaba `{notas: [...]}` —
`data.notas` daba `undefined` y las notas del panel **nunca se mostraban**
en el sitio, desde que se armó el panel, sin ningún error visible. No era
caché del navegador. Ya arreglado (`Array.isArray(data) ? data : []`).

## Imágenes de las notas del pipeline

`pipeline/noticias.py::_imagen_de_entry` lee `media:thumbnail` /
`media:content` / `enclosure` ya embebidos en el RSS de cada entrada (sin
red extra), y para Google Trends lee `ht:picture` (namespace propio de ese
feed, feedparser lo expone como `entry.ht_picture`). Si el feed no trae
nada, `fetch_news.py::obtener_imagen_og` intenta sacar el `og:image` de la
página del artículo original como último recurso (regex simple, sin
dependencia de parser HTML, timeout 8s, nunca bloquea el pipeline).

Cobertura real verificada (18-sep-2026): El Universal/Reforma/BBC
Mundo/Euronews ~100%, Google Trends 100% vía `ht:picture` una vez que cada
nota se reprocesa. **Google News se queda en 0%** — sus links son
redirects que necesitan JavaScript para resolver al artículo real, no se
puede sacar `og:image` con una petición HTTP simple; solución real
requeriría un navegador headless (no implementado, fuera de alcance por
ahora). Notas viejas (de antes de estos fixes) no ganan imagen
retroactivamente, solo las que se procesan de aquí en adelante.

## Decisiones de diseño ya tomadas

- **Paleta de marca** (del logo): morado `#6a3fa0`, naranja `#f7941d`→`#e8531f`,
  azul `#3b6fe0`, rojo `#e23b3b`. Categorías: nacional=azul,
  internacional=morado, trending=naranja. Barra de acento con los 4 colores
  arriba del header; nav/bottom-nav colorean su pill activo según categoría.
- **Sin atribución a medios originales** en la UI — nunca mostrar `fuente`
  real ni link "ver nota original"; todo dice "El Pulso Noticias".
- **Hora/fecha del sitio fija a Puerto Vallarta** (`America/Mexico_City`),
  no la del dispositivo del visitante.
- **Inicio (pestaña "Todas")** mezcla 1 de cada categoría (round-robin) para
  que ninguna domine la portada — las pestañas de categoría sí van en
  orden de más reciente a menos reciente. **20 notas visibles** (hero + 3
  laterales + 16 en grid).
- Cada nota tiene link propio (`?nota=<id>`) con botones de compartir
  reales (X, Facebook, WhatsApp) + Instagram (copia texto+link, esa red no
  tiene intent de compartir web).
- **Banners publicitarios**: al hacer click van al link que Evaristo haya
  puesto al subirlo (opcional) — si no le puso link, no es clickeable.
- **Búsqueda (18-sep-2026)**: la caja de búsqueda era decorativa (sin
  listener real). Ahora es un botón chico (lupa) que abre un popover
  colgado del header (sticky, siempre visible, no hace falta forzar
  scroll al abrir) → filtra `NOTAS` por título/resumen normalizado (sin
  acentos/mayúsculas) → resultados reemplazan hero+grid. Si borran el
  texto sin dar Enter, regresa sola al feed normal (antes se quedaba
  trabada). En `app.js`: `buscar()`, `normalizar()`, rama `searchQuery` de
  `render()`.
- **Logo del header con "zoom" (18-sep-2026)**: `LOGO.PNG` trae mucho
  fondo/circuitos alrededor del texto — se ve chico si se muestra completo.
  `.logo-link.brand-center` es una caja fija (68px alto desktop / 48px
  móvil) con `overflow:hidden`, y `.logo-img` usa
  `object-fit:cover; object-position:50% 51%` para recortar solo la franja
  con "El Pulso Noticias" (el subtítulo "Digital News" y el reflejo de
  abajo quedan fuera). Mismo alto que antes, no crece el header.
- **Sidebar "Más noticias" (18-sep-2026)**: el costado se veía muy vacío
  bajo el banner. Las notas 21-28 de cada categoría (`resto.slice(19,27)`
  en `render()`, `app.js`) — existen dentro de la ventana de 4 días pero no
  entraban en el hero+grid de 20 — se listan ahí. Aplica en Inicio,
  Nacional, Internacional y Trending; se oculta solo si esa categoría no
  llega a 20 notas (ej. Trending con poco contenido). Solo escritorio (el
  sidebar ya no se muestra en móvil). El sidebar completo se oculta solo
  si NO hay banner Y NO hay "más noticias" (antes solo dependía del
  banner) — ver `actualizarSidebarVisible()`.
- **Banner ancla en móvil (18-sep-2026)**: antes vivía inline en el feed
  con su alto natural (se veía "a lo largo", se iba con el scroll). Ahora
  es franja fija de 64px pegada arriba del nav inferior, recortada con
  `object-fit:cover`. Con más de un banner: flechas ‹› + swipe táctil
  (sigue rotando cada 8s de fondo, navegar a mano solo reinicia el
  conteo). Además usa `window.visualViewport` (`--vv-bottom-offset` en
  `app.js`/`style.css`) para subir nav+banner cuando el navegador móvil
  muestra su propia barra de botones (algunos la ponen abajo y tapaba lo
  nuestro) — no se pudo probar en dispositivo real, solo verificado que no
  rompe nada y que la variable se calcula bien.

## Pendiente / decisiones abiertas con el cliente

- **RESUELTO (18-sep-2026): fotos de Trending que no se veían.** Causa
  confirmada: link sintético por título (`google.com/search?q=<título>`)
  quedaba "ya visto" en `historial.json` desde antes del fix de
  `ht:picture`, así que nunca se reprocesaba. Se intentó backfill manual
  (purgar esas 11 claves de `historial.json`) pero el cron automático
  (cada 6h) ya había rotado el contenido solo antes de que el backfill se
  pudiera pushear (conflicto de merge al hacer `git push` → se descartó el
  backfill local, innecesario). Verificado en `news.json` del remoto:
  **Trending 20/20 con imagen**. Internacional subió a 16/20 (el resto es
  Google News, ver abajo — límite conocido, no bug).
- **RESUELTO (18-sep-2026): redes sociales reales de Evaristo.** Conectadas
  en `index.html` (topbar-social, mobile-menu-social, footer-social):
  Facebook `MinutoAminutoNoticiasVallartaBahia`, TikTok `@minuto.a.minuto.n`,
  Threads `@minuto_a_minuto_noticias_` (nota: marca "Minuto a Minuto
  Noticias Vallarta Bahía", no "El Pulso Noticias" — confirmado explícito
  por el cliente que son sus links reales, no error). No dio link de X ni
  de WhatsApp: el espacio de X se reusó para Threads, WhatsApp (solo existía
  en topbar) queda "Pendiente" hasta que lo pase.
- **RESUELTO (18-sep-2026): dominio propio conectado.** Sitio ya sirve en
  `https://www.elpulsonoticias.com.mx` (200, HTTPS válido) y
  `https://elpulsonoticias.com.mx` (redirige 308 al de `www`) — panel
  también funciona ahí (`/panel.html`) sin tocar nada, vive en el mismo
  proyecto de Vercel. `el-pulso-noticias.vercel.app` se dejó activo en
  paralelo (no se configuró redirect hacia el dominio nuevo, decidir si se
  quiere más adelante). Cuenta Cloudflare del cliente
  (`pacoalvarezvivaldo@gmail.com`, account_id
  `9bd9cf14ccad164bd0ebe5a11fff8412`) tiene acceso vía MCP `mcp__cloudflare__*`
  (docs/execute/search) — sirve para DNS y registrar sin pedirle nada al
  cliente. Dos dominios registrados ahí:
  - `elpulsonoticicas.com` (zone `2420ef47e129966a0735708bf3ae998c`) — **typo
    real** del cliente (sobra una "c": notici**c**as), coincide con el
    nombre del archivo suelto `EL pulso noticicas.zip` en la raíz del repo.
    Confirmado con la API del registrar: `is_refundable: false` — los ~$12
    no se recuperan, se borre o no. Plan acordado: NO tirarlo — usarlo como
    redirect gratis (Cloudflare Redirect Rules) hacia el dominio bueno una
    vez conectado, atrapa gente que teclee el mismo typo. Pendiente de
    configurar ese redirect.
  - `elpulsonoticias.com.mx` (zone `560f9f454aa59d98892fea0eaa805eb7`) — el
    real, sin typo, registrado 18-sep-2026, expira 18-sep-2027, ya con
    nameservers de Cloudflare (`buck`/`coraline.ns.cloudflare.com`). `.com`
    no estaba disponible, de ahí el `.com.mx`.
  - **WHOIS sin privacidad en `.com.mx`**: confirmado con
    `registrar/extensions/com.mx` → `privacy_mode` solo acepta `"off"` en
    el schema — es regla de NIC México, no de Cloudflare, no hay forma de
    activarla para ningún `.com.mx`. El nombre/domicilio/teléfono del
    registrante (hoy: Francisco Álvarez, datos de Paco) quedan públicos.
  - **Pendiente que el cliente pidió aplazar**: cambiar el contacto WHOIS
    (al menos el teléfono, posiblemente también nombre/email) para que
    quede el de Evaristo en vez del de Paco. Falta el teléfono de Evaristo
    y confirmar alcance (¿solo teléfono, o todo el contacto?) antes de
    tocarlo vía `PUT /accounts/{account_id}/registrar/domains/{domain}`.
  - **Conectado a Vercel vía navegador (18-sep-2026)**: no hay tool MCP de
    Vercel para adjuntar un dominio a un proyecto (solo `buy_domain`/compra
    propia), y el CLI de Vercel está instalado local pero sin sesión
    (`vercel whoami` → token inválido). Se hizo con `claude-in-chrome`
    (el perfil de Chrome ya tenía sesión iniciada en Vercel): Settings →
    Domains → botón **"Add Existing"** (NO la caja de búsqueda de arriba,
    esa es para comprar dominios nuevos y tira "No matching domains" con
    uno que ya existe — confundió al cliente). DNS puesto por API de
    Cloudflare en la zona de `.com.mx`: `A @ → 76.76.21.21` y
    `CNAME www → cname.vercel-dns.com`, ambos sin proxy (nube gris).
- **Google News sin imagen** — ver sección "Imágenes de las notas del
  pipeline" arriba; decidir si se deja así, se quita como fuente, o se
  justifica meter un navegador headless.
