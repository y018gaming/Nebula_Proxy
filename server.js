
import express from 'express';
import helmet from 'helmet';
import http from 'node:http';
import httpProxy from 'http-proxy';
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

const app = express();
const server = http.createServer(app);
const proxy = httpProxy.createProxyServer({
  target: 'http://127.0.0.1:6080',
  ws: true,
  changeOrigin: true,
  proxyTimeout: 30000,
  timeout: 30000
});

app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      frameSrc: ["'self'"],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '20kb' }));

let browser;
let activePage;
let connectingBrowser;
let lastBrowserError = '';
let navigationInProgress = false;

function normalizeAddress(input) {
  const value = String(input || '').trim();

  if (!value) {
    throw new Error('Enter a website or search phrase.');
  }

  if (/^(javascript|file|data|chrome|devtools):/i.test(value)) {
    throw new Error('That address type is not supported.');
  }

  if (/^https?:\/\//i.test(value)) {
    const parsed = new URL(value);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP and HTTPS addresses are supported.');
    }

    return parsed.href;
  }

  if (
    /^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(value) &&
    !/\s/.test(value)
  ) {
    return `https://${value}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

async function getBrowser() {
  if (browser?.connected) {
    return browser;
  }

  if (connectingBrowser) {
    return connectingBrowser;
  }

  connectingBrowser = (async () => {
    const connected = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null
    });

    connected.on('disconnected', () => {
      if (browser === connected) {
        browser = undefined;
        activePage = undefined;
        lastBrowserError = 'Chromium disconnected. Reconnecting…';
      }
    });

    browser = connected;
    lastBrowserError = '';

    const pages = await connected.pages();

    activePage =
      pages.find(page => !page.isClosed() && page.url() !== 'chrome://newtab/') ||
      pages.find(page => !page.isClosed()) ||
      await connected.newPage();

    return connected;
  })();

  try {
    return await connectingBrowser;
  } catch (error) {
    lastBrowserError = error.message || 'Chromium is not ready.';
    browser = undefined;
    activePage = undefined;
    throw error;
  } finally {
    connectingBrowser = undefined;
  }
}

async function getActivePage() {
  const connected = await getBrowser();

  if (!activePage || activePage.isClosed()) {
    const pages = await connected.pages();
    activePage = pages.find(page => !page.isClosed()) ||
      await connected.newPage();
  }

  return activePage;
}

async function navigateTo(address) {
  if (navigationInProgress) {
    throw new Error('A navigation is already in progress. Try again shortly.');
  }

  navigationInProgress = true;

  try {
    const url = normalizeAddress(address);
    const page = await getActivePage();

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    return {
      ok: true,
      url: page.url(),
      title: await page.title().catch(() => '')
    };
  } finally {
    navigationInProgress = false;
  }
}

app.get('/api/status', async (_req, res) => {
  try {
    const page = await getActivePage();

    res.json({
      ok: true,
      browser: 'connected',
      url: page.url(),
      title: await page.title().catch(() => '')
    });
  } catch {
    res.status(503).json({
      ok: false,
      browser: 'starting',
      message: lastBrowserError || 'Chromium is starting. Try again shortly.'
    });
  }
});

app.post('/api/navigate', async (req, res) => {
  try {
    res.json(await navigateTo(req.body?.address));
  } catch (error) {
    const unavailable = !browser?.connected;

    res.status(unavailable ? 503 : 400).json({
      error: error.message || 'Navigation failed.',
      retryable: unavailable
    });
  }
});

app.post('/api/action/:action', async (req, res) => {
  try {
    const page = await getActivePage();

    switch (req.params.action) {
      case 'back':
        await page.goBack({
          waitUntil: 'domcontentloaded',
          timeout: 15000
        }).catch(() => {});
        break;

      case 'forward':
        await page.goForward({
          waitUntil: 'domcontentloaded',
          timeout: 15000
        }).catch(() => {});
        break;

      case 'reload':
        await page.reload({
          waitUntil: 'domcontentloaded',
          timeout: 20000
        }).catch(() => {});
        break;

      case 'new': {
        const connected = await getBrowser();
        activePage = await connected.newPage();
        await activePage.goto('about:blank');
        break;
      }

      default:
        return res.status(404).json({
          error: 'Unknown browser action.'
        });
    }

    res.json({
      ok: true,
      url: activePage.url(),
      title: await activePage.title().catch(() => '')
    });
  } catch (error) {
    res.status(503).json({
      error: error.message || 'Browser action failed.',
      retryable: true
    });
  }
});

app.get('/api/tabs', async (_req, res) => {
  try {
    const connected = await getBrowser();
    const pages = (await connected.pages()).filter(
      page => !page.isClosed() && !page.url().startsWith('devtools://')
    );

    res.json({
      tabs: await Promise.all(pages.map(async (page, index) => ({
        index,
        url: page.url(),
        title: await page.title().catch(() => 'New tab'),
        active: page === activePage
      })))
    });
  } catch {
    res.status(503).json({
      error: 'Chromium is starting.',
      tabs: []
    });
  }
});

app.post('/api/tabs/:index/activate', async (req, res) => {
  try {
    const connected = await getBrowser();
    const pages = (await connected.pages()).filter(
      page => !page.isClosed() && !page.url().startsWith('devtools://')
    );

    const index = Number(req.params.index);
    const page = Number.isInteger(index) ? pages[index] : undefined;

    if (!page) {
      return res.status(404).json({ error: 'Tab not found.' });
    }

    activePage = page;
    await page.bringToFront();

    res.json({
      ok: true,
      url: page.url(),
      title: await page.title().catch(() => '')
    });
  } catch {
    res.status(503).json({ error: 'Chromium is starting.' });
  }
});

app.post('/api/tabs/:index/close', async (req, res) => {
  try {
    const connected = await getBrowser();
    const pages = (await connected.pages()).filter(
      page => !page.isClosed() && !page.url().startsWith('devtools://')
    );

    const index = Number(req.params.index);
    const page = Number.isInteger(index) ? pages[index] : undefined;

    if (!page) {
      return res.status(404).json({ error: 'Tab not found.' });
    }

    await page.close();

    const remaining = (await connected.pages()).filter(
      item => !item.isClosed()
    );

    activePage = remaining[0] || await connected.newPage();

    res.json({
      ok: true,
      url: activePage.url(),
      title: await activePage.title().catch(() => '')
    });
  } catch {
    res.status(503).json({ error: 'Could not close tab.' });
  }
});

// Keep the remote desktop behind the same app origin.
app.use('/desktop', (req, res) => {
  req.url = req.url.replace(/^\/desktop/, '') || '/';

  proxy.web(req, res, error => {
    if (!res.headersSent) {
      res.status(502).send(
        'Remote desktop is starting. Wait a moment and refresh.'
      );
    }
  });
});

app.use(express.static(PUBLIC_DIR, {
  index: 'index.html',
  dotfiles: 'deny',
  maxAge: '1h'
}));

app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/desktop/')) {
    socket.destroy();
    return;
  }

  req.url = req.url.replace(/^\/desktop/, '') || '/';

  proxy.ws(req, socket, head, () => socket.destroy());
});

proxy.on('error', () => {});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Nebula listening on port ${PORT}.`);
  console.log('Keep the forwarded Codespaces port private.');

  const starter = spawn('/usr/local/bin/start-nebula-browser', [], {
    stdio: 'ignore',
    detached: true
  });

  starter.on('error', error => {
    console.error('Could not start browser services:', error.message);
  });

  starter.unref();
});
