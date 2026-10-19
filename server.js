import express from "express";
import helmet from "helmet";
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_HTML_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 12_000;

app.disable("x-powered-by");
app.use(helmet({
  // The page viewer uses a sandboxed iframe for fetched content.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}
function isPrivateIPv6(ip) {
  const s = ip.toLowerCase().split("%")[0];
  return s === "::" || s === "::1" || s.startsWith("fc") || s.startsWith("fd") ||
    /^fe[89ab]/.test(s) || s.startsWith("::ffff:127.") || s.startsWith("::ffff:10.") ||
    s.startsWith("::ffff:192.168.") || s.startsWith("::ffff:169.254.");
}
async function validatePublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("Enter a valid URL, such as https://example.com"); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported.");
  if (u.username || u.password) throw new Error("URLs containing embedded credentials are not allowed.");
  if (!u.hostname || u.hostname === "localhost" || u.hostname.endsWith(".localhost") || u.hostname.endsWith(".local")) {
    throw new Error("Local and internal hostnames are blocked.");
  }
  const ipType = net.isIP(u.hostname);
  if (ipType === 4 && isPrivateIPv4(u.hostname)) throw new Error("Private or reserved IP addresses are blocked.");
  if (ipType === 6 && isPrivateIPv6(u.hostname)) throw new Error("Private or reserved IP addresses are blocked.");

  if (!ipType) {
    let records;
    try { records = await dns.lookup(u.hostname, { all: true, verbatim: true }); }
    catch { throw new Error("The hostname could not be resolved."); }
    if (!records.length || records.some(r => r.family === 4 ? isPrivateIPv4(r.address) : isPrivateIPv6(r.address))) {
      throw new Error("This hostname resolves to a private or reserved address and is blocked.");
    }
  }
  return u;
}

app.get("/api/health", (_req, res) => res.json({ ok: true, name: "Nebula", version: "1.0.0" }));

app.post("/api/fetch", async (req, res) => {
  const raw = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!raw || raw.length > 2048) return res.status(400).json({ error: "A URL is required (maximum 2048 characters)." });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = await validatePublicUrl(raw);
    // Redirects are disabled so an allowed public host cannot redirect to an internal target.
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "NebulaDemo/1.0 (+Codespaces page viewer)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      return res.status(400).json({ error: "This destination redirects. Open the final public URL directly in the address bar." });
    }
    const type = response.headers.get("content-type") || "";
    if (!(type.includes("text/html") || type.includes("application/xhtml+xml") || type.startsWith("text/plain"))) {
      return res.status(415).json({ error: `Unsupported content type: ${type || "unknown"}. Nebula's demo viewer supports HTML and plain text only.` });
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_HTML_BYTES) return res.status(413).json({ error: "Page is too large for the demo viewer." });
    const reader = response.body?.getReader();
    if (!reader) return res.status(502).json({ error: "The destination returned an empty response." });
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTML_BYTES) {
        await reader.cancel();
        return res.status(413).json({ error: "Page is too large for the demo viewer." });
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    // Return remote content as data, never as same-origin HTML. The client displays it in a sandboxed iframe.
    res.json({
      ok: response.ok,
      status: response.status,
      contentType: type,
      finalUrl: url.href,
      html: type.startsWith("text/plain")
        ? `<pre>${escapeHtml(body)}</pre>`
        : body
    });
  } catch (err) {
    const message = err.name === "AbortError" ? "The request timed out." : (err.message || "Could not fetch that page.");
    res.status(400).json({ error: message });
  } finally {
    clearTimeout(timer);
  }
});

function escapeHtml(s) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

app.get("/{*path}", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, HOST, () => {
  console.log(`Nebula listening on http://${HOST}:${PORT}`);
});