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

function fmtHora(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function fmtFecha(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function setActiveCat(cat) {
  activeCat = cat;
  document.querySelectorAll('.nav-pill, .bottom-item, .mobile-menu-item').forEach(el => {
    if (el.dataset.cat) el.classList.toggle('active', el.dataset.cat === cat);
  });
  render();
}

function render() {
  const filtradas = activeCat === 'todas' ? NOTAS : NOTAS.filter(n => n.categoria === activeCat);
  const ordenadas = [...filtradas].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  const destacada = ordenadas.find(n => n.destacada) || ordenadas[0];
  const resto = ordenadas.filter(n => n !== destacada);

  document.getElementById('feedTitle').textContent =
    activeCat === 'todas' ? 'Últimas noticias' : CAT_LABEL[activeCat];

  renderHero(destacada, resto.slice(0, 3));
  renderGrid(resto.slice(3, 9).length ? resto.slice(3, 9) : resto.slice(0, 6));
}

function renderHero(destacada, laterales) {
  const hero = document.getElementById('hero');
  if (!destacada) { hero.innerHTML = ''; return; }
  hero.innerHTML = `
    <div class="hero-main" data-id="${esc(destacada.id)}">
      <div class="hero-photo">
        <span class="hero-badge" style="background:${CAT_COLOR[destacada.categoria]}">${CAT_LABEL[destacada.categoria]}</span>
      </div>
      <h1 class="hero-title">${esc(destacada.titulo)}</h1>
      <p class="hero-deck">${esc(destacada.resumen)}</p>
      <div class="hero-meta">${fmtHora(destacada.fecha)} · ${esc(destacada.fuente)}</div>
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
      <div class="card-photo">
        <span class="card-badge" style="background:${CAT_COLOR[n.categoria]}">${CAT_LABEL[n.categoria]}</span>
      </div>
      <div class="card-title">${esc(n.titulo)}</div>
      <div class="card-deck">${esc(n.resumen)}</div>
      <div class="card-meta">${fmtHora(n.fecha)} · ${esc(n.fuente)}</div>
    </div>
  `).join('');
  grid.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => openModal(el.dataset.id)));
}

function renderTicker() {
  const ordenadas = [...NOTAS].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 15);
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

function openModal(id) {
  const n = NOTAS.find(x => x.id === id);
  if (!n) return;
  document.getElementById('modalCat').textContent = CAT_LABEL[n.categoria];
  document.getElementById('modalCat').style.background = CAT_COLOR[n.categoria];
  document.getElementById('modalTitle').textContent = n.titulo;
  document.getElementById('modalMeta').textContent = `${fmtHora(n.fecha)} · Fuente: ${n.fuente}`;
  document.getElementById('modalBody').textContent = n.cuerpo;
  const src = document.getElementById('modalSource');
  const url = safeUrl(n.link);
  if (url) {
    src.href = url;
    src.textContent = `Ver nota original en ${n.fuente} →`;
    src.hidden = false;
  } else {
    src.removeAttribute('href');
    src.hidden = true;
  }
  document.getElementById('modalOverlay').hidden = false;
}

function closeModal() { document.getElementById('modalOverlay').hidden = true; }

function updateClock() {
  const el = document.getElementById('liveClock');
  if (el) el.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

async function init() {
  document.getElementById('topbarDate').textContent = fmtFecha(new Date());
  updateClock();
  setInterval(updateClock, 30000);

  try {
    const res = await fetch('sample-news.json');
    const data = await res.json();
    NOTAS = data.notas ?? [];
    document.getElementById('feedUpdated').textContent = data.generado
      ? 'ACTUALIZADO ' + fmtHora(data.generado)
      : 'Sin actualizar aún';

    renderTicker();
    render();
  } catch (err) {
    console.error('No se pudieron cargar las noticias:', err);
    document.getElementById('feedTitle').textContent = 'No se pudieron cargar las noticias';
  } finally {
    // Los listeners se enlazan pase lo que pase con el fetch: si el JSON
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
