"use strict";

/* ----------------------------------------------------------------------------
 * OSINT-IG Collector — popup rozszerzenia.
 *
 * Działa w kontekście rozszerzenia z host_permissions do instagram.com, więc
 * zapytania do IG idą z Twoimi cookie sesji (credentials: "include"). Pobiera
 * listy obserwujących/obserwowanych i kopiuje je do schowka. Nic nie wysyła na
 * żaden zewnętrzny serwer — wynik ląduje tylko w schowku i polu tekstowym.
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
    const r = await fetch("https://www.instagram.com/api/v1/accounts/current_user/?edit=false",
      { headers: await igHeaders(), credentials: "include" });
    if (!r.ok) return "";
    const j = await r.json();
    return (j && j.user && j.user.username) || "";
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
  $("who").innerHTML = me ? `zalogowano jako <strong>@${me}</strong>` : "nie zalogowano na Instagramie";
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

$("copysid").addEventListener("click", async () => {
  const sid = await getCookie("sessionid");
  if (!sid) { setStatus("Brak cookie sessionid — zaloguj się na IG.", "err"); return; }
  const ok = await copyText(sid);
  $("out").value = sid;
  setStatus(ok ? "sessionid skopiowany do schowka ✓" : "skopiuj sessionid z pola", ok ? "ok" : "err");
});
