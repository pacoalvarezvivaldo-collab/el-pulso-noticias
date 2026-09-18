const CAT_LABEL = { nacional: 'Nacional', internacional: 'Internacional', trending: 'Trending' };
const CAT_COLOR = { nacional: 'var(--cat-nacional)', internacional: 'var(--cat-internacional)', trending: 'var(--cat-trending)' };

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

// Con varios banners activos se muestra uno a la vez (rotando), no todos
// apilados uno tras otro — cada anunciante se ve igual de seguido.
function renderBanners(banners) {
  const sidebar = document.getElementById('sidebar');
  if (bannerRotTimer) { clearInterval(bannerRotTimer); bannerRotTimer = null; }
  if (!banners.length) {
    sidebar.hidden = true;
    document.getElementById('mobileBanner').innerHTML = '';
    return;
  }
  sidebar.hidden = false;

  let i = 0;
  const mostrar = () => {
    const html = bannerHtml(banners[i]);
    document.getElementById('sidebarBanners').innerHTML = html;
    document.getElementById('mobileBanner').innerHTML = html;
  };
  mostrar();
  if (banners.length > 1) {
    bannerRotTimer = setInterval(() => {
      i = (i + 1) % banners.length;
      mostrar();
    }, 8000);
  }
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
}

function renderHero(destacada, laterales) {
  const hero = document.getElementById('hero');
  if (!destacada) { hero.innerHTML = ''; return; }
  hero.innerHTML = `
    <div class="hero-main" data-id="${esc(destacada.id)}">
      <div class="hero-photo"${destacada.imagenUrl ? ` style="background-image:url('${esc(safeUrl(destacada.imagenUrl) ?? '')}');background-size:cover;background-position:center"` : ''}>
        <span class="hero-badge" style="background:${CAT_COLOR[destacada.categoria]}">${CAT_LABEL[destacada.categoria]}</span>
      </div>
      <h1 class="hero-title">${esc(destacada.titulo)}</h1>
      <p class="hero-deck">${esc(destacada.resumen)}</p>
      <div class="hero-meta">${fmtHora(destacada.fecha)} · El Pulso Noticias</div>
    </div>
    <div class="hero-side">
      ${laterales.map(n => `
        <div class="hero-side-item" data-id="${esc(n.id)}">
          <span class="card-badge-inline" style="color:${CAT_COLOR[n.categoria]}; font-family:'Archivo',sans-serif; font-weight:800; font-size:10.5px; letter-spacing:.12em; text-transform:uppercase;">${CAT_LABEL[n.categoria]}</span>
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
        <span class="card-badge" style="background:${CAT_COLOR[n.categoria]}">${CAT_LABEL[n.categoria]}</span>
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
  document.getElementById('modalCat').textContent = CAT_LABEL[n.categoria];
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

    document.getElementById('hamburgerBtn').addEventListener('click', () => {
      document.getElementById('mobileMenu').hidden = false;
    });
    document.getElementById('closeMenuBtn').addEventListener('click', () => {
      document.getElementById('mobileMenu').hidden = true;
    });
    document.getElementById('searchIconBtn').addEventListener('click', () => {
      document.getElementById('searchInput')?.focus();
    });
    document.getElementById('bottomSearchBtn').addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'modalOverlay') closeModal();
    });
  }
}

init();
