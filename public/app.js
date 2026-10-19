const $ = (id) => document.getElementById(id);
const tabsEl = $("tabs");
const address = $("address");
const homeAddress = $("homeAddress");
const home = $("home");
const viewerWrap = $("viewerWrap");
const viewer = $("viewer");
const statusEl = $("status");
const errorEl = $("error");

let tabs = [{ id: 1, title: "New tab", url: "", history: [], historyIndex: -1 }];
let activeId = 1;
let nextId = 2;

function activeTab() { return tabs.find(t => t.id === activeId); }
function renderTabs() {
  tabsEl.innerHTML = "";
  for (const tab of tabs) {
    const b = document.createElement("button");
    b.className = "tab" + (tab.id === activeId ? " active" : "");
    b.innerHTML = `<span></span><span class="close" title="Close tab">×</span>`;
    b.firstElementChild.textContent = tab.title;
    b.addEventListener("click", () => { activeId = tab.id; renderTabs(); showCurrent(); });
    b.querySelector(".close").addEventListener("click", (e) => {
      e.stopPropagation();
      if (tabs.length === 1) {
        tabs[0] = { id: nextId++, title: "New tab", url: "", history: [], historyIndex: -1 };
        activeId = tabs[0].id;
      } else {
        const i = tabs.findIndex(t => t.id === tab.id);
        tabs = tabs.filter(t => t.id !== tab.id);
        if (activeId === tab.id) activeId = tabs[Math.max(0, i - 1)].id;
      }
      renderTabs(); showCurrent();
    });
    tabsEl.appendChild(b);
  }
}
function showCurrent() {
  const tab = activeTab();
  address.value = tab.url;
  errorEl.classList.add("hidden");
  if (!tab.url) {
    home.classList.remove("hidden"); viewerWrap.classList.add("hidden");
  } else {
    home.classList.add("hidden"); viewerWrap.classList.remove("hidden");
  }
}
function normalizeInput(raw) {
  const value = raw.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(value)) return "https://" + value;
  return "https://www.google.com/search?q=" + encodeURIComponent(value);
}
async function navigate(raw, addHistory = true) {
  const url = normalizeInput(raw);
  if (!url) return;
  const tab = activeTab();
  tab.url = url;
  if (addHistory) {
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    tab.history.push(url);
    tab.historyIndex = tab.history.length - 1;
  }
  try { tab.title = new URL(url).hostname; } catch { tab.title = "Loading…"; }
  renderTabs(); address.value = url;
  home.classList.add("hidden"); viewerWrap.classList.remove("hidden"); errorEl.classList.add("hidden");
  statusEl.classList.remove("hidden");
  statusEl.innerHTML = '<span class="spinner"></span> Fetching page…';
  viewer.srcdoc = "";
  try {
    const res = await fetch("/api/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    statusEl.classList.add("hidden");
    // A sandboxed iframe isolates remote markup from the app's origin.
    viewer.srcdoc = data.html;
    viewer.title = `Page from ${new URL(data.finalUrl).hostname}`;
    tab.title = documentTitle(data.html) || new URL(data.finalUrl).hostname;
    renderTabs();
  } catch (err) {
    viewerWrap.classList.add("hidden");
    errorEl.textContent = `Couldn't load this page\n\n${err.message}\n\nTry another public HTTP/HTTPS URL. This demo does not support every website.`;
    errorEl.classList.remove("hidden");
  }
}
function documentTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, "").trim().slice(0, 45) : "";
}
$("addressForm").addEventListener("submit", e => { e.preventDefault(); navigate(address.value); });
$("homeForm").addEventListener("submit", e => { e.preventDefault(); navigate(homeAddress.value); });
$("newTabBtn").addEventListener("click", () => {
  const tab = { id: nextId++, title: "New tab", url: "", history: [], historyIndex: -1 };
  tabs.push(tab); activeId = tab.id; renderTabs(); showCurrent();
});
$("reloadBtn").addEventListener("click", () => { const t = activeTab(); if (t.url) navigate(t.url, false); });
$("backBtn").addEventListener("click", () => {
  const t = activeTab();
  if (t.historyIndex > 0) { t.historyIndex--; navigate(t.history[t.historyIndex], false); }
});
$("forwardBtn").addEventListener("click", () => {
  const t = activeTab();
  if (t.historyIndex < t.history.length - 1) { t.historyIndex++; navigate(t.history[t.historyIndex], false); }
});
document.querySelectorAll("[data-url]").forEach(b => b.addEventListener("click", () => navigate(b.dataset.url)));
renderTabs(); showCurrent();