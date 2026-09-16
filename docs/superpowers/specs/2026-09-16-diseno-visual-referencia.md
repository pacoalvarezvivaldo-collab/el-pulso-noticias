# Análisis de diseño visual de referencia — "Minuto a Minuto Noticias" (Vallarta)

Fuente: canvas de Claude Design compartido por el usuario (`Rediseño sitio noticias Vallarta.zip`, archivo `Minuto a Minuto Sitio.dc.html`). Es un rediseño del sitio real `minutoaminutonoticiasvallartabahia.com`, hecho con datos de ejemplo (placeholders `{{ }}`). Sirve como referencia visual/estructural para el sitio de Evaristo, no se usa tal cual.

## Paleta de color

| Uso | Color |
|---|---|
| Fondo página (detrás del sitio) | `#e9ecf2` |
| Header oscuro / footer | `#05132e` (navy casi negro) |
| Header secundario / bloques oscuros | `#0a1f44` |
| Barra de búsqueda / nav oscuro | `#0f2a58`, `#1d3f76` |
| Acento primario (links, categorías, botones) | `#0e63ff` (azul) |
| Acento urgente ("AL MOMENTO", "LO MÁS LEÍDO") | `#e4121b` (rojo editorial) |
| Texto títulos | `#10182b` / `#0a1f44` |
| Texto cuerpo | `#4b5468` / `#5a6478` |
| Texto meta/mono (fechas, horas) | `#8d97ab` |
| Bordes/separadores | `#e2e6ee` |
| Fondo bloques secundarios (ads, nacional/internacional) | `#f3f5f9` |

Modo oscuro: el prototipo NO lo implementa (fondo fijo claro). Para Evaristo, si se quiere dark mode automático, hay que definir tokens equivalentes aparte.

## Tipografía (Google Fonts)

- **Archivo** (400–800): titulares, etiquetas de categoría, botones, todo lo "editorial fuerte". Casi siempre `font-weight:700-800` con `letter-spacing` negativo en tamaños grandes (titulares) o positivo/amplio en etiquetas pequeñas mayúsculas.
- **Barlow** (400–700): cuerpo de texto, párrafos, inputs.
- **IBM Plex Mono** (400–500): metadatos — hora, fecha, contador de resultados, etiquetas "PUBLICIDAD" — da un aire "de agencia/wire" a los datos técnicos.

## Estructura de la página (desktop, ancho fijo 1280px centrado)

1. **Barra superior de fecha/clima/redes** (`#0a1f44`, 34px alto): fecha completa + ubicación, clima, links Facebook/X/YouTube/WhatsApp.
2. **Header principal** (`#0a1f44`): logo a la izquierda, buscador central, reloj "EN VIVO · ACTUALIZADO" a la derecha (hora grande tipo Archivo 800).
3. **Nav de secciones**: fondo blanco, borde inferior azul marino grueso (4px), links en mayúsculas con subrayado azul al hover.
4. **Ticker "AL MOMENTO"**: franja roja (`#e4121b`) con punto pulsante animado (`mam-pulse`) + texto scrolleando en loop infinito (`mam-ticker`, animación CSS `translateX`) mostrando hora + título de cada nota reciente.
5. **Banner de publicidad** (opcional, placeholder 970×250) — bajo el header.
6. **Hero de portada**: nota principal grande (foto 1600×900, categoría en badge rojo, título 50px) a la izquierda + 3 notas secundarias en columna a la derecha.
7. **"Últimas noticias"**: grid de 4 columnas, tarjetas con foto/categoría/hora/título.
8. **Cuerpo en 2 columnas** (contenido 1fr + sidebar 320px fijo):
   - Bloques por sección (en el original: Puerto Vallarta, Bahía de Banderas — geográficos) con 1 nota destacada + 4 notas laterales en lista.
   - Bloque Jalisco/Nayarit en 2 columnas de lista simple.
   - Bloque Nacional/Internacional: fondo gris claro, 2 columnas, solo títulos en lista (sin imagen) — **este bloque es el más relevante para Evaristo**.
   - Publicidad nativa/patrocinada intercalada (opcional).
   - Sidebar: "LO MÁS LEÍDO" (ranking numerado 1-5, número azul grande), banner de anuncio "vertical" 300×600 sticky, caja "Anúnciate con nosotros", "Información útil" (clima/dólar/marea/gasolina — muy local, no aplica a Evaristo), caja de newsletter.
9. **Vista de categoría**: header de categoría en badge negro grande + nota destacada + grid 2 columnas de notas + botón "CARGAR MÁS NOTICIAS" + mismo sidebar.
10. **Vista de artículo**: breadcrumb, categoría, título 48px, bajada (deck), barra de autor+fecha+compartir (FB/WhatsApp/X/Copiar enlace), foto principal, cuerpo con blockquote destacado (borde azul izquierdo), foto de publicidad intercalada, imágenes relacionadas 2 columnas, "Noticias relacionadas" 3 columnas, sección de comentarios simple.
11. **Vista de búsqueda**: lista de resultados en filas (imagen + categoría + título + deck + hora).
12. **Footer** (`#05132e`): logo + descripción + redes, 3 columnas de links (Secciones / El medio / Contacto), línea de copyright.

## Versión móvil (390px)

Replica los mismos patrones con layout de una columna:
- Header sticky con botón hamburguesa, logo centrado, botón de búsqueda.
- Nav horizontal con scroll (`overflow-x:auto`), pastillas oscuras.
- Mismo ticker "AL MOMENTO" pero más compacto.
- Menú lateral tipo overlay a pantalla completa (`menuOpen`) con lista de secciones y redes.
- Artículo: mismo patrón que desktop pero apilado, botones de compartir en fila completa.
- Feed principal: tarjetas apiladas con foto/categoría/hora/título/deck.

## Elementos a conservar para Evaristo Minuto a Minuto

- Franja roja "AL MOMENTO" con ticker animado — encaja perfecto con el concepto minuto-a-minuto y con Google Trends para la pestaña "Trending".
- Reloj "EN VIVO · ACTUALIZADO" en el header — buena señal de frescura para el usuario.
- Sidebar "LO MÁS LEÍDO" — se puede alimentar con conteo de clicks o simplemente con las notas más recientes/relevantes si no hay analítica aún.
- Paleta navy + rojo + azul + tipografía Archivo/Barlow/IBM Plex Mono — se adapta directo, es un sistema visual serio tipo noticiero, coincide con el tono "presentador profesional" que ya definiste para el prompt de reescritura.
- Estructura de tarjeta (categoría en badge de color + título + hora) para todas las notas.
- Vista de artículo con modal/página de "Leer más" mostrando cuerpo completo reescrito por IA, botones de compartir.

## Elementos a quitar/adaptar (son específicos de Vallarta, medio local)

- Secciones geográficas "Puerto Vallarta" / "Bahía de Banderas" / "Jalisco" / "Nayarit" → reemplazar por **Nacional / Internacional / Trending** (las 3 categorías reales del proyecto).
- Widget "Información útil" (clima, marea, gasolina, dólar Vallarta) → no aplica; se puede quitar o cambiar por algo genérico (ej. dólar nacional) si se quiere mantener el bloque.
- Bloques de publicidad/patrocinios/"Anúnciate con nosotros" → dejar como placeholders opcionales, no hay modelo de ads todavía.
- Sección de comentarios → fuera de alcance por ahora (implica backend/moderación).
- Newsletter con suscripción por correo → fuera de alcance fase 1 (implica backend de emails).
- Fotos reales: el prototipo usa placeholders a rayas — en Evaristo, la fuente RSS normalmente trae `enclosure`/imagen destacada del medio original; si no hay imagen, usar un placeholder de color liso con el nombre del medio (evitar mostrar "FOTO 1600×900" en producción).

## Captura del sitio real (no del prototipo)

La captura adjunta (`uploads/Captura de pantalla...png`) es del sitio **real** en producción, no del canvas rediseñado. Difiere del prototipo en varios puntos:
- Nav principal en **rojo** (no navy) con texto blanco.
- Fotos reales de eventos/funcionarios en cada tarjeta, no placeholders.
- Widget de **video embebido** (YouTube) en el sidebar, autoría "Redacción" con avatar genérico.
- Widget de **clima real** (icono + temperatura + pronóstico 3 días) con diseño tipo tarjeta azul cielo.
- Banners de publicidad de negocios locales reales (taquería, spa/estética) intercalados entre bloques de noticias — confirma el modelo de monetización con anunciantes locales, irrelevante para Evaristo por ahora.
- Etiquetas dobles por nota: "Destacado" + categoría geográfica (ej. "Puerto Vallarta", "Bahía de Banderas").

Para Evaristo, el prototipo (canvas) es la referencia de diseño a seguir (paleta navy/rojo/azul más seria y "de agencia de noticias"); la captura del sitio real solo confirma que el patrón de tarjeta+categoría+fecha+autor y los widgets de sidebar (video, clima) son parte del género "sitio de noticias local", pero no se replican salvo el patrón de tarjeta.

## Notas técnicas del archivo fuente

- El `.dc.html` usa un motor propio de Claude Design (`support.js`, tags `sc-if`/`sc-for`, `{{ }}` bindings) — **no es HTML/CSS/JS reutilizable tal cual**. Sirve solo como referencia visual/de maquetación; el frontend real de Evaristo (`index.html`/`style.css`/`app.js` plano, según el spec de arquitectura) se construye desde cero replicando estos estilos con datos reales de `news.json`.
- Animaciones clave a portar: `@keyframes mam-ticker` (scroll infinito del ticker) y `@keyframes mam-pulse` (punto rojo pulsante).
