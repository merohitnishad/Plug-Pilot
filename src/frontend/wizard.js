'use strict';

const api = window.electronAPI;

// ─── Theme ─────────────────────────────────────────────────────────────────────
(function() {
  const t = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('wiz-theme').textContent = t === 'dark' ? '🌻' : '☾';
})();

document.getElementById('wiz-theme').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  const nxt = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nxt);
  localStorage.setItem('theme', nxt);
  document.getElementById('wiz-theme').textContent = nxt === 'dark' ? '🌻' : '☾';
});

// ─── Data ──────────────────────────────────────────────────────────────────────
const presets = {
  us: { host: 'alexa.amazon.com',       page: 'amazon.com',    lang: 'en-US' },
  in: { host: 'alexa.amazon.in',        page: 'amazon.in',     lang: 'en-IN' },
  uk: { host: 'alexa.amazon.co.uk',     page: 'amazon.co.uk',  lang: 'en-GB' },
  de: { host: 'alexa.amazon.de',        page: 'amazon.de',     lang: 'de-DE' },
  ca: { host: 'alexa.amazon.ca',        page: 'amazon.ca',     lang: 'en-CA' },
  jp: { host: 'alexa.amazon.co.jp',     page: 'amazon.co.jp',  lang: 'ja-JP' },
  au: { host: 'alexa.amazon.com.au',    page: 'amazon.com.au', lang: 'en-AU' },
  fr: { host: 'alexa.amazon.fr',        page: 'amazon.fr',     lang: 'fr-FR' },
  it: { host: 'alexa.amazon.it',        page: 'amazon.it',     lang: 'it-IT' },
  es: { host: 'alexa.amazon.es',        page: 'amazon.es',     lang: 'es-ES' },
  mx: { host: 'alexa.amazon.com.mx',    page: 'amazon.com.mx', lang: 'es-MX' },
  br: { host: 'alexa.amazon.com.br',    page: 'amazon.com.br', lang: 'pt-BR' },
};

let deviceMap = {}; // id -> { entityId, name }

// ─── Reset any stale proxy login state on load ────────────────────────────────
(async function resetOnLoad() {
  try { await api.stopProxyLogin(); } catch (_) {}
  // Reset UI to clean state regardless of previous session
  const btn = document.getElementById('btn-connect');
  btn.disabled = false;
  btn.textContent = 'Connect with Amazon';
  document.getElementById('connect-waiting').style.display = 'none';
})();

// ─── Region pills ──────────────────────────────────────────────────────────────
let selectedRegion = 'us';
document.getElementById('region-pills').addEventListener('click', (e) => {
  const pill = e.target.closest('.region-pill');
  if (!pill) return;
  document.querySelectorAll('.region-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  selectedRegion = pill.dataset.value;
});

// ─── Step 1 ────────────────────────────────────────────────────────────────────
document.getElementById('btn-connect').addEventListener('click', async () => {
  const region = selectedRegion;
  const cfg = presets[region];

  await api.setMultiConfig({ alexaServiceHost: cfg.host, amazonPage: cfg.page, acceptLanguage: cfg.lang });

  setAlert('connect-alert', null);
  const btn = document.getElementById('btn-connect');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Connecting…';
  document.getElementById('connect-waiting').style.display = 'block';

  const result = await api.startProxyLogin('');
  if (result.success) {
    api.openUrl(result.proxyUrl);
  } else {
    btn.disabled = false;
    btn.textContent = 'Connect with Amazon';
    document.getElementById('connect-waiting').style.display = 'none';
    setAlert('connect-alert', result.error || 'Failed to start login', 'error');
  }
});

document.getElementById('btn-cancel-login').addEventListener('click', async () => {
  await api.stopProxyLogin();
  const btn = document.getElementById('btn-connect');
  btn.disabled = false;
  btn.textContent = 'Connect with Amazon';
  document.getElementById('connect-waiting').style.display = 'none';
  setAlert('connect-alert', null);
});

api.on('auth-success', () => {
  document.getElementById('progress-fill').style.width = '100%';
  showStep('step-configure');
  loadDevices();
});

api.on('auth-error', (data) => {
  const btn = document.getElementById('btn-connect');
  btn.disabled = false;
  btn.textContent = 'Connect with Amazon';
  document.getElementById('connect-waiting').style.display = 'none';
  setAlert('connect-alert', data.error || 'Login failed', 'error');
});

// ─── Step 2 ────────────────────────────────────────────────────────────────────
let selectedDeviceId = '';

function renderDeviceList(devices) {
  const list = document.getElementById('device-list');
  list.innerHTML = '';
  if (!devices || devices.length === 0) {
    list.innerHTML = '<div class="device-list-empty">No devices found</div>';
    return;
  }
  devices.forEach(d => {
    deviceMap[d.entityId] = d;
    const item = document.createElement('div');
    item.className = 'device-item' + (d.entityId === selectedDeviceId ? ' selected' : '');
    item.dataset.id = d.entityId;
    item.innerHTML = `<span>${d.name}</span><span class="device-item-check">✓</span>`;
    item.addEventListener('click', () => {
      selectedDeviceId = d.entityId;
      list.querySelectorAll('.device-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
    });
    list.appendChild(item);
  });
}

async function loadDevices() {
  const list = document.getElementById('device-list');
  list.innerHTML = '<div class="device-list-empty">Scanning…</div>';
  selectedDeviceId = '';

  try {
    const result = await api.getSmartHomeDevices();
    if (result.success && result.devices && result.devices.length > 0) {
      renderDeviceList(result.devices);
    } else {
      list.innerHTML = '<div class="device-list-empty">No devices found</div>';
    }
  } catch (e) {
    list.innerHTML = '<div class="device-list-empty">Error loading devices</div>';
  }
}

document.getElementById('btn-refresh').addEventListener('click', loadDevices);

// Live range preview
['inp-low', 'inp-high'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateRangePreview);
});

function updateRangePreview() {
  const lo = parseInt(document.getElementById('inp-low').value) || 20;
  const hi = parseInt(document.getElementById('inp-high').value) || 80;
  document.getElementById('range-preview').textContent = `${lo}% – ${hi}%`;
}

document.getElementById('btn-finish').addEventListener('click', async () => {
  const deviceId = selectedDeviceId;
  const low  = parseInt(document.getElementById('inp-low').value, 10);
  const high = parseInt(document.getElementById('inp-high').value, 10);

  if (!deviceId) { setAlert('configure-alert', 'Select a device first', 'error'); return; }
  if (isNaN(low) || isNaN(high) || low >= high) { setAlert('configure-alert', 'Min must be lower than Max', 'error'); return; }

  const deviceName = deviceMap[deviceId]?.name || deviceId;

  const btn = document.getElementById('btn-finish');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Starting…';

  await api.setMultiConfig({ lowThreshold: low, highThreshold: high, targetDeviceId: deviceId, targetDeviceName: deviceName, monitorEnabled: true });
  await api.setMonitor(true);
  window.location.href = 'index.html';
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showStep(id) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setAlert(containerId, msg, type = 'error') {
  const el = document.getElementById(containerId);
  if (!msg) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = `<div class="alert alert-${type}">${esc(msg)}</div>`;
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showToast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.2s'; setTimeout(()=>t.remove(),200); }, 3000);
}
