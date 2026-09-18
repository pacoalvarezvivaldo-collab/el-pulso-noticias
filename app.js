const CAT_LABEL = {
  nacional: 'Nacional', internacional: 'Internacional', trending: 'Trending',
  'puerto-vallarta': 'Puerto Vallarta', 'bahia-banderas': 'Bahía de Banderas',
  jalisco: 'Jalisco', nayarit: 'Nayarit',
};
const CAT_COLOR = {
  nacional: 'var(--cat-nacional)', internacional: 'var(--cat-internacional)', trending: 'var(--cat-trending)',
  'puerto-vallarta': 'var(--cat-regional)', 'bahia-banderas': 'var(--cat-regional)',
  jalisco: 'var(--cat-regional)', nayarit: 'var(--cat-regional)',
};

// Su sitio (Minuto a Minuto) etiqueta el mismo artículo en más de una
// región (ej. Puerto Vallarta también Jalisco) — categoriasTodas trae la
// lista completa para juntarlas en el badge, en vez de mostrar solo la
// primera y esconder que también aplica a la otra.
function catLabel(n) {
  if (n.categoriasTodas && n.categoriasTodas.length > 1) {
    return n.categoriasTodas.map(c => CAT_LABEL[c]).join(' · ');
  }
  return CAT_LABEL[n.categoria];
}

// Las notas vienen de RSS externo + reescritura por IA (fuente no confiable) —
// escapar siempre antes de insertar en innerHTML para evitar XSS. div.innerHTML
// no escapa comillas, y estos valores también se usan dentro de atributos
// (data-id="..."), así que hace falta un escaper completo, no solo de texto.
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Solo permite abrir enlaces http(s) — bloquea esquemas como javascript:
// que podrían venir de un link malicioso en el RSS o en la salida de la IA.
function safeUrl(link) {
  try {
    const u = new URL(link, location.href);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch {
    return null;
  }
}

let NOTAS = [];
let activeCat = 'todas';
let searchQuery = '';

// Sin acentos ni mayúsculas para que "trafico" encuentre "tráfico".
function normalizar(str) {
  return String(str ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function buscar(query) {
  searchQuery = query.trim();
  render();
}

// Notas subidas a mano por el cliente vía panel.html, servidas por Convex.
// Si Convex no responde (backend caído, URL sin configurar) el sitio sigue
// funcionando solo con las notas del pipeline automático.
async function cargarNotasManual() {
  if (typeof CONVEX_HTTP_URL === 'undefined' || CONVEX_HTTP_URL.includes('REEMPLAZAR')) return [];
  try {
    const res = await fetch(CONVEX_HTTP_URL + '/api/notas');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function cargarBanners() {
  if (typeof CONVEX_HTTP_URL === 'undefined' || CONVEX_HTTP_URL.includes('REEMPLAZAR')) return [];
  try {
    const res = await fetch(CONVEX_HTTP_URL + '/api/banners');
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

function bannerHtml(b) {
  const img = `<img class="banner-img" src="${esc(safeUrl(b.imagenUrl) ?? '')}" alt="Publicidad" loading="lazy">`;
  const url = b.linkUrl ? safeUrl(b.linkUrl) : null;
  return url
    ? `<a class="banner-link" href="${esc(url)}" target="_blank" rel="noopener sponsored">${img}</a>`
    : img;
}

let bannerRotTimer = null;
let hayBanners = false;

// El sidebar tiene dos inquilinos independientes (banner de anuncios y la
// lista "Más noticias") que se activan en momentos distintos — se oculta
// solo si ninguno de los dos tiene contenido, nunca por uno solo.
function actualizarSidebarVisible() {
  const sidebarMore = document.getElementById('sidebarMore');
  document.getElementById('sidebar').hidden = !hayBanners && sidebarMore.hidden;
}

// Con varios banners activos se muestra uno a la vez (rotando), no todos
// apilados uno tras otro — cada anunciante se ve igual de seguido. En
// móvil además se puede navegar a mano (flechas o swipe) sin perder la
// rotación automática: cada navegación manual solo reinicia el conteo de
// 8s, no la desactiva.
function renderBanners(banners) {
  const mobileBanner = document.getElementById('mobileBanner');
  const mobileSlide = document.getElementById('mobileBannerSlide');
  const prevBtn = document.getElementById('mobileBannerPrev');
  const nextBtn = document.getElementById('mobileBannerNext');

  if (bannerRotTimer) { clearInterval(bannerRotTimer); bannerRotTimer = null; }

  hayBanners = banners.length > 0;
  actualizarSidebarVisible();

  if (!banners.length) {
    mobileBanner.hidden = true;
    document.body.classList.remove('has-mobile-banner');
    mobileSlide.innerHTML = '';
    return;
  }

  mobileBanner.hidden = false;
  document.body.classList.add('has-mobile-banner');
  prevBtn.hidden = banners.length < 2;
  nextBtn.hidden = banners.length < 2;

  let i = 0;
  const mostrar = () => {
    const html = bannerHtml(banners[i]);
    document.getElementById('sidebarBanners').innerHTML = html;
    mobileSlide.innerHTML = html;
  };
  const reiniciarTimer = () => {
    if (bannerRotTimer) clearInterval(bannerRotTimer);
    if (banners.length > 1) {
      bannerRotTimer = setInterval(() => avanzar(1), 8000);
    }
  };
  const avanzar = (delta) => {
    i = (i + delta + banners.length) % banners.length;
    mostrar();
    reiniciarTimer();
  };

  mostrar();
  reiniciarTimer();

  prevBtn.onclick = () => avanzar(-1);
  nextBtn.onclick = () => avanzar(1);

  let touchStartX = null;
  mobileBanner.ontouchstart = (e) => { touchStartX = e.touches[0].clientX; };
  mobileBanner.ontouchend = (e) => {
    if (touchStartX === null || banners.length < 2) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) avanzar(dx < 0 ? 1 : -1);
    touchStartX = null;
  };
}

// Zona horaria fija de Puerto Vallarta, sin importar dónde esté el visitante
// (así todos ven la misma hora, la del medio, no la de su dispositivo).
const TZ_VALLARTA = 'America/Mexico_City';

function fmtHora(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: TZ_VALLARTA });
}

function fmtFecha(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ_VALLARTA });
}

function setActiveCat(cat) {
  activeCat = cat;
  searchQuery = '';
  document.getElementById('searchInput').value = '';
  document.querySelectorAll('.nav-pill, .bottom-item, .mobile-menu-item').forEach(el => {
    if (el.dataset.cat) el.classList.toggle('active', el.dataset.cat === cat);
  });
  render();
}

// En Inicio ninguna categoría debe monopolizar la portada (p. ej. si
// Nacional publica mucho más seguido que Trending) — se intercala 1 de
// cada categoría, más reciente primero dentro de cada una.
function mezclarPorCategoria(notas) {
  const grupos = new Map();
  for (const n of [...notas].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))) {
    if (!grupos.has(n.categoria)) grupos.set(n.categoria, []);
    grupos.get(n.categoria).push(n);
  }
  const listas = [...grupos.values()];
  const mezcla = [];
  for (let i = 0; listas.some(l => i < l.length); i++) {
    for (const lista of listas) {
      if (i < lista.length) mezcla.push(lista[i]);
    }
  }
  return mezcla;
}

// Lo que Evaristo sube desde el panel tiene prioridad SOLO 24h desde que
// la publica — pasado ese tiempo pasa a segundo plano y compite en orden
// normal con las notas automáticas del pipeline (sigue existiendo, solo
// deja de estar fijada arriba).
const VENTANA_PRIORIDAD_MS = 24 * 60 * 60 * 1000;
function esPrioritaria(n) {
  return n.esManual && (Date.now() - new Date(n.fecha).getTime()) < VENTANA_PRIORIDAD_MS;
}

function render() {
  if (searchQuery) {
    const q = normalizar(searchQuery);
    const resultados = NOTAS
      .filter(n => normalizar(n.titulo).includes(q) || normalizar(n.resumen).includes(q))
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    document.getElementById('feedTitle').textContent = `Resultados para "${searchQuery}"`;
    document.getElementById('hero').innerHTML = '';
    renderMasNoticias([]);
    if (!resultados.length) {
      document.getElementById('cardGrid').innerHTML = '<p class="search-empty">Sin resultados.</p>';
      return;
    }
    renderGrid(resultados);
    return;
  }

  const filtradas = activeCat === 'todas' ? NOTAS : NOTAS.filter(n => n.categoria === activeCat);

  const manuales = filtradas.filter(esPrioritaria).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const automaticas = filtradas.filter(n => !esPrioritaria(n));
  const restoOrdenado = activeCat === 'todas'
    ? mezclarPorCategoria(automaticas)
    : [...automaticas].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const ordenadas = [...manuales, ...restoOrdenado];

  const destacada = ordenadas.find(n => n.destacada) || ordenadas[0];
  const resto = ordenadas.filter(n => n !== destacada);

  document.getElementById('feedTitle').textContent =
    activeCat === 'todas' ? 'Últimas noticias' : CAT_LABEL[activeCat];

  renderHero(destacada, resto.slice(0, 3));
  const gridItems = resto.slice(3, 19); // hero(1) + laterales(3) + grid(16) = 20 notas visibles
  renderGrid(gridItems.length ? gridItems : resto.slice(0, 6));
  // Notas que ya existen (más viejas, dentro de la ventana de 4 días) pero
  // se quedaban sin mostrarse en ningún lado — llenan el sidebar en vez de
  // desperdiciarse. Mismo criterio en Inicio/Nacional/Internacional/Trending.
  renderMasNoticias(resto.slice(19, 27));
}

function renderMasNoticias(items) {
  const wrap = document.getElementById('sidebarMore');
  const list = document.getElementById('sidebarMoreList');
  wrap.hidden = items.length === 0;
  actualizarSidebarVisible();
  if (!items.length) { list.innerHTML = ''; return; }
  list.innerHTML = items.map(n => `
    <div class="sidebar-more-item" data-id="${esc(n.id)}">
      <span class="sidebar-more-cat" style="color:${CAT_COLOR[n.categoria]}">${catLabel(n)}</span>
      <div class="sidebar-more-title">${esc(n.titulo)}</div>
      <div class="sidebar-more-meta">${fmtHora(n.fecha)}</div>
    </div>
  `).join('');
  list.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => openModal(el.dataset.id)));
}

function renderHero(destacada, laterales) {
  const hero = document.getElementById('hero');
  if (!destacada) { hero.innerHTML = ''; return; }
  hero.innerHTML = `
    <div class="hero-main" data-id="${esc(destacada.id)}">
      <div class="hero-photo"${destacada.imagenUrl ? ` style="background-image:url('${esc(safeUrl(destacada.imagenUrl) ?? '')}');background-size:cover;background-position:center"` : ''}>
        <span class="hero-badge" style="background:${CAT_COLOR[destacada.categoria]}">${catLabel(destacada)}</span>
      </div>
      <h1 class="hero-title">${esc(destacada.titulo)}</h1>
      <p class="hero-deck">${esc(destacada.resumen)}</p>
      <div class="hero-meta">${fmtHora(destacada.fecha)} · El Pulso Noticias</div>
    </div>
    <div class="hero-side">
      ${laterales.map(n => `
        <div class="hero-side-item" data-id="${esc(n.id)}">
          <span class="card-badge-inline" style="color:${CAT_COLOR[n.categoria]}; font-family:'Archivo',sans-serif; font-weight:800; font-size:10.5px; letter-spacing:.12em; text-transform:uppercase;">${catLabel(n)}</span>
          <div class="hero-side-title">${esc(n.titulo)}</div>
          <div class="card-meta">${fmtHora(n.fecha)}</div>
        </div>
      `).join('')}
    </div>
  `;
  hero.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => openModal(el.dataset.id)));
}

function renderGrid(notas) {
  const grid = document.getElementById('cardGrid');
  grid.innerHTML = notas.map(n => `
    <div class="card" data-id="${esc(n.id)}">
      <div class="card-photo"${n.imagenUrl ? ` style="background-image:url('${esc(safeUrl(n.imagenUrl) ?? '')}');background-size:cover;background-position:center"` : ''}>
        <span class="card-badge" style="background:${CAT_COLOR[n.categoria]}">${catLabel(n)}</span>
      </div>
      <div class="card-title">${esc(n.titulo)}</div>
      <div class="card-deck">${esc(n.resumen)}</div>
      <div class="card-meta">${fmtHora(n.fecha)} · El Pulso Noticias</div>
    </div>
  `).join('');
  grid.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => openModal(el.dataset.id)));
}

function renderTicker() {
  const manuales = NOTAS.filter(esPrioritaria).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const automaticas = NOTAS.filter(n => !esPrioritaria(n)).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const ordenadas = [...manuales, ...automaticas].slice(0, 15);
  const items = ordenadas.map(n => `
    <a href="#" class="ticker-item" data-id="${esc(n.id)}">
      <span class="t-time">${fmtHora(n.fecha)}</span>${esc(n.titulo)}<span style="opacity:.5">/</span>
    </a>
  `).join('');
  const inner = document.getElementById('tickerInner');
  inner.innerHTML = items + items;
  inner.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', (e) => {
    e.preventDefault();
    openModal(el.dataset.id);
  }));
}

function openModal(id, actualizarUrl = true) {
  const n = NOTAS.find(x => x.id === id);
  if (!n) return;
  document.getElementById('modalCat').textContent = catLabel(n);
  document.getElementById('modalCat').style.background = CAT_COLOR[n.categoria];
  document.getElementById('modalTitle').textContent = n.titulo;
  document.getElementById('modalMeta').textContent = `${fmtHora(n.fecha)} · El Pulso Noticias`;
  const img = document.getElementById('modalImage');
  const imgUrl = n.imagenUrl ? safeUrl(n.imagenUrl) : null;
  if (imgUrl) { img.src = imgUrl; img.hidden = false; } else { img.hidden = true; img.removeAttribute('src'); }
  document.getElementById('modalBody').textContent = n.cuerpo;

  const shareUrl = new URL(location.href);
  shareUrl.hash = '';
  shareUrl.searchParams.set('nota', n.id);
  setupShare(n, shareUrl.href);

  if (actualizarUrl) history.pushState({ nota: n.id }, '', shareUrl);
  document.getElementById('modalOverlay').hidden = false;
}

function setupShare(n, url) {
  const texto = `${n.titulo} — El Pulso Noticias`;
  document.getElementById('shareX').href =
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(texto)}&url=${encodeURIComponent(url)}`;
  document.getElementById('shareFb').href =
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  document.getElementById('shareWa').href =
    `https://api.whatsapp.com/send?text=${encodeURIComponent(texto + ' ' + url)}`;
  // Instagram no tiene un link de "compartir" web como los demás — solo se
  // comparte desde su app. Copiamos texto+link al portapapeles para que el
  // usuario lo pegue en una historia o DM.
  const igBtn = document.getElementById('shareIg');
  igBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(`${texto} ${url}`);
      igBtn.textContent = 'Copiado ✓';
    } catch {
      igBtn.textContent = 'No se pudo copiar';
    }
    setTimeout(() => { igBtn.textContent = 'Instagram'; }, 2000);
  };
}

function closeModal() {
  document.getElementById('modalOverlay').hidden = true;
  const url = new URL(location.href);
  if (url.searchParams.has('nota')) {
    url.searchParams.delete('nota');
    history.pushState({}, '', url);
  }
}

function updateClock() {
  const el = document.getElementById('liveClock');
  if (el) el.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: TZ_VALLARTA });
}

// Algunos navegadores móviles ponen su propia barra de botones abajo (otros
// arriba) y la muestran/ocultan al hacer scroll — cuando aparece abajo tapa
// nuestro nav+banner fijos. window.visualViewport reporta el área visible
// real descontando esa barra; la diferencia contra innerHeight es cuánto
// hay que subir nuestros elementos para que queden encima, no escondidos
// detrás. Si el navegador no soporta visualViewport, el offset se queda en
// 0 y el comportamiento es el de antes (bottom:0 fijo).
function ajustarPorBarraDelNavegador() {
  const vv = window.visualViewport;
  if (!vv) return;
  const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty('--vv-bottom-offset', `${offset}px`);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', ajustarPorBarraDelNavegador);
  window.visualViewport.addEventListener('scroll', ajustarPorBarraDelNavegador);
  ajustarPorBarraDelNavegador();
}

async function init() {
  document.getElementById('topbarDate').textContent = fmtFecha(new Date());
  updateClock();
  setInterval(updateClock, 30000);

  try {
    const res = await fetch('news.json');
    const data = await res.json();
    const notasPipeline = data.notas ?? [];
    const [notasManual, banners] = await Promise.all([cargarNotasManual(), cargarBanners()]);
    NOTAS = [...notasPipeline, ...notasManual.map(n => ({ ...n, esManual: true }))];
    renderBanners(banners);
    document.getElementById('feedUpdated').textContent = data.generado
      ? 'ACTUALIZADO ' + fmtHora(data.generado)
      : 'Sin actualizar aún';

    renderTicker();
    render();

    const idCompartido = new URLSearchParams(location.search).get('nota');
    if (idCompartido) openModal(idCompartido, false);
  } catch (err) {
    console.error('No se pudieron cargar las noticias:', err);
    document.getElementById('feedTitle').textContent = 'No se pudieron cargar las noticias';
  } finally {
    // Los listeners se enlazan pase lo que pase con el fetch: si news.json
    // falla o llega mal formado, la página no debe quedar muerta (menú,
    // búsqueda, modal, etc. tienen que seguir funcionando).
    document.querySelectorAll('[data-cat]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        setActiveCat(el.dataset.cat);
        document.getElementById('mobileMenu').hidden = true;
      });
    });

    document.getElementById('logoLink').addEventListener('click', (e) => {
      e.preventDefault();
      setActiveCat('todas');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.getElementById('hamburgerBtn').addEventListener('click', () => {
      document.getElementById('mobileMenu').hidden = false;
    });
    // El nav inferior ya no tiene un botón por categoría (con Puerto
    // Vallarta/Bahía de Banderas/Jalisco/Nayarit sumados no caben 9
    // botones) — "Categorías" abre el mismo drawer del hamburguesa, que
    // sí lista todas verticalmente sin problema de espacio.
    document.getElementById('bottomCategoriasBtn').addEventListener('click', () => {
      document.getElementById('mobileMenu').hidden = false;
    });
    document.getElementById('closeMenuBtn').addEventListener('click', () => {
      document.getElementById('mobileMenu').hidden = true;
    });
    const searchBox = document.getElementById('searchBox');
    const searchInput = document.getElementById('searchInput');
    const searchBackdrop = document.getElementById('searchBackdrop');
    // En móvil el buscador es un modal fijo centrado (independiente del
    // scroll, no se anima a mover la página) — el backdrop es el fondo
    // oscuro detrás. En escritorio el backdrop no se ve (CSS lo limita a
    // la media query de móvil), solo importa el popover.
    const abrirBusqueda = () => {
      searchBox.classList.add('open');
      searchBackdrop.hidden = false;
      searchInput.focus();
    };
    const cerrarBusqueda = () => {
      searchBox.classList.remove('open');
      searchBackdrop.hidden = true;
    };
    document.getElementById('searchIconBtn').addEventListener('click', () => {
      if (searchBox.classList.contains('open')) cerrarBusqueda();
      else abrirBusqueda();
    });
    // Antes forzaba scroll al top del sitio al abrir la búsqueda desde el
    // nav inferior — molesto si venías leyendo algo más abajo. El header
    // (y el cuadro de búsqueda que cuelga de él) ya es sticky y siempre
    // está visible en pantalla, así que no hace falta mover el scroll.
    document.getElementById('bottomSearchBtn').addEventListener('click', abrirBusqueda);
    document.getElementById('searchBtn').addEventListener('click', () => buscar(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') buscar(searchInput.value);
    });
    // Si borran el texto (con backspace o la X del input) sin dar Enter,
    // regresa sola al feed normal en vez de quedarse trabada mostrando
    // "sin resultados" de la última búsqueda.
    searchInput.addEventListener('input', () => {
      if (!searchInput.value.trim() && searchQuery) buscar('');
    });
    searchBackdrop.addEventListener('click', cerrarBusqueda);
    document.addEventListener('click', (e) => {
      if (!searchBox.classList.contains('open')) return;
      if (searchBox.contains(e.target) || e.target.id === 'searchIconBtn' || e.target.id === 'bottomSearchBtn') return;
      cerrarBusqueda();
    });
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'modalOverlay') closeModal();
    });

    const infoModal = document.getElementById('infoModalOverlay');
    document.getElementById('quienesSomosLink').addEventListener('click', (e) => {
      e.preventDefault();
      infoModal.hidden = false;
    });
    document.getElementById('infoModalClose').addEventListener('click', () => { infoModal.hidden = true; });
    infoModal.addEventListener('click', (e) => {
      if (e.target === infoModal) infoModal.hidden = true;
    });
  }
}

init();
