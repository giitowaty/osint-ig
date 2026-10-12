"use strict";

/* ----------------------------------------------------------------------------
 * OSINT-IG — opcjonalna sesja IG (cookie sessionid) do automatycznego pobierania
 * list obserwujących/obserwowanych.
 *
 * sessionid podaje użytkownik (kopiuje z własnej, zalogowanej przeglądarki).
 * Trzymany TYLKO w localStorage przeglądarki; wysyłany do własnego backendu
 * nagłówkiem x-ig-session wyłącznie na czas zapytania; nigdzie nie zapisywany.
 *
 * To scraping przez zalogowaną sesję — przeciw ToS IG, może skutkować blokadą
 * konta. Używaj świadomie, najlepiej z kontem „do zadań specjalnych”.
 * -------------------------------------------------------------------------- */

window.OsintSession = (function () {
  const KEY = "osint-ig-session";
  const UKEY = "osint-ig-session-user";

  function get() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }
  function set(v) { try { localStorage.setItem(KEY, v.trim()); } catch {} }
  function clear() { try { localStorage.removeItem(KEY); localStorage.removeItem(UKEY); } catch {} }
  function active() { return !!get(); }
  function account() { try { return localStorage.getItem(UKEY) || ""; } catch { return ""; } }
  function setAccount(u) { try { u ? localStorage.setItem(UKEY, u) : localStorage.removeItem(UKEY); } catch {} }

  // Weryfikuje cookie sesji i zwraca nazwę zalogowanego konta.
  async function whoami() {
    const session = get();
    if (!session) throw new Error("Brak sesji IG.");
    const res = await fetch("/api/whoami", { headers: { "x-ig-session": session } });
    const data = await res.json().catch(() => ({ ok: false, error: "Zła odpowiedź serwera." }));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setAccount(data.username);
    return data.username;
  }

  async function fetchList(username, type, limit) {
    const session = get();
    if (!session) throw new Error("Brak sesji IG.");
    const url = `/api/list?username=${encodeURIComponent(username)}&type=${encodeURIComponent(type)}${limit ? `&limit=${limit}` : ""}`;
    const res = await fetch(url, { headers: { "x-ig-session": session } });
    const data = await res.json().catch(() => ({ ok: false, error: "Zła odpowiedź serwera." }));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data; // { username, type, count, users:[], truncated }
  }

  function summaryLabel() {
    if (account()) return `· <span style="color:var(--good)">@${account()}</span>`;
    if (active()) return "· <span style=\"color:var(--warn)\">sesja ustawiona</span>";
    return "";
  }

  // Panel ustawień sesji (details). onChange wywoływany po zapisie/czyszczeniu.
  function settingsNode(onChange) {
    const wrap = document.createElement("details");
    wrap.className = "b-paste sess";
    wrap.innerHTML = `
      <summary>🔐 Sesja IG (opcjonalnie — auto-pobieranie list) ${summaryLabel()}</summary>
      <div class="b-paste-body">
        <p class="sess-warn">🚫 <strong>Nie używaj swojego głównego konta Instagrama.</strong>
          To scraping przez zalogowaną sesję — przeciw ToS IG i realnie grozi
          <strong>ograniczeniem lub blokadą konta</strong>. Użyj osobnego konta „do zadań specjalnych”.</p>
        <p class="disclaimer" style="margin:0">Cookie trzymane jest tylko w tej przeglądarce i wysyłane do Twojego backendu wyłącznie na czas zapytania; nigdzie nie zapisywane.</p>
        <div class="sess-active" id="sess-active" ${account() ? "" : "hidden"}>
          Aplikacja korzysta z konta: <strong>@<span id="sess-acc">${account()}</span></strong>
        </div>
        <input type="password" id="sess-input" placeholder="wklej sessionid (cookie z instagram.com)" />
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn-ghost" id="sess-save">Zapisz i sprawdź konto</button>
          <button type="button" class="btn-ghost" id="sess-clear">Wyczyść</button>
          <span class="muted" id="sess-status">${account() ? "Zalogowano jako @" + account() + "." : active() ? "Sesja ustawiona (niezweryfikowana)." : "Brak sesji."}</span>
        </div>
        <details class="sess-how"><summary>Jak zdobyć sessionid?</summary>
          <ol class="b-steps">
            <li>Zaloguj się na <strong>instagram.com</strong> (najlepiej na koncie „do zadań specjalnych”).</li>
            <li>Otwórz narzędzia deweloperskie (F12) → zakładka <strong>Application/Aplikacja</strong> → Cookies → instagram.com.</li>
            <li>Skopiuj wartość cookie <strong>sessionid</strong> i wklej wyżej.</li>
          </ol>
        </details>
      </div>`;
    const statusEl = wrap.querySelector("#sess-status");
    const activeBox = wrap.querySelector("#sess-active");
    const accEl = wrap.querySelector("#sess-acc");
    wrap.querySelector("#sess-save").addEventListener("click", async () => {
      const v = wrap.querySelector("#sess-input").value.trim();
      if (!v) return;
      set(v); setAccount("");
      statusEl.textContent = "Sprawdzam konto…";
      try {
        const u = await whoami();
        statusEl.innerHTML = `Zalogowano jako <strong>@${u}</strong>.`;
        accEl.textContent = u; activeBox.hidden = false;
      } catch (e) {
        statusEl.textContent = `Zapisano, ale nie zweryfikowano: ${e.message}`;
        activeBox.hidden = true;
      }
      if (onChange) onChange();
    });
    wrap.querySelector("#sess-clear").addEventListener("click", () => {
      clear(); wrap.querySelector("#sess-input").value = "";
      statusEl.textContent = "Sesja usunięta."; activeBox.hidden = true;
      if (onChange) onChange();
    });
    return wrap;
  }

  return { get, set, clear, active, account, whoami, fetchList, settingsNode };
})();
