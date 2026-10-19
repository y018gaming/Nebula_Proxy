import express from 'express';
import helmet from 'helmet';
import http from 'node:http';
import crypto from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import httpProxy from 'http-proxy';
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.NEBULA_PASSWORD;
if (!PASSWORD || PASSWORD.length < 12) {
  console.error('Set NEBULA_PASSWORD to a private password at least 12 characters long before starting Nebula.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const proxy = httpProxy.createProxyServer({ target: 'http://127.0.0.1:6080', ws: true, changeOrigin: true });
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      frameSrc: ["'self'"],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(express.json({ limit: '20kb' }));

function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function signature(expiry) {
  return crypto.createHmac('sha256', PASSWORD).update(String(expiry)).digest('hex');
}
function validSession(req) {
  const raw = req.headers.cookie || '';
  const match = raw.match(/(?:^|;\s*)nebula_session=([^;]+)/);
  if (!match) return false;
  const [expiry, sig] = decodeURIComponent(match[1]).split('.');
  if (!expiry || !sig || !/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return false;
  return safeEqual(sig, signature(expiry));
}
function setSession(res, req) {
  const expiry = String(Date.now() + 8 * 60 * 60 * 1000);
  const value = `${expiry}.${signature(expiry)}`;
  res.cookie('nebula_session', value, {
    httpOnly: true, sameSite: 'strict', secure: Boolean(req.secure), path: '/',
    maxAge: 8 * 60 * 60 * 1000
  });
}
const loginHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nebula sign in</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08111f;color:#e8f2ff;font:16px system-ui}main{width:min(360px,calc(100% - 40px));padding:28px;border:1px solid #24364d;border-radius:18px;background:#101d30}h1{margin:0 0 8px}p{color:#9eb2ca}input,button{box-sizing:border-box;width:100%;padding:13px;border-radius:10px;margin-top:12px}input{background:#08111f;border:1px solid #30435d;color:white}button{border:0;background:#22c6b7;color:#05201f;font-weight:700;cursor:pointer}.error{color:#ff9d9d}</style><main><h1>✦ Nebula</h1><p>Sign in to your private remote browser.</p><form method="post" action="/login"><input type="password" name="password" placeholder="Nebula password" required autofocus><button type="submit">Sign in</button></form><p class="error" id="err"></p></main></html>`;
app.get('/login', (req, res) => {
  if (validSession(req)) return res.redirect('/');
  res.status(200).type('html').send(loginHtml);
});
app.post('/login', (req, res) => {
  if (!safeEqual(req.body.password || '', PASSWORD)) return res.status(401).type('html').send(loginHtml.replace('</main>', '<p class="error">Incorrect password. Try again.</p></main>'));
  setSession(res, req);
  res.redirect('/');
});
app.post('/logout', (req, res) => {
  res.clearCookie('nebula_session', { path: '/', sameSite: 'strict', secure: Boolean(req.secure) });
  res.redirect('/login');
});
app.use((req, res, next) => {
  if (req.path === '/login') return next();
  if (!validSession(req)) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sign in again to continue.' });
    return res.redirect('/login');
  }
  next();
});

let browser;
let activePage;
async function getBrowser() {
  if (browser && browser.connected) return browser;
  browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  browser.on('disconnected', () => { browser = undefined; activePage = undefined; });
  const pages = await browser.pages();
  activePage = pages.find(p => p.url() !== 'chrome://newtab/') || pages[0];
  return browser;
}
function normalizeAddress(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Enter a website or search phrase.');
  if (/^(javascript|file|data|chrome|devtools):/i.test(value)) throw new Error('That URL scheme is not allowed from the Nebula address bar.');
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(value) && !/\s/.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}
app.get('/api/status', async (req, res) => {
  try { await getBrowser(); res.json({ ok: true, browser: 'connected' }); }
  catch { res.status(503).json({ ok: false, browser: 'starting', message: 'Chromium is still starting. Wait a few seconds and retry.' }); }
});
app.post('/api/navigate', async (req, res) => {
  try {
    const url = normalizeAddress(req.body.address);
    const b = await getBrowser();
    if (!activePage || activePage.isClosed()) activePage = (await b.pages())[0] || await b.newPage();
    await activePage.bringToFront();
    await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    res.json({ ok: true, url: activePage.url(), title: await activePage.title().catch(() => '') });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Navigation failed.' });
  }
});
app.post('/api/action/:action', async (req, res) => {
  try {
    const b = await getBrowser();
    if (!activePage || activePage.isClosed()) activePage = (await b.pages())[0] || await b.newPage();
    if (req.params.action === 'back') await activePage.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    else if (req.params.action === 'forward') await activePage.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    else if (req.params.action === 'reload') await activePage.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    else if (req.params.action === 'new') { activePage = await b.newPage(); await activePage.goto('about:blank'); }
    else return res.status(404).json({ error: 'Unknown browser action.' });
    res.json({ ok: true, url: activePage.url(), title: await activePage.title().catch(() => '') });
  } catch (error) { res.status(500).json({ error: error.message || 'Browser action failed.' }); }
});
app.get('/api/tabs', async (req, res) => {
  try {
    const b = await getBrowser();
    const pages = (await b.pages()).filter(p => !p.isClosed() && !p.url().startsWith('devtools://'));
    res.json({ tabs: await Promise.all(pages.map(async (p, index) => ({ index, url: p.url(), title: await p.title().catch(() => 'New tab'), active: p === activePage }))) });
  } catch { res.status(503).json({ error: 'Browser is starting.' }); }
});
app.post('/api/tabs/:index/activate', async (req, res) => {
  try {
    const b = await getBrowser(); const pages = (await b.pages()).filter(p => !p.isClosed() && !p.url().startsWith('devtools://'));
    const page = pages[Number(req.params.index)]; if (!page) return res.status(404).json({ error: 'Tab not found.' });
    activePage = page; await page.bringToFront(); res.json({ ok: true, url: page.url(), title: await page.title().catch(() => '') });
  } catch { res.status(500).json({ error: 'Could not activate tab.' }); }
});
app.post('/api/tabs/:index/close', async (req, res) => {
  try {
    const b = await getBrowser(); const pages = (await b.pages()).filter(p => !p.isClosed() && !p.url().startsWith('devtools://'));
    const page = pages[Number(req.params.index)]; if (!page) return res.status(404).json({ error: 'Tab not found.' });
    await page.close(); const left = (await b.pages()).filter(p => !p.isClosed()); activePage = left[0] || await b.newPage(); await activePage.bringToFront(); res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Could not close tab.' }); }
});

// Reverse-proxy noVNC through the authenticated app origin. The VNC/WebSocket
// listeners remain on loopback and are not exposed as separate forwarded ports.
app.use('/desktop', (req, res) => {
  req.url = req.url.replace(/^\/desktop/, '') || '/';
  proxy.web(req, res, error => { if (!res.headersSent) res.status(502).send('Remote desktop is starting. Refresh in a few seconds.'); });
});
app.use(express.static('public', { index: 'index.html', dotfiles: 'deny', maxAge: '1h' }));
app.get('/{*path}', (req, res) => res.sendFile(new URL('./public/index.html', import.meta.url).pathname));

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/desktop/')) return socket.destroy();
  if (!validSession(req)) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
  req.url = req.url.replace(/^\/desktop/, '') || '/';
  proxy.ws(req, socket, head, error => { if (error) socket.destroy(); });
});
proxy.on('error', () => {});
server.listen(PORT, '0.0.0.0', () => console.log(`Nebula listening on port ${PORT}. Keep this Codespaces port private.`));

// Start the local browser/desktop stack. These processes are private to the container.
const starter = spawn('/usr/local/bin/start-nebula-browser', [], { stdio: 'ignore', detached: true });
starter.unref();
