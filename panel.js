function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const loginScreen = document.getElementById('loginScreen');
const panelTabs = document.getElementById('panelTabs');
const tabNotaBtn = document.getElementById('tabNotaBtn');
const tabBannerBtn = document.getElementById('tabBannerBtn');
const formScreen = document.getElementById('formScreen');
const bannerScreen = document.getElementById('bannerScreen');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');

const categoriaInput = document.getElementById('categoriaInput');
const tituloInput = document.getElementById('tituloInput');
const resumenInput = document.getElementById('resumenInput');
const cuerpoInput = document.getElementById('cuerpoInput');
const fuenteInput = document.getElementById('fuenteInput');
const imagenInput = document.getElementById('imagenInput');
const imagenPreview = document.getElementById('imagenPreview');
const publicarBtn = document.getElementById('publicarBtn');
const formStatus = document.getElementById('formStatus');

const bannerList = document.getElementById('bannerList');
const bannerImagenInput = document.getElementById('bannerImagenInput');
const bannerImagenPreview = document.getElementById('bannerImagenPreview');
const bannerLinkInput = document.getElementById('bannerLinkInput');
const bannerDiasInput = document.getElementById('bannerDiasInput');
const agregarBannerBtn = document.getElementById('agregarBannerBtn');
const bannerStatus = document.getElementById('bannerStatus');
const eliminarSeleccionadosBtn = document.getElementById('eliminarSeleccionadosBtn');
const bannersSeleccionados = new Set();

function getPassword() {
  return sessionStorage.getItem('panelPassword') || '';
}

function showForm() {
  loginScreen.hidden = true;
  panelTabs.hidden = false;
  formScreen.hidden = false;
  cargarBanners();
}

function showLogin(mensajeError) {
  sessionStorage.removeItem('panelPassword');
  panelTabs.hidden = true;
  formScreen.hidden = true;
  bannerScreen.hidden = true;
  loginScreen.hidden = false;
  if (mensajeError) {
    loginError.textContent = mensajeError;
    loginError.hidden = false;
  }
}

function cambiarTab(tab) {
  tabNotaBtn.classList.toggle('active', tab === 'nota');
  tabBannerBtn.classList.toggle('active', tab === 'banner');
  formScreen.hidden = tab !== 'nota';
  bannerScreen.hidden = tab !== 'banner';
}
tabNotaBtn.addEventListener('click', () => cambiarTab('nota'));
tabBannerBtn.addEventListener('click', () => cambiarTab('banner'));

if (getPassword()) showForm();

loginBtn.addEventListener('click', () => {
  const pass = passwordInput.value.trim();
  if (!pass) return;
  loginError.hidden = true;
  sessionStorage.setItem('panelPassword', pass);
  passwordInput.value = '';
  showForm();
});

passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});

logoutBtn.addEventListener('click', () => showLogin());

imagenInput.addEventListener('change', () => {
  const file = imagenInput.files[0];
  if (!file) { imagenPreview.hidden = true; return; }
  imagenPreview.src = URL.createObjectURL(file);
  imagenPreview.hidden = false;
});

function setStatus(msg, tipo) {
  formStatus.textContent = msg;
  formStatus.className = 'panel-status ' + tipo;
  formStatus.hidden = false;
}

async function subirImagen(file) {
  const res = await fetch(CONVEX_HTTP_URL + '/api/subir-imagen-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: getPassword() }),
  });
  if (res.status === 401) throw { sesionInvalida: true };
  if (!res.ok) throw new Error('No se pudo preparar la subida de la imagen.');
  const { uploadUrl } = await res.json();

  const subida = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!subida.ok) throw new Error('Falló la subida de la imagen.');
  const { storageId } = await subida.json();
  return storageId;
}

async function subirImagenSiHay() {
  const file = imagenInput.files[0];
  return file ? subirImagen(file) : null;
}

publicarBtn.addEventListener('click', async () => {
  const titulo = tituloInput.value.trim();
  const resumen = resumenInput.value.trim();
  const cuerpo = cuerpoInput.value.trim();
  if (!titulo || !resumen || !cuerpo) {
    setStatus('Falta título, resumen o cuerpo.', 'err');
    return;
  }

  publicarBtn.disabled = true;
  setStatus('Publicando…', 'ok');

  try {
    const imagenStorageId = await subirImagenSiHay();

    const res = await fetch(CONVEX_HTTP_URL + '/api/notas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: getPassword(),
        categoria: categoriaInput.value,
        titulo,
        resumen,
        cuerpo,
        fuente: fuenteInput.value.trim(),
        imagenStorageId,
      }),
    });

    if (res.status === 401) throw { sesionInvalida: true };
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo publicar la nota.');
    }

    tituloInput.value = '';
    resumenInput.value = '';
    cuerpoInput.value = '';
    fuenteInput.value = '';
    imagenInput.value = '';
    imagenPreview.hidden = true;
    setStatus('Nota publicada. Ya aparece en el sitio.', 'ok');
  } catch (err) {
    if (err && err.sesionInvalida) {
      showLogin('Contraseña incorrecta o vencida — entra de nuevo.');
      return;
    }
    setStatus(err.message || 'Error al publicar.', 'err');
  } finally {
    publicarBtn.disabled = false;
  }
});

bannerImagenInput.addEventListener('change', () => {
  const file = bannerImagenInput.files[0];
  if (!file) { bannerImagenPreview.hidden = true; return; }
  bannerImagenPreview.src = URL.createObjectURL(file);
  bannerImagenPreview.hidden = false;
});

function setBannerStatus(msg, tipo) {
  bannerStatus.textContent = msg;
  bannerStatus.className = 'panel-status ' + tipo;
  bannerStatus.hidden = false;
}

function actualizarBotonEliminarSeleccionados() {
  eliminarSeleccionadosBtn.hidden = bannersSeleccionados.size === 0;
  eliminarSeleccionadosBtn.textContent = `Eliminar seleccionados (${bannersSeleccionados.size})`;
}

async function cargarBanners() {
  try {
    const res = await fetch(CONVEX_HTTP_URL + '/api/banners');
    if (!res.ok) return;
    const banners = await res.json();
    const idsVigentes = new Set(banners.map(b => b.id));
    for (const id of [...bannersSeleccionados]) {
      if (!idsVigentes.has(id)) bannersSeleccionados.delete(id);
    }
    bannerList.innerHTML = banners.map(b => {
      const vigencia = b.expiraEn
        ? `Expira ${new Date(b.expiraEn).toLocaleDateString('es-MX')}`
        : 'No expira';
      return `
        <div class="banner-list-item" data-id="${esc(b.id)}">
          <input type="checkbox" class="banner-select-check" data-id="${esc(b.id)}" ${bannersSeleccionados.has(b.id) ? 'checked' : ''}>
          <img src="${esc(b.imagenUrl)}" alt="">
          <span class="banner-list-link">${b.linkUrl ? esc(b.linkUrl) : 'Sin link'} · ${esc(vigencia)}</span>
          <button class="banner-delete-btn" data-id="${esc(b.id)}">Eliminar</button>
        </div>
      `;
    }).join('');
    bannerList.querySelectorAll('.banner-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => eliminarBanners([btn.dataset.id]));
    });
    bannerList.querySelectorAll('.banner-select-check').forEach(chk => {
      chk.addEventListener('change', () => {
        if (chk.checked) bannersSeleccionados.add(chk.dataset.id);
        else bannersSeleccionados.delete(chk.dataset.id);
        actualizarBotonEliminarSeleccionados();
      });
    });
    actualizarBotonEliminarSeleccionados();
  } catch {
    // Sin conexión con Convex — se deja la lista como estaba, no es fatal.
  }
}

async function eliminarBanners(ids) {
  try {
    const password = getPassword();
    const resultados = await Promise.all(ids.map(id =>
      fetch(CONVEX_HTTP_URL + '/api/banners/eliminar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, id }),
      })
    ));
    if (resultados.some(r => r.status === 401)) throw { sesionInvalida: true };
    if (resultados.some(r => !r.ok)) throw new Error('No se pudo eliminar alguno de los banners.');
    for (const id of ids) bannersSeleccionados.delete(id);
    cargarBanners();
  } catch (err) {
    if (err && err.sesionInvalida) { showLogin('Contraseña incorrecta o vencida — entra de nuevo.'); return; }
    setBannerStatus(err.message || 'Error al eliminar.', 'err');
  }
}

eliminarSeleccionadosBtn.addEventListener('click', () => eliminarBanners([...bannersSeleccionados]));

agregarBannerBtn.addEventListener('click', async () => {
  const file = bannerImagenInput.files[0];
  if (!file) {
    setBannerStatus('Falta la imagen del banner.', 'err');
    return;
  }

  agregarBannerBtn.disabled = true;
  setBannerStatus('Subiendo…', 'ok');

  try {
    const imagenStorageId = await subirImagen(file);

    const res = await fetch(CONVEX_HTTP_URL + '/api/banners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: getPassword(),
        imagenStorageId,
        linkUrl: bannerLinkInput.value.trim(),
        diasVigencia: bannerDiasInput.value ? Number(bannerDiasInput.value) : undefined,
      }),
    });

    if (res.status === 401) throw { sesionInvalida: true };
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo agregar el banner.');
    }

    bannerImagenInput.value = '';
    bannerImagenPreview.hidden = true;
    bannerLinkInput.value = '';
    bannerDiasInput.value = '';
    setBannerStatus('Banner agregado.', 'ok');
    cargarBanners();
  } catch (err) {
    if (err && err.sesionInvalida) { showLogin('Contraseña incorrecta o vencida — entra de nuevo.'); return; }
    setBannerStatus(err.message || 'Error al agregar.', 'err');
  } finally {
    agregarBannerBtn.disabled = false;
  }
});
