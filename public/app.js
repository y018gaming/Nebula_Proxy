const address = document.querySelector('#address');
const form = document.querySelector('#addressForm');
const statusText = document.querySelector('#connectionStatus');
const frame = document.querySelector('#desktopFrame');
let busy = false;
async function api(path, body = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function setStatus(text) { statusText.textContent = text; }
async function navigate(value) {
  if (busy) return;
  busy = true; setStatus('Opening page…');
  try {
    const result = await api('/api/navigate', { address: value });
    address.value = result.url;
    setStatus('Remote browser connected');
    frame.contentWindow?.focus();
  } catch (error) { setStatus(error.message); }
  finally { busy = false; }
}
form.addEventListener('submit', event => { event.preventDefault(); navigate(address.value); });
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
  try { const result = await api(`/api/action/${button.dataset.action}`); if (result.url) address.value = result.url; setStatus('Remote browser connected'); }
  catch (error) { setStatus(error.message); }
}));
document.querySelector('#newTabBtn').addEventListener('click', async () => {
  try { await api('/api/action/new'); address.value = ''; setStatus('New remote tab opened'); }
  catch (error) { setStatus(error.message); }
});
async function check() {
  try { const r = await fetch('/api/status', { credentials: 'same-origin' }); const data = await r.json(); setStatus(data.ok ? 'Remote browser connected' : 'Starting Chromium…'); }
  catch { setStatus('Connecting to Chromium…'); }
}
frame.addEventListener('load', () => { setStatus('Remote desktop loaded'); });
check();
