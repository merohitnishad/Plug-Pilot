'use strict';

const api = window.electronAPI;

(function () {
  const t = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
})();

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-back').addEventListener('click', () => api.navigateTo('index.html'));

  document.getElementById('btn-website').addEventListener('click',  () => api.openUrl('https://plugpilot.com'));
  document.getElementById('btn-github').addEventListener('click',   () => api.openUrl('https://github.com/merohitnishad/Plug-Pilot'));
  document.getElementById('btn-report').addEventListener('click',   () => api.openUrl('https://plugpilot.com/report-a-bug'));
  document.getElementById('btn-feedback').addEventListener('click', () => api.openUrl('https://plugpilot.com/feedback'));

  document.getElementById('link-license').addEventListener('click', () => api.openUrl('https://github.com/merohitnishad/Plug-Pilot/blob/main/LICENSE'));
  document.getElementById('link-github').addEventListener('click',  () => api.openUrl('https://github.com/merohitnishad/Plug-Pilot'));
  document.getElementById('link-website').addEventListener('click', () => api.openUrl('https://rohitnishad.com'));
});
