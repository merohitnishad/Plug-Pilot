'use strict';

const api = window.electronAPI;
const CIRC = 125.7; // 2 * PI * 20

// ─── Theme ─────────────────────────────────────────────────────────────────────
(function () {
  const t = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
  updateThemeBtn(t);
})();

function updateThemeBtn(t) {
  const b = el('btn-theme');
  if (b) b.textContent = t === 'dark' ? '🌻' : '☾';
}

// ─── State ─────────────────────────────────────────────────────────────────────
let S = {
  batteryPercent: null,
  isCharging: false,
  monitorEnabled: false,
  lowThreshold: 20,
  highThreshold: 80,
  targetDeviceId: null,
  targetDeviceName: null,
  lastCommand: null,
  lastCommandTime: null,
  lastPlugState: null,
  hasSession: false,
  alexaEmail: '',
  runOnStartup: false,
};

let tmpDeviceId = null, tmpDeviceName = null;

// ─── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadConfig();
  await refreshBattery();
  wireMenu();
  wireEvents();
  wireIpc();
  setInterval(refreshBattery, 20000);
  
  // Initial device status check
  if (S.targetDeviceId) {
    refreshDeviceStatus();
    setInterval(refreshDeviceStatus, 300000); // every 5 mins
  }
}

// ─── Config ────────────────────────────────────────────────────────────────────
async function loadConfig() {
  const r = await api.getConfig();
  if (!r.success) return;
  S = { ...S, ...r.config };
  applyConfig();
}

function applyConfig() {
  el('toggle-startup').checked  = S.runOnStartup;
  el('val-device').textContent  = S.targetDeviceName || 'Not selected';
  el('val-range').textContent   = `${S.lowThreshold}% – ${S.highThreshold}%`;
  updateAlexaUI(S.hasSession);
  // Sanitize stale raw command strings from old versions
  const cmd = sanitizeCommand(S.lastCommand);
  updateLastAction(cmd, S.lastCommandTime);
  renderMonitorBtn(S.monitorEnabled);
  renderPlugBtn(S.lastPlugState);
  syncMenuState();
}

function sanitizeCommand(cmd) {
  if (!cmd) return cmd;
  if (cmd === 'Smart Home turnOn'  || cmd === 'turnOn')  return 'Plug IN';
  if (cmd === 'Smart Home turnOff' || cmd === 'turnOff') return 'Plug OUT';
  return cmd;
}

// ─── Battery ───────────────────────────────────────────────────────────────────
async function refreshBattery() {
  const r = await api.getBattery().catch(() => null);
  if (r && r.success) updateBatteryUI(r.percent, r.isCharging);
}

async function refreshDeviceStatus() {
  if (!S.targetDeviceId) return;
  const r = await api.getSmartHomeDeviceState(S.targetDeviceId);
  if (r.success && r.result?.state) {
    updateDeviceStatusUI(r.result.state);
  } else {
    updateDeviceStatusUI(null);
  }
}

function updateDeviceStatusUI(state) {
  const dot = el('device-status-dot');
  if (!dot) return;
  dot.style.display = 'inline-block';
  if (state === 'on') {
    dot.className = 'dot dot-green';
    dot.title = 'Smart plug is currently ON';
  } else if (state === 'off') {
    dot.className = 'dot dot-red';
    dot.title = 'Smart plug is currently OFF';
  } else {
    dot.className = 'dot dot-grey';
    dot.title = 'Smart plug status unknown';
  }
}

function updateBatteryUI(pct, charging) {
  S.batteryPercent = pct;
  S.isCharging     = charging;

  el('bat-pct').textContent = pct;

  let color = '#43A047';
  if (pct <= S.lowThreshold)       color = '#C62828';
  else if (pct >= S.highThreshold) color = '#E65100';

  el('ring-arc').style.stroke = color;
  el('ring-arc').style.strokeDashoffset = CIRC - (pct / 100) * CIRC;

  if (charging)                    el('bat-state').textContent = 'Charging';
  else if (pct <= S.lowThreshold)  el('bat-state').textContent = 'Low Battery';
  else if (pct >= S.highThreshold) el('bat-state').textContent = 'Fully Charged';
  else                             el('bat-state').textContent = 'On Battery';

  el('bat-sub').textContent = S.monitorEnabled
    ? `Monitoring — plug in ≤${S.lowThreshold}%  ·  unplug ≥${S.highThreshold}%`
    : `Range: ${S.lowThreshold}% – ${S.highThreshold}%  ·  Monitor off`;
}

// ─── Monitor button ─────────────────────────────────────────────────────────────
function renderMonitorBtn(on) {
  const btn = el('btn-monitor');
  if (on) {
    btn.textContent = '■ Stop Monitor';
    btn.className = 'action-btn btn-monitor-stop';
  } else {
    btn.textContent = '▶ Start Monitor';
    btn.className = 'action-btn btn-monitor-start';
  }
}

// ─── Plug button ────────────────────────────────────────────────────────────────
function renderPlugBtn(state) {
  const btn = el('btn-plug');
  if (state === 'on') {
    btn.textContent = '⚡ Plug IN (on)';
    btn.className   = 'action-btn btn-plug-on';
    btn.title       = 'Plug is ON — click to turn OFF';
  } else if (state === 'off') {
    btn.textContent = '○ Plug OUT (off)';
    btn.className   = 'action-btn btn-plug-off';
    btn.title       = 'Plug is OFF — click to turn ON';
  } else {
    btn.textContent = '⚡ Plug IN';
    btn.className   = 'action-btn btn-plug-on';
    btn.title       = 'Turn plug ON';
  }
}

// ─── Sync state (no-op kept for call sites that still reference it) ─────────────
function syncMenuState() {}

// ─── Alexa status ───────────────────────────────────────────────────────────────
function updateAlexaUI(connected) {
  el('alexa-sub').textContent = connected ? (S.alexaEmail || 'Connected') : 'Not connected';
  el('alexa-chip').innerHTML  = connected
    ? '<span class="chip chip-green"><span class="dot dot-green"></span>Connected</span>'
    : '<span class="chip chip-red">Disconnected</span>';
}

// ─── Last action ────────────────────────────────────────────────────────────────
function updateLastAction(cmd, time) {
  if (!cmd) { el('last-action').textContent = 'No actions yet'; return; }
  const t = time ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  el('last-action').innerHTML = `<strong>${esc(cmd)}</strong>${t ? ' · ' + t : ''}`;
}

// ─── Overflow menu ──────────────────────────────────────────────────────────────
function wireMenu() {
  const menuBtn = el('btn-menu');
  const menuDrop = el('main-menu');

  // Theme button (titlebar)
  el('btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const nxt = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nxt);
    localStorage.setItem('theme', nxt);
    updateThemeBtn(nxt);
  });

  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    menuDrop.classList.toggle('open');
  });

  document.addEventListener('click', () => menuDrop.classList.remove('open'));
  menuDrop.addEventListener('click', e => e.stopPropagation());

  el('menu-logs').addEventListener('click', () => {
    closeMenu();
    api.navigateTo('logs.html');
  });

  el('menu-report').addEventListener('click', () => {
    closeMenu();
    api.openUrl('https://plugpilot.com/report-a-bug');
  });

  el('menu-feedback').addEventListener('click', () => {
    closeMenu();
    api.openUrl('https://plugpilot.com/feedback');
  });

  el('menu-website').addEventListener('click', () => {
    closeMenu();
    api.openUrl('https://plugpilot.com');
  });

  el('menu-about').addEventListener('click', () => {
    closeMenu();
    api.navigateTo('about.html');
  });

  el('menu-logout').addEventListener('click', async () => {
    closeMenu();
    if (!confirm('This will sign you out and restart the setup wizard. Continue?')) return;
    await api.clearSession();
  });

  el('menu-delete-data').addEventListener('click', async () => {
    closeMenu();
    if (!confirm('Delete ALL data?\n\nThis removes your Alexa session, device settings, action history, logs, and the background LaunchAgent. The app will restart to the setup wizard.\n\nThis cannot be undone.')) return;
    await api.deleteAllData();
  });

  el('menu-quit').addEventListener('click', () => {
    closeMenu();
    if (api.quitApp) api.quitApp();
  });
}

function closeMenu() {
  el('main-menu').classList.remove('open');
}

// ─── Core events (hero buttons + settings rows) ─────────────────────────────────
function wireEvents() {

  // Monitor button (hero)
  el('btn-monitor').addEventListener('click', async () => {
    const on = !S.monitorEnabled;
    el('btn-monitor').disabled = true;
    const r = await api.setMonitor(on);
    el('btn-monitor').disabled = false;
    if (r.success) {
      S.monitorEnabled = on;
      renderMonitorBtn(on);
      syncMenuState();
      if (S.batteryPercent !== null) updateBatteryUI(S.batteryPercent, S.isCharging);
      toast(on ? 'Monitor started' : 'Monitor stopped', on ? 'success' : 'info');
    } else {
      toast('Error: ' + (r.error || 'Unknown'), 'error');
    }
  });

  // Plug button (hero)
  el('btn-plug').addEventListener('click', async () => {
    await doPlugToggle();
  });

  // Run at Startup toggle
  el('toggle-startup').addEventListener('change', async e => {
    const on = e.target.checked;
    const r = await api.setStartup(on);
    if (r && r.success) {
      S.runOnStartup = on;
      syncMenuState();
      toast(`Run at startup ${on ? 'on' : 'off'}`, 'info');
    } else {
      e.target.checked = !on;
      toast(r?.error || 'Failed to update startup setting', 'error');
    }
  });

  // Edit range (settings row)
  el('btn-edit-range').addEventListener('click', () => {
    setRangeInputs(S.lowThreshold, S.highThreshold);
    openModal('modal-range');
  });

  // Edit device (settings row)
  el('btn-edit-device').addEventListener('click', async () => {
    await openDeviceModal();
  });

  // Range modal
  el('slider-low').addEventListener('input', () => {
    let v = parseInt(el('slider-low').value, 10);
    const hi = parseInt(el('edit-high').value, 10);
    if (v >= hi) { v = hi - 1; el('slider-low').value = v; }
    el('edit-low').value = v;
    updateEditPreview();
  });
  el('edit-low').addEventListener('input', () => {
    let v = parseInt(el('edit-low').value, 10);
    if (isNaN(v)) return;
    const hi = parseInt(el('edit-high').value, 10);
    if (v >= hi) { v = hi - 1; el('edit-low').value = v; }
    if (v < 1)   { v = 1;      el('edit-low').value = v; }
    el('slider-low').value = v;
    updateEditPreview();
  });
  el('slider-high').addEventListener('input', () => {
    let v = parseInt(el('slider-high').value, 10);
    const lo = parseInt(el('edit-low').value, 10);
    if (v <= lo) { v = lo + 1; el('slider-high').value = v; }
    el('edit-high').value = v;
    updateEditPreview();
  });
  el('edit-high').addEventListener('input', () => {
    let v = parseInt(el('edit-high').value, 10);
    if (isNaN(v)) return;
    const lo = parseInt(el('edit-low').value, 10);
    if (v <= lo) { v = lo + 1; el('edit-high').value = v; }
    if (v > 99)  { v = 99;     el('edit-high').value = v; }
    el('slider-high').value = v;
    updateEditPreview();
  });
  el('btn-save-range').addEventListener('click', async () => {
    const lo = parseInt(el('edit-low').value, 10);
    const hi = parseInt(el('edit-high').value, 10);
    if (isNaN(lo) || isNaN(hi) || lo >= hi) { toast('Min must be lower than Max', 'error'); return; }
    const r = await api.setMultiConfig({ lowThreshold: lo, highThreshold: hi });
    if (r.success) {
      S.lowThreshold = lo; S.highThreshold = hi;
      el('val-range').textContent = `${lo}% – ${hi}%`;
      closeModal('modal-range');
      syncMenuState();
      toast('Range updated', 'success');
      if (S.batteryPercent !== null) updateBatteryUI(S.batteryPercent, S.isCharging);
    }
  });
  el('btn-cancel-range').addEventListener('click', () => closeModal('modal-range'));
  el('modal-range').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('modal-range'); });

  // Device modal
  el('btn-save-device').addEventListener('click', async () => {
    if (!tmpDeviceId) { toast('Select a device', 'warn'); return; }
    const r = await api.setMultiConfig({ targetDeviceId: tmpDeviceId, targetDeviceName: tmpDeviceName });
    if (r.success) {
      S.targetDeviceId = tmpDeviceId; S.targetDeviceName = tmpDeviceName;
      el('val-device').textContent = tmpDeviceName;
      closeModal('modal-device');
      toast('Device updated', 'success');
    }
  });
  el('btn-cancel-device').addEventListener('click', () => closeModal('modal-device'));
  el('modal-device').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('modal-device'); });

}

// ─── Plug toggle (shared by hero button and menu) ────────────────────────────────
async function doPlugToggle() {
  const turnOn = S.lastPlugState !== 'on';
  el('btn-plug').disabled = true;

  let r;
  if (S.targetDeviceId) {
    r = await api.sendSmartHomeAction(S.targetDeviceId, turnOn ? 'turnOn' : 'turnOff');
  } else {
    r = turnOn ? await api.testOnCommand() : await api.testOffCommand();
  }

  el('btn-plug').disabled = false;

  if (r && r.success) {
    const newState = turnOn ? 'on' : 'off';
    S.lastPlugState = newState;
    renderPlugBtn(newState);
    syncMenuState();
    await api.setConfig('lastPlugState', newState);
    const label = turnOn ? 'Plug IN' : 'Plug OUT';
    updateLastAction(`Manual ${label}`, new Date().toISOString());
    toast(label, 'success');
  } else {
    toast('Failed: ' + ((r && r.error) || 'Unknown'), 'error');
  }
}

// ─── Device modal ───────────────────────────────────────────────────────────────
async function openDeviceModal() {
  openModal('modal-device');
  const list = el('device-list-edit');
  list.innerHTML = '';
  const scanning = document.createElement('div');
  scanning.style.cssText = 'padding:16px;text-align:center;color:var(--on-muted);font-size:12px;';
  scanning.textContent = 'Scanning…';
  list.appendChild(scanning);
  tmpDeviceId = null; tmpDeviceName = null;
  try {
    const r = await api.getSmartHomeDevices();
    list.innerHTML = '';
    if (r.success && r.devices && r.devices.length) {
      r.devices.forEach(d => {
        const item = document.createElement('div');
        item.className = 'device-opt' + (d.entityId === S.targetDeviceId ? ' selected' : '');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = d.name;
        const idDiv = document.createElement('div');
        idDiv.className = 'device-opt-id';
        idDiv.textContent = d.entityId;
        item.appendChild(nameSpan);
        item.appendChild(idDiv);
        item.onclick = () => {
          list.querySelectorAll('.device-opt').forEach(x => x.classList.remove('selected'));
          item.classList.add('selected');
          tmpDeviceId = d.entityId; tmpDeviceName = d.name;
        };
        list.appendChild(item);
      });
    } else {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:16px;text-align:center;color:var(--on-muted);font-size:12px;';
      empty.textContent = 'No devices found';
      list.appendChild(empty);
    }
  } catch {
    const err = document.createElement('div');
    err.style.cssText = 'padding:16px;text-align:center;color:var(--red);font-size:12px;';
    err.textContent = 'Error loading devices';
    list.innerHTML = '';
    list.appendChild(err);
  }
}

function setRangeInputs(lo, hi) {
  el('edit-low').value    = lo;
  el('edit-high').value   = hi;
  el('slider-low').value  = lo;
  el('slider-high').value = hi;
  updateEditPreview();
}

function updateEditPreview() {
  const lo = parseInt(el('edit-low').value)  || 0;
  const hi = parseInt(el('edit-high').value) || 0;
  el('preview-low').textContent  = lo + '%';
  el('preview-high').textContent = hi + '%';
}

// ─── IPC push from main ──────────────────────────────────────────────────────────
function wireIpc() {
  api.on('battery-update', d => {
    if (d && typeof d.percent === 'number') updateBatteryUI(d.percent, d.isCharging);
  });

  api.on('device-status-update', d => {
    if (d && d.state) {
      updateDeviceStatusUI(d.state);
      S.lastPlugState = d.state;
      renderPlugBtn(d.state);
    }
  });

  api.on('command-executed', d => {
    if (!d) return;
    updateLastAction(d.command, d.time);
    toast('Auto: ' + d.command, 'info');
    if (d.plugState) {
      S.lastPlugState = d.plugState;
      renderPlugBtn(d.plugState);
      syncMenuState();
    }
  });

  api.on('scheduler-status', d => {
    if (d && typeof d.running === 'boolean') {
      S.monitorEnabled = d.running;
      renderMonitorBtn(d.running);
      syncMenuState();
      if (S.batteryPercent !== null) updateBatteryUI(S.batteryPercent, S.isCharging);
    }
  });

  api.on('open-about', () => api.navigateTo('about.html'));
}

// ─── Modal ─────────────────────────────────────────────────────────────────────
function openModal(id)  { el(id).classList.add('open'); }
function closeModal(id) { el(id).classList.remove('open'); }
window.closeModal = closeModal;

// ─── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  el('toastContainer').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.18s'; setTimeout(() => t.remove(), 200); }, 2800);
}

// ─── Util ──────────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

document.addEventListener('DOMContentLoaded', init);

// Footer author link
document.addEventListener('DOMContentLoaded', () => {
  const a = el('footer-author');
  if (a) a.addEventListener('click', () => api.openUrl('https://rohitnishad.com'));
});
