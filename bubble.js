"use strict";

/* ----------------------------------------------------------------------------
 * OSINT-IG — bubble map (pakowane koła) nakładających się powiązań.
 *
 * Dla kilku wprowadzonych kont zbiera listy powiązanych kont i rysuje je jako
 * bąble: wielkość = częstość/liczba wystąpień, a konto pojawiające się u ≥2
 * profili jest wyróżnione (wspólne).
 *
 * Źródło list per konto:
 *   - domyślnie: konta oznaczane/wzmiankowane/współtworzone (dane publiczne),
 *   - opcjonalnie: ręcznie wklejona lista (np. obserwujący/obserwowani), bo
 *     tych IG nie udostępnia publicznie bez logowania.
 * -------------------------------------------------------------------------- */

window.OsintBubble = (function () {
  const SVGNS = "http://www.w3.org/2000/svg";
  const W = 760, H = 500;

  let host = null, fetchFn = null, status = "";
  const accounts = new Map(); // username -> { connections:[{username,count}], pasted:[usernames]|null }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  const norm = (u) => String(u || "").toLowerCase().replace(/^@+/, "")
    .replace(/.*instagram\.com\//, "").replace(/[/?#].*$/, "").trim();

  function parseList(text) {
    const out = [];
    for (const tok of String(text || "").split(/[\s,;]+/)) {
      const u = norm(tok);
      if (u.length >= 2) out.push(u);
    }
    return [...new Set(out)];
  }

  function init(el, fetch, seedUsername, seedConnections) {
    host = el; fetchFn = fetch; status = ""; accounts.clear();
    if (seedUsername) accounts.set(norm(seedUsername), { connections: (seedConnections || []).slice(), pasted: null });
    render();
  }

  async function addAccount(raw) {
    const u = norm(raw);
    if (!u) return;
    if (accounts.has(u)) { status = `@${u} jest już na mapie.`; render(); return; }
    status = `Pobieram @${u}…`; render();
    try {
      const data = await fetchFn(u);
      accounts.set(data.profile.username || u, { connections: data.connections || [], pasted: null });
      status = "";
    } catch (e) { status = `Nie udało się dodać @${u}: ${e.message}`; }
    render();
  }

  function removeAccount(u) { accounts.delete(norm(u)); render(); }

  function setPasted(u, text) {
    const acc = accounts.get(norm(u));
    if (!acc) return;
    const list = parseList(text);
    acc.pasted = list.length ? list : null;
    status = list.length ? `Wczytano ${list.length} kont dla @${norm(u)}.` : "";
    render();
  }

  /* --------------------------- Agregacja --------------------------------- */
  function aggregate() {
    const own = new Set([...accounts.keys()]);
    const map = new Map(); // ref -> { value, sources:Set }
    for (const [u, acc] of accounts) {
      const entries = acc.pasted
        ? acc.pasted.map((name) => [name, 1])
        : (acc.connections || []).map((c) => [norm(c.username), c.count || 1]);
      for (const [name, val] of entries) {
        if (!name || name === u) continue;
        let m = map.get(name);
        if (!m) { m = { value: 0, sources: new Set() }; map.set(name, m); }
        m.value += val;
        m.sources.add(u);
      }
    }
    return [...map.entries()]
      .map(([name, m]) => ({ name, value: m.value, sources: m.sources, shared: m.sources.size >= 2, ownAccount: own.has(name) }))
      .sort((a, b) => b.value - a.value);
  }

  /* --------------------------- Pakowanie kół ----------------------------- */
  function pack(nodes) {
    nodes.forEach((n) => { n.x = W / 2 + (Math.random() - 0.5) * 60; n.y = H / 2 + (Math.random() - 0.5) * 60; });
    for (let it = 0; it < 320; it++) {
      for (const n of nodes) { n.x += (W / 2 - n.x) * 0.02; n.y += (H / 2 - n.y) * 0.02; }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
          const min = a.r + b.r + 2;
          if (d < min) { const p = (min - d) / d / 2; dx *= p; dy *= p; a.x -= dx; a.y -= dy; b.x += dx; b.y += dy; }
        }
      }
    }
    // wyśrodkuj klaster: przesuń środek masy do środka płótna
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) { minX = Math.min(minX, n.x - n.r); maxX = Math.max(maxX, n.x + n.r); minY = Math.min(minY, n.y - n.r); maxY = Math.max(maxY, n.y + n.r); }
    const dx = W / 2 - (minX + maxX) / 2, dy = H / 2 - (minY + maxY) / 2;
    for (const n of nodes) { n.x += dx; n.y += dy; }
    for (const n of nodes) { n.x = Math.max(n.r + 2, Math.min(W - n.r - 2, n.x)); n.y = Math.max(n.r + 2, Math.min(H - n.r - 2, n.y)); }
  }

  /* ----------------------------- Render ---------------------------------- */
  function render() {
    if (!host) return;
    const accList = [...accounts.keys()];
    const chips = accList.map((u) => {
      const acc = accounts.get(u);
      const tag = acc.pasted ? ` <span class="b-src" title="ręczna lista">lista:${acc.pasted.length}</span>` : "";
      return `<span class="g-chip">@${esc(u)}${tag} <button type="button" class="g-x" data-u="${esc(u)}" title="usuń">×</button></span>`;
    }).join("");
    const opts = accList.map((u) => `<option value="${esc(u)}">@${esc(u)}</option>`).join("");

    host.innerHTML = `
      <h2 class="section-title">Bubble map powiązań</h2>
      <p class="muted" style="margin:0 2px 10px">Bąbel = powiązane konto, wielkość = liczba wystąpień.
        Konto u <span style="color:var(--accent-2)">≥2 profili</span> jest wyróżnione (wspólne).
        Listy followersów/obserwowanych nie są dostępne publicznie — możesz je <strong>wkleić ręcznie</strong> poniżej.</p>
      <form class="g-form" id="b-form">
        <div class="field-input" style="flex:1"><span class="at">@</span>
          <input type="text" id="b-input" placeholder="konto do dodania" spellcheck="false" /></div>
        <button type="submit" class="btn-ghost">Dodaj</button>
      </form>
      <div class="g-chips">${chips || '<span class="muted">Brak kont.</span>'}</div>
      ${accList.length ? `
      <details class="b-paste">
        <summary>Wklej listę kont (np. obserwujących / obserwowanych)</summary>
        <div class="b-paste-body">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select id="b-acc">${opts}</select>
            <select id="b-type">
              <option value="followers">Obserwujący</option>
              <option value="following">Obserwowani</option>
            </select>
          </div>
          <textarea id="b-text" rows="4" placeholder="Wklej nazwy kont — po spacji, przecinku lub w nowych liniach. @ opcjonalne."></textarea>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn-ghost" id="b-apply">Zastosuj do wybranego konta</button>
            <button type="button" class="btn-ghost" id="b-fetch">⤓ Pobierz z sesji IG</button>
          </div>
        </div>
      </details>` : ""}
      ${status ? `<p class="muted" style="margin:8px 2px">${esc(status)}</p>` : ""}
      <div class="g-canvas" id="b-canvas"></div>
      <div class="g-legend">
        <span><span class="g-dot ref"></span>powiązane konto</span>
        <span><span class="g-dot shared"></span>wspólne (≥2 profile)</span>
      </div>`;

    host.querySelector("#b-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = host.querySelector("#b-input"); addAccount(inp.value); inp.value = "";
    });
    host.querySelectorAll(".g-x").forEach((b) => b.addEventListener("click", () => removeAccount(b.dataset.u)));
    const apply = host.querySelector("#b-apply");
    if (apply) apply.addEventListener("click", () => {
      setPasted(host.querySelector("#b-acc").value, host.querySelector("#b-text").value);
    });
    const fetchBtn = host.querySelector("#b-fetch");
    if (fetchBtn) fetchBtn.addEventListener("click", async () => {
      if (!window.OsintSession || !window.OsintSession.active()) {
        status = "Najpierw ustaw sesję IG (panel 🔐 poniżej)."; render(); return;
      }
      const uu = host.querySelector("#b-acc").value;
      const tt = host.querySelector("#b-type").value;
      status = `Pobieram listę (${tt === "followers" ? "obserwujący" : "obserwowani"}) dla @${uu}…`; render();
      try {
        const r = await window.OsintSession.fetchList(uu, tt);
        setPasted(uu, r.users.join("\n"));
      } catch (e) { status = `Nie udało się pobrać: ${e.message}`; render(); }
    });

    if (fetchBtn && window.OsintSession && window.OsintSession.account()) {
      const s = document.createElement("span");
      s.className = "sess-badge";
      s.textContent = "sesja: @" + window.OsintSession.account();
      fetchBtn.parentNode.appendChild(s);
    }

    const pasteBody = host.querySelector(".b-paste-body");
    if (pasteBody && window.OsintCollector) pasteBody.appendChild(window.OsintCollector.helpNode());
    if (pasteBody && window.OsintSession) pasteBody.appendChild(window.OsintSession.settingsNode());

    draw(host.querySelector("#b-canvas"));
  }

  function draw(canvas) {
    const data = aggregate();
    if (!data.length) {
      canvas.innerHTML = `<p class="muted" style="text-align:center;padding:40px 0">Dodaj konta (i opcjonalnie wklej listy), aby zbudować mapę.</p>`;
      return;
    }
    const max = data[0].value || 1;
    const nodes = data.slice(0, 80).map((d) => ({
      ...d, r: 9 + Math.sqrt(d.value / max) * 34,
    }));
    pack(nodes);

    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "g-svg");
    for (const n of nodes) {
      const g = document.createElementNS(SVGNS, "g");
      const c = document.createElementNS(SVGNS, "circle");
      c.setAttribute("cx", n.x); c.setAttribute("cy", n.y); c.setAttribute("r", n.r);
      c.setAttribute("class", n.shared ? "b-shared" : "b-ref");
      const title = document.createElementNS(SVGNS, "title");
      title.textContent = `@${n.name} — ${n.value} (u ${n.sources.size} z ${accounts.size}: ${[...n.sources].map((s) => "@" + s).join(", ")})`;
      g.appendChild(c); g.appendChild(title);
      if (n.r >= 20) {
        const label = document.createElementNS(SVGNS, "text");
        label.setAttribute("x", n.x); label.setAttribute("y", n.y + 3);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("class", "b-label");
        label.textContent = "@" + (n.name.length > 14 ? n.name.slice(0, 13) + "…" : n.name);
        g.appendChild(label);
      }
      svg.appendChild(g);
    }
    canvas.innerHTML = ""; canvas.appendChild(svg);
  }

  return { init, addAccount, removeAccount };
})();
