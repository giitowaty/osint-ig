"use strict";

/* ----------------------------------------------------------------------------
 * OSINT-IG Collector — popup rozszerzenia.
 *
 * Działa w kontekście rozszerzenia z host_permissions do instagram.com, więc
 * zapytania do IG idą z Twoimi cookie sesji (credentials: "include"). Pobiera
 * listy obserwujących/obserwowanych i kopiuje je do schowka. Nic nie wysyła na
 * żaden zewnętrzny serwer — listy lądują w schowku i polu tekstowym.
 * Przycisk Połącz przekazuje ciasteczka do lokalnej aplikacji OSINT-IG.
 * -------------------------------------------------------------------------- */

const IG_APP_ID = "936619743392459";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

async function getCookie(name) {
  try {
    const c = await chrome.cookies.get({ url: "https://www.instagram.com", name });
    return c ? c.value : "";
  } catch { return ""; }
}

async function igHeaders() {
  const csrf = await getCookie("csrftoken");
  const h = { "x-ig-app-id": IG_APP_ID, "x-requested-with": "XMLHttpRequest" };
  if (csrf) h["x-csrftoken"] = csrf;
  return h;
}

async function whoami() {
  try {
    const r = await fetch("https://www.instagram.com/graphql/query/?query_hash=d6f4427fbe92d846298cf93df0b937d3&variables=%7B%7D",
      { headers: await igHeaders(), credentials: "include" });
    if (!r.ok) return "";
    const j = await r.json();
    return (j && j.data && j.data.user && j.data.user.username) || "";
  } catch { return ""; }
}

async function resolveId(username) {
  const r = await fetch(
    "https://www.instagram.com/api/v1/users/web_profile_info/?username=" + encodeURIComponent(username),
    { headers: await igHeaders(), credentials: "include" });
  if (r.status === 401 || r.status === 403) throw new Error("Zaloguj się na Instagramie.");
  if (!r.ok) throw new Error("web_profile_info HTTP " + r.status);
  const j = await r.json();
  const id = j && j.data && j.data.user && j.data.user.id;
  if (!id) throw new Error("Nie znaleziono profilu.");
  return id;
}

async function fetchList(username, type, limit, onProgress) {
  const id = await resolveId(username);
  const path = type === "following" ? "following" : "followers";
  const cap = Math.min(Math.max(1, limit || 500), 10000);
  const out = [];
  let maxId = "", pages = 0;
  while (out.length < cap && pages < Math.ceil(cap / 50) + 4) {
    const url = `https://www.instagram.com/api/v1/friendships/${id}/${path}/?count=50` +
      (maxId ? `&max_id=${encodeURIComponent(maxId)}` : "");
    const r = await fetch(url, { headers: await igHeaders(), credentials: "include" });
    if (r.status === 401 || r.status === 403) throw new Error("Brak dostępu (sesja/konto prywatne).");
    if (r.status === 429) throw new Error("Limit IG (429) — odczekaj chwilę.");
    if (!r.ok) break;
    const j = await r.json();
    const names = (j.users || []).map((u) => u && u.username).filter(Boolean);
    if (!names.length) break;
    for (const n of names) out.push(n);
    if (onProgress) onProgress(out.length);
    if (!j.next_max_id) break;
    maxId = j.next_max_id; pages++;
    await sleep(450);
  }
  return out.slice(0, cap);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const t = $("out"); t.value = text; t.select();
    try { document.execCommand("copy"); return true; } catch { return false; }
  }
}

/* ------------------------------- UI ------------------------------------- */

(async () => {
  const me = await whoami();
  $("who").textContent = me ? `zalogowano jako @${me}` : "nie zalogowano na Instagramie";
})();

$("go").addEventListener("click", async () => {
  const username = $("target").value.trim().replace(/^@+/, "");
  const type = $("type").value;
  const limit = parseInt($("limit").value, 10) || 500;
  if (!username) { setStatus("Podaj username profilu.", "err"); return; }

  const btn = $("go"); btn.disabled = true;
  setStatus(`Pobieram ${type === "following" ? "obserwowanych" : "obserwujących"} @${username}…`);
  $("out").value = "";
  try {
    const users = await fetchList(username, type, limit, (n) => setStatus(`Pobrano ${n}…`));
    const text = users.join("\n");
    $("out").value = text;
    const ok = await copyText(text);
    setStatus(`${users.length} kont ${ok ? "skopiowano do schowka ✓" : "(skopiuj ręcznie z pola)"}`, "ok");
  } catch (e) {
    setStatus("Błąd: " + e.message, "err");
  } finally { btn.disabled = false; }
});

/* ------------------- Paczka ciasteczek dla aplikacji --------------------- */

// Ta sama biała lista co w aplikacji i na serwerze OSINT-IG.
const ALLOWED = ["sessionid", "ds_user_id", "csrftoken", "mid", "ig_did", "ig_nrcb", "rur", "datr", "shbid", "shbts", "wd", "dpr"];

async function cookieBundle() {
  const all = await chrome.cookies.getAll({ domain: "instagram.com" });
  const cookies = all
    .filter((c) => ALLOWED.includes(c.name) && /(^|\.)instagram\.com$/.test(c.domain.replace(/^\./, "")))
    .map((c) => ({ name: c.name, value: c.value, domain: c.domain, expirationDate: c.expirationDate }));
  if (!cookies.some((c) => c.name === "sessionid")) throw new Error("Brak sessionid — zaloguj się na instagram.com w tej przeglądarce.");
  const account = await whoami();
  const json = JSON.stringify({ v: 1, source: "osint-ig-extension", exportedAt: new Date().toISOString(), account, cookies });
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { text: "OSINTIG1:" + b64, count: cookies.length, account };
}

$("copycookies").addEventListener("click", async () => {
  const btn = $("copycookies"); btn.disabled = true;
  try {
    const b = await cookieBundle();
    let ok = false;
    try { await navigator.clipboard.writeText(b.text); ok = true; } catch { ok = false; }
    if (ok) {
      setStatus(`Skopiowano ${b.count} ciasteczek${b.account ? " konta @" + b.account : ""} ✓ Wklej w OSINT-IG: Ctrl+V.`, "ok");
    } else {
      // Bez dostępu do schowka: pokaż do ręcznego skopiowania (wartość jest tajna — nie zostawiaj jej na widoku).
      $("out").value = b.text; $("out").select();
      setStatus("Skopiuj paczkę z pola poniżej (Ctrl+C), potem wyczyść pole.", "err");
    }
  } catch (e) {
    setStatus("Błąd: " + e.message, "err");
  } finally { btn.disabled = false; }
});

$("connect").addEventListener("click", async () => {
  const btn = $("connect"); btn.disabled = true;
  const base = "http://127.0.0.1:17654/api/extension";
  const request = async (path, options = {}) => {
    let res;
    try {
      res = await fetch(base + path, { ...options, signal: AbortSignal.timeout(5000),
        headers: { "x-osint-bridge": "1", "x-osint-extension": chrome.runtime.id, ...options.headers } });
    } catch {
      throw new Error("Nie można połączyć z aplikacją. Uruchom aktualną aplikację OSINT-IG i spróbuj ponownie.");
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Połączenie z aplikacją nie powiodło się.");
    return data;
  };
  try {
    setStatus("Łączę z aplikacją OSINT-IG…");
    const bundle = await cookieBundle();
    const { id } = await request("/connect", { method: "POST", body: bundle.text,
      headers: { "content-type": "text/plain" } });
    setStatus("Aplikacja sprawdza sesję na Instagramie…");
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await sleep(700);
      const { state } = await request("/status", { headers: { "x-osint-transfer": id } });
      if (state === "connected") { setStatus("Połączono z aplikacją OSINT-IG ✓", "ok"); return; }
      if (state === "failed") throw new Error("Nie udało się potwierdzić sesji. Szczegóły znajdziesz w aplikacji → Sesja IG.");
      if (state === "expired") break;
    }
    throw new Error("Aplikacja nie potwierdziła połączenia. Otwórz ją i spróbuj ponownie.");
  } catch (e) {
    setStatus(e.message, "err");
  } finally { btn.disabled = false; }
});

$("copysid").addEventListener("click", async () => {
  const sid = await getCookie("sessionid");
  if (!sid) { setStatus("Brak cookie sessionid — zaloguj się na IG.", "err"); return; }
  const ok = await copyText(sid);
  $("out").value = sid;
  setStatus(ok ? "sessionid skopiowany do schowka ✓" : "skopiuj sessionid z pola", ok ? "ok" : "err");
});
