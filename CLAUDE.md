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
historial.json / news.json     estado del pipeline (recorte 4 días)
.github/workflows/update_news.yml   cron cada 6h (0 */6 * * *, UTC), commitea y pushea
index.html / style.css / app.js     sitio estático (GitHub Pages), lee news.json + Convex
convex/                        backend del panel (notas manuales + banners)
panel.html / panel.js / panel.css   panel del cliente (login con password compartida)
```

**Repo:** `github.com/pacoalvarezvivaldo-collab/el-pulso-noticias` (público, GitHub Pages activo).
**Sitio:** https://pacoalvarezvivaldo-collab.github.io/el-pulso-noticias/
**Panel:** https://pacoalvarezvivaldo-collab.github.io/el-pulso-noticias/panel.html
**Convex prod:** `pacoalvarezvivaldo:evaristo-el-pulso-noticias:production` — `https://beaming-koala-776.convex.cloud` (cliente) / `https://beaming-koala-776.convex.site` (HTTP actions, es lo que usan `panel.js`/`app.js` vía `convex-config.js`).

El pipeline (`OPENAI_API_KEY`) corre como GitHub Actions Secret del repo, no
en local. Convex ya tiene `npx convex login` hecho en esta máquina — para
desplegar cambios de `convex/` basta `npx convex deploy -y` desde este
directorio, no hace falta dejar ninguna terminal abierta después.

## Panel del cliente (Evaristo)

Login de contraseña única compartida (`PANEL_PASSWORD`, env var en Convex
prod — ya la cambió el cliente, no queda en texto plano en el repo). Dos
pestañas:
- **Nota**: categoría + título + resumen + cuerpo + imagen opcional → se
  mezcla con las notas del pipeline en la misma categoría.
- **Banner**: imagen + link opcional → aparece en la barra lateral del
  sitio (desktop) y como banner inline arriba del feed (móvil).

Backend: tablas Convex `notasManual` y `banners`, HTTP actions en
`convex/http.ts` (`/api/notas`, `/api/subir-imagen-url`, `/api/banners`,
`/api/banners/eliminar`) con CORS abierto porque panel/sitio son HTML/JS
plano sin SDK de Convex, en otro dominio (GitHub Pages).

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
  orden de más reciente a menos reciente. 16 notas visibles (hero + 3
  laterales + 12 en grid).
- Cada nota tiene link propio (`?nota=<id>`) con botones de compartir
  reales (X, Facebook, WhatsApp) + Instagram (copia texto+link, esa red no
  tiene intent de compartir web).

## Pendiente

- **Redes sociales reales de Evaristo** — hoy la barra superior/footer
  tienen los íconos como placeholder ("Pendiente"). En cuanto el cliente
  las pase, conectarlas en `index.html` (topbar-social, mobile-menu-social,
  footer-social) y mencionó que esas mismas se usarán como enlaces del
  panel superior.
- **Dominio propio** — sin decidir (ver spec de diseño), por ahora corre en
  la URL gratis de GitHub Pages.
