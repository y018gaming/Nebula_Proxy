
const address = document.querySelector('#address');
const form = document.querySelector('#addressForm');
const statusText = document.querySelector('#connectionStatus');
const statusDot = document.querySelector('#statusDot');
const frame = document.querySelector('#desktopFrame');
const tabsContainer = document.querySelector('#tabs');
const newTabBtn = document.querySelector('#newTabBtn');
const reconnectPanel = document.querySelector('#reconnectPanel');
const reconnectBtn = document.querySelector('#reconnectBtn');

let busy = false;
let desktopLoaded = false;
let statusTimer;
let tabsTimer;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function setStatus(message, state = 'normal') {
  statusText.textContent = message;
  statusDot.classList.toggle('is-error', state === 'error');
  statusDot.classList.toggle('is-waiting', state === 'waiting');
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || data.message || `Request failed (${response.status})`);
    error.retryable = data.retryable || response.status === 503;
    throw error;
  }

  return data;
}

const post = (path, body = {}) => request(path, {
  method: 'POST',
  body: JSON.stringify(body)
});

async function navigate(value) {
  if (busy) return;

  busy = true;
  setStatus('Opening page…', 'waiting');

  try {
    let result;

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        result = await post('/api/navigate', { address: value });
        break;
      } catch (error) {
        if (!error.retryable || attempt === 3) throw error;

        setStatus('Browser restarting…', 'waiting');
        await sleep(1500);
      }
    }

    if (result) {
      address.value = result.url;
      setStatus('Browser connected');
      await refreshTabs();
    }
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    busy = false;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  navigate(address.value);
});

document.querySelectorAll('[data-action]').forEach(button => {
  button.addEventListener('click', async () => {
    try {
      const result = await post(`/api/action/${button.dataset.action}`);

      if (result.url) address.value = result.url;

      setStatus('Browser connected');
      await refreshTabs();
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });
});

newTabBtn.addEventListener('click', async () => {
  try {
    const result = await post('/api/action/new');
    address.value = result.url || '';
    setStatus('New tab opened');
    await refreshTabs();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

async function refreshTabs() {
  try {
    const data = await request('/api/tabs');

    tabsContainer.querySelectorAll('.tab').forEach(tab => tab.remove());

    for (const tab of data.tabs || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tab${tab.active ? ' active' : ''}`;
      button.title = tab.title || tab.url || 'New tab';

      const label = document.createElement('span');
      label.textContent = tab.title || 'New tab';

      const close = document.createElement('span');
      close.className = 'tab-close';
      close.textContent = '×';
      close.title = 'Close tab';
      close.setAttribute('role', 'button');
      close.setAttribute('aria-label', `Close ${label.textContent}`);

      button.append(label, close);

      button.addEventListener('click', async event => {
        if (event.target === close) {
          event.stopPropagation();

          try {
            await post(`/api/tabs/${tab.index}/close`);
            await refreshTabs();
          } catch (error) {
            setStatus(error.message, 'error');
          }

          return;
        }

        try {
          const result = await post(`/api/tabs/${tab.index}/activate`);
          address.value = result.url || '';
          await refreshTabs();
        } catch (error) {
          setStatus(error.message, 'error');
        }
      });

      tabsContainer.insertBefore(button, newTabBtn);
    }
  } catch {
    // Keep the main interface available during browser restarts.
  }
}

async function checkStatus() {
  try {
    const data = await request('/api/status');

    setStatus('Browser connected');
    if (data.url && document.activeElement !== address) {
      address.value = data.url;
    }

    reconnectPanel.hidden = true;
    await refreshTabs();
  } catch {
    setStatus('Waiting for Chromium…', 'waiting');
  }
}

function reconnectDesktop() {
  desktopLoaded = false;
  reconnectPanel.hidden = true;

  const url = new URL(frame.src, window.location.href);
  url.searchParams.set('reconnect', 'true');
  url.searchParams.set('_retry', String(Date.now()));

  frame.src = url.pathname + url.search;
  setStatus('Reconnecting desktop…', 'waiting');
}

reconnectBtn.addEventListener('click', reconnectDesktop);

frame.addEventListener('load', () => {
  desktopLoaded = true;
  reconnectPanel.hidden = true;
});

frame.addEventListener('error', () => {
  desktopLoaded = false;
  reconnectPanel.hidden = false;
  setStatus('Desktop unavailable', 'error');
});

// noVNC can disconnect internally without triggering an iframe error.
// Status checks keep the main UI usable while the browser recovers.
checkStatus();
refreshTabs();

statusTimer = setInterval(checkStatus, 4000);
tabsTimer = setInterval(refreshTabs, 8000);

window.addEventListener('beforeunload', () => {
  clearInterval(statusTimer);
  clearInterval(tabsTimer);
});
