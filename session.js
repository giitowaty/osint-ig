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

  function get() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }
  function set(v) { try { localStorage.setItem(KEY, v.trim()); } catch {} }
  function clear() { try { localStorage.removeItem(KEY); } catch {} }
  function active() { return !!get(); }

  async function fetchList(username, type, limit) {
    const session = get();
    if (!session) throw new Error("Brak sesji IG.");
    const url = `/api/list?username=${encodeURIComponent(username)}&type=${encodeURIComponent(type)}${limit ? `&limit=${limit}` : ""}`;
    const res = await fetch(url, { headers: { "x-ig-session": session } });
    const data = await res.json().catch(() => ({ ok: false, error: "Zła odpowiedź serwera." }));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data; // { username, type, count, users:[], truncated }
  }

  // Panel ustawień sesji (details). onChange wywoływany po zapisie/czyszczeniu.
  function settingsNode(onChange) {
    const wrap = document.createElement("details");
    wrap.className = "b-paste sess";
    wrap.innerHTML = `
      <summary>🔐 Sesja IG (opcjonalnie — auto-pobieranie list) ${active() ? "· <span style=\"color:var(--good)\">aktywna</span>" : ""}</summary>
      <div class="b-paste-body">
        <p class="disclaimer" style="margin:0">⚠ Scraping przez zalogowaną sesję — przeciw ToS Instagrama, może skutkować blokadą konta.
          Cookie trzymane jest tylko w tej przeglądarce i wysyłane do Twojego backendu wyłącznie na czas zapytania.</p>
        <input type="password" id="sess-input" placeholder="wklej sessionid (cookie z instagram.com)" value="${get() ? "" : ""}" />
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn-ghost" id="sess-save">Zapisz</button>
          <button type="button" class="btn-ghost" id="sess-clear">Wyczyść</button>
          <span class="muted" id="sess-status">${active() ? "Sesja ustawiona." : "Brak sesji."}</span>
        </div>
        <details class="sess-how"><summary>Jak zdobyć sessionid?</summary>
          <ol class="b-steps">
            <li>Zaloguj się na <strong>instagram.com</strong> w przeglądarce.</li>
            <li>Otwórz narzędzia deweloperskie (F12) → zakładka <strong>Application/Aplikacja</strong> → Cookies → instagram.com.</li>
            <li>Skopiuj wartość cookie <strong>sessionid</strong> i wklej wyżej.</li>
          </ol>
        </details>
      </div>`;
    wrap.querySelector("#sess-save").addEventListener("click", () => {
      const v = wrap.querySelector("#sess-input").value.trim();
      if (v) { set(v); wrap.querySelector("#sess-status").textContent = "Sesja zapisana."; if (onChange) onChange(); }
    });
    wrap.querySelector("#sess-clear").addEventListener("click", () => {
      clear(); wrap.querySelector("#sess-input").value = ""; wrap.querySelector("#sess-status").textContent = "Sesja usunięta."; if (onChange) onChange();
    });
    return wrap;
  }

  return { get, set, clear, active, fetchList, settingsNode };
})();
