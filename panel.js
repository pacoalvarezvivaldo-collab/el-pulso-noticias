const loginScreen = document.getElementById('loginScreen');
const formScreen = document.getElementById('formScreen');
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

function getPassword() {
  return sessionStorage.getItem('panelPassword') || '';
}

function showForm() {
  loginScreen.hidden = true;
  formScreen.hidden = false;
}

function showLogin(mensajeError) {
  sessionStorage.removeItem('panelPassword');
  formScreen.hidden = true;
  loginScreen.hidden = false;
  if (mensajeError) {
    loginError.textContent = mensajeError;
    loginError.hidden = false;
  }
}

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

async function subirImagenSiHay() {
  const file = imagenInput.files[0];
  if (!file) return null;

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
