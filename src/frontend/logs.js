'use strict';

const api = window.electronAPI;

// ─── Theme ──────────────────────────────────────────────────────────────────────
(function () {
  const t = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
})();

// ─── Boot ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadHistory();
  document.getElementById('btn-back').addEventListener('click', () => {
    api.navigateTo('index.html');
  });
  document.getElementById('btn-clear').addEventListener('click', async () => {
    if (!confirm('Clear all history? This cannot be undone.')) return;
    const r = await api.clearHistory();
    if (r && r.success) {
      await loadHistory();
      toast('History cleared', 'success');
    } else {
      toast('Failed to clear', 'error');
    }
  });
});

// ─── Load & render ───────────────────────────────────────────────────────────────
async function loadHistory() {
  const r = await api.getHistory();
  if (!r || !r.success) { toast('Failed to load history', 'error'); return; }
  const rows = r.rows || [];

  const tbody = document.getElementById('log-tbody');
  const table = document.getElementById('log-table');
  const empty = document.getElementById('empty-state');
  const count = document.getElementById('log-count');

  count.textContent = `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`;

  if (rows.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  table.style.display = 'table';
  empty.style.display = 'none';
  tbody.innerHTML = '';

  rows.forEach(row => {
    const tr = document.createElement('tr');

    // Time
    const tdTime = document.createElement('td');
    tdTime.className = 'col-time';
    tdTime.textContent = formatTime(row.ts);
    tr.appendChild(tdTime);

    // Action
    const tdAction = document.createElement('td');
    tdAction.className = 'col-action';
    tdAction.textContent = row.action;
    if (row.note) {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:10px;color:var(--on-muted);margin-top:1px;';
      note.textContent = row.note;
      tdAction.appendChild(note);
    }
    tr.appendChild(tdAction);

    // Source
    const tdTrig = document.createElement('td');
    tdTrig.className = 'col-trig';
    const badge = document.createElement('span');
    badge.className = row.triggered === 'monitor' ? 'badge-monitor' : 'badge-manual';
    badge.textContent = row.triggered === 'monitor' ? 'Auto' : 'Manual';
    tdTrig.appendChild(badge);
    tr.appendChild(tdTrig);

    // Battery
    const tdBat = document.createElement('td');
    tdBat.className = 'col-bat';
    tdBat.textContent = row.battery != null ? `${row.battery}%` : '—';
    tr.appendChild(tdBat);

    // Status
    const tdStatus = document.createElement('td');
    tdStatus.className = 'col-status';
    const statusEl = document.createElement('span');
    statusEl.className = row.success ? 'status-ok' : 'status-err';
    statusEl.textContent = row.success ? '✓' : '✕';
    statusEl.title = row.success ? 'Success' : 'Failed';
    tdStatus.appendChild(statusEl);
    tr.appendChild(tdStatus);

    tbody.appendChild(tr);
  });
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${date}, ${time}`;
  } catch {
    return iso;
  }
}

function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.18s'; setTimeout(() => t.remove(), 200); }, 2800);
}
