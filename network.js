"use strict";

/* ----------------------------------------------------------------------------
 * OSINT-IG — zakładka „Sieć”: wspólny panel sterowania + przełącznik widoku
 * Graf ⇄ Bąbelki. Jedna lista kont zasila oba widoki. Powiązania: oznaczenia/
 * wzmianki/współautorstwo (publiczne) oraz ręcznie wklejone / pobrane sesją
 * listy obserwujących i obserwowanych.
 * -------------------------------------------------------------------------- */

window.OsintNetwork = (function () {
  const SVGNS = "http://www.w3.org/2000/svg";
  const W = 760, H = 500;

  const AUTO_KEY = "osint-ig-autofetch";
  let host = null, fetchFn = null, status = "", view = "graf";
  const accounts = new Map(); // username -> { connections:[{username,count}], following:[], followers:[] }

  const autoOn = () => { try { return localStorage.getItem(AUTO_KEY) === "1"; } catch { return false; } };
  const setAuto = (v) => { try { localStorage.setItem(AUTO_KEY, v ? "1" : "0"); } catch {} };
  const sessionReady = () => !!(window.OsintSession && window.OsintSession.active());

  // Pobiera obie listy (obserwujący + obserwowani) danego konta z sesji IG.
  async function autoFetchFor(u) {
    if (!sessionReady()) return;
    for (const type of ["followers", "following"]) {
      try {
        const r = await window.OsintSession.fetchList(u, type);
        const acc = accounts.get(u); if (acc) acc[type] = r.users || [];
      } catch (e) { status = `Auto-pobieranie @${u}: ${e.message}`; }
    }
  }

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
      const u = norm(tok); if (u.length >= 2) out.push(u);
    }
    return [...new Set(out)];
  }
  const newAcc = (connections) => ({ connections: (connections || []).slice(), following: [], followers: [] });

  function init(el, fetch, seedUsername, seedConnections) {
    host = el; fetchFn = fetch; status = ""; view = "graf"; accounts.clear();
    if (seedUsername) accounts.set(norm(seedUsername), newAcc(seedConnections));
    render();
  }

  async function addAccount(raw) {
    const u = norm(raw);
    if (!u) return;
    if (accounts.has(u)) { status = `@${u} jest już w sieci.`; render(); return; }
    status = `Pobieram @${u}…`; render();
    let added = u;
    try {
      const data = await fetchFn(u);
      added = data.profile.username || u;
      accounts.set(added, newAcc(data.connections));
      status = "";
    } catch (e) { status = `Nie udało się dodać @${u}: ${e.message}`; render(); return; }
    // Auto-pobieranie list z sesji (jeśli włączone).
    if (autoOn() && sessionReady()) {
      status = `Auto-pobieram listy @${added}…`; render();
      await autoFetchFor(added);
      status = `Dodano @${added} i pobrano listy.`;
    }
    render();
  }
  function removeAccount(u) { accounts.delete(norm(u)); render(); }
  function setList(u, type, text) {
    const acc = accounts.get(norm(u)); if (!acc) return;
    const key = type === "follower" ? "followers" : "following";
    acc[key] = parseList(text);
    status = `Wczytano ${acc[key].length} kont (${type === "follower" ? "obserwujący" : "obserwowani"}) dla @${norm(u)}.`;
    render();
  }

  // Panel sterowania: pobierz listy wszystkich kont przez sesję IG.
  async function batchFetch() {
    if (!window.OsintSession || !window.OsintSession.active()) {
      status = "Najpierw ustaw sesję IG (panel 🔐 poniżej)."; render(); return;
    }
    const list = [...accounts.keys()];
    let done = 0;
    for (const u of list) {
      status = `Pobieram listy ${done + 1}/${list.length}: @${u}…`; render();
      for (const type of ["followers", "following"]) {
        try {
          const r = await window.OsintSession.fetchList(u, type);
          accounts.get(u)[type] = r.users || [];
        } catch (e) { status = `Błąd przy @${u}: ${e.message}`; }
      }
      done++;
    }
    status = `Gotowe — pobrano listy dla ${done} kont.`; render();
  }

  /* ----------------------------- Modele ---------------------------------- */
  function graphModel() {
    const nodes = new Map();
    const node = (id, a) => { let n = nodes.get(id); if (!n) { n = { id, analyzed: false, sources: new Set(), weight: 0 }; nodes.set(id, n); } if (a) n.analyzed = true; return n; };
    const links = [];
    for (const [u, info] of accounts) {
      node(u, true);
      const addRef = (name, w, type) => {
        const nm = norm(name); if (!nm || nm === u) return;
        const b = node(nm, false); b.sources.add(u); b.weight += w;
        if (type === "follower") links.push({ sId: nm, tId: u, weight: w, type });
        else links.push({ sId: u, tId: nm, weight: w, type });
      };
      for (const c of info.connections || []) addRef(c.username, c.count || 1, "ref");
      for (const f of info.following || []) addRef(f, 1, "following");
      for (const f of info.followers || []) addRef(f, 1, "follower");
    }
    for (const n of nodes.values()) n.shared = n.sources.size >= 2;
    return { nodes: [...nodes.values()], links };
  }

  function bubbleData() {
    const own = new Set([...accounts.keys()]);
    const map = new Map();
    for (const [u, acc] of accounts) {
      const entries = [
        ...(acc.connections || []).map((c) => [norm(c.username), c.count || 1]),
        ...(acc.following || []).map((n) => [norm(n), 1]),
        ...(acc.followers || []).map((n) => [norm(n), 1]),
      ];
      for (const [name, val] of entries) {
        if (!name || name === u) continue;
        let m = map.get(name); if (!m) { m = { value: 0, sources: new Set() }; map.set(name, m); }
        m.value += val; m.sources.add(u);
      }
    }
    return [...map.entries()]
      .map(([name, m]) => ({ name, value: m.value, sources: m.sources, shared: m.sources.size >= 2, ownAccount: own.has(name) }))
      .sort((a, b) => b.value - a.value);
  }

  /* ----------------------------- Render ---------------------------------- */
  function render() {
    if (!host) return;
    const accList = [...accounts.keys()];
    const chips = accList.map((u) => {
      const a = accounts.get(u); const parts = [];
      if (a.following && a.following.length) parts.push(`obs-ni:${a.following.length}`);
      if (a.followers && a.followers.length) parts.push(`obs:${a.followers.length}`);
      const tag = parts.length ? ` <span class="b-src">${parts.join(" ")}</span>` : "";
      return `<span class="g-chip">@${esc(u)}${tag} <button type="button" class="g-x" data-u="${esc(u)}" title="usuń">×</button></span>`;
    }).join("");
    const opts = accList.map((u) => `<option value="${esc(u)}">@${esc(u)}</option>`).join("");
    const sessActive = window.OsintSession && window.OsintSession.active();

    host.innerHTML = `
      <div class="net-head">
        <h2 class="section-title" style="margin:0">Sieć powiązań</h2>
        <div class="view-toggle">
          <button type="button" class="vt ${view === "graf" ? "active" : ""}" data-view="graf">🕸️ Graf</button>
          <button type="button" class="vt ${view === "bable" ? "active" : ""}" data-view="bable">🫧 Bąbelki</button>
        </div>
      </div>
      <p class="muted" style="margin:0 2px 10px">Jedna lista kont zasila oba widoki. Konto wskazywane przez
        <span style="color:var(--accent-2)">≥2 profile</span> jest wyróżnione jako wspólne powiązanie.</p>

      <form class="g-form" id="net-form">
        <div class="field-input" style="flex:1"><span class="at">@</span>
          <input type="text" id="net-input" placeholder="konto do dodania" spellcheck="false" /></div>
        <button type="submit" class="btn-ghost">Dodaj</button>
      </form>
      <div class="g-chips">${chips || '<span class="muted">Brak kont w sieci.</span>'}</div>

      ${accList.length ? `
      <div class="net-panel">
        <div class="net-panel-row">
          <strong>Panel sterowania:</strong>
          <button type="button" class="btn-ghost" id="net-batch">⤓ Pobierz listy wszystkich kont z sesji IG</button>
          ${sessActive && window.OsintSession.account() ? `<span class="sess-badge">sesja: @${esc(window.OsintSession.account())}</span>` : ""}
        </div>
        <label class="net-auto" title="${sessActive ? "" : "Najpierw ustaw sesję IG poniżej"}">
          <input type="checkbox" id="net-auto" ${autoOn() ? "checked" : ""} ${sessActive ? "" : "disabled"} />
          Automatycznie pobieraj listy z sesji przy dodawaniu konta
        </label>
      </div>
      <details class="b-paste">
        <summary>Wklej / pobierz listę znajomych dla jednego konta</summary>
        <div class="b-paste-body">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select id="net-acc">${opts}</select>
            <select id="net-type">
              <option value="following">Obserwowani (to konto obserwuje)</option>
              <option value="follower">Obserwujący (obserwują to konto)</option>
            </select>
          </div>
          <textarea id="net-text" rows="4" placeholder="Wklej nazwy kont — po spacji, przecinku lub w nowych liniach. @ opcjonalne."></textarea>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn-ghost" id="net-apply">Zastosuj do wybranego konta</button>
            <button type="button" class="btn-ghost" id="net-fetch">⤓ Pobierz z sesji IG</button>
          </div>
        </div>
      </details>` : ""}
      ${status ? `<p class="muted" style="margin:8px 2px">${esc(status)}</p>` : ""}

      <div class="g-canvas" id="net-canvas"></div>
      <div class="g-legend" id="net-legend"></div>`;

    host.querySelector("#net-form").addEventListener("submit", (e) => {
      e.preventDefault(); const inp = host.querySelector("#net-input"); addAccount(inp.value); inp.value = "";
    });
    host.querySelectorAll(".g-x").forEach((b) => b.addEventListener("click", () => removeAccount(b.dataset.u)));
    host.querySelectorAll(".vt").forEach((b) => b.addEventListener("click", () => { view = b.dataset.view; render(); }));
    const batch = host.querySelector("#net-batch");
    if (batch) batch.addEventListener("click", batchFetch);
    const autoBox = host.querySelector("#net-auto");
    if (autoBox) autoBox.addEventListener("change", () => setAuto(autoBox.checked));
    const apply = host.querySelector("#net-apply");
    if (apply) apply.addEventListener("click", () =>
      setList(host.querySelector("#net-acc").value, host.querySelector("#net-type").value, host.querySelector("#net-text").value));
    const fetchBtn = host.querySelector("#net-fetch");
    if (fetchBtn) fetchBtn.addEventListener("click", async () => {
      if (!window.OsintSession || !window.OsintSession.active()) { status = "Najpierw ustaw sesję IG (panel 🔐 poniżej)."; render(); return; }
      const uu = host.querySelector("#net-acc").value, tt = host.querySelector("#net-type").value;
      status = `Pobieram listę dla @${uu}…`; render();
      try { const r = await window.OsintSession.fetchList(uu, tt === "follower" ? "followers" : "following"); setList(uu, tt, (r.users || []).join("\n")); }
      catch (e) { status = `Nie udało się pobrać: ${e.message}`; render(); }
    });

    const pasteBody = host.querySelector(".b-paste-body");
    if (pasteBody && window.OsintCollector) pasteBody.appendChild(window.OsintCollector.helpNode());
    if (pasteBody && window.OsintSession) pasteBody.appendChild(window.OsintSession.settingsNode());

    draw();
  }

  function draw() {
    const canvas = host.querySelector("#net-canvas");
    const legend = host.querySelector("#net-legend");
    if (view === "bable") { legend.innerHTML = legendBubble(); drawBubble(canvas); }
    else { legend.innerHTML = legendGraph(); drawGraph(canvas); }
  }

  const legendGraph = () => `
    <span><span class="g-dot analyzed"></span>analizowane</span>
    <span><span class="g-dot ref"></span>powiązane</span>
    <span><span class="g-dot shared"></span>wspólne (≥2)</span>
    <span><span class="g-dot" style="background:#3897f0"></span>obserwuje →</span>
    <span><span class="g-dot" style="background:#3fb950"></span>obserwujący →</span>`;
  const legendBubble = () => `
    <span><span class="g-dot ref"></span>powiązane konto</span>
    <span><span class="g-dot shared"></span>wspólne (≥2 profile)</span>`;

  /* ----------------------------- Graf ------------------------------------ */
  function layoutGraph(nodes, links) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const l of links) { l.s = byId.get(l.sId); l.t = byId.get(l.tId); }
    nodes.forEach((n, i) => { const a = (2 * Math.PI * i) / Math.max(1, nodes.length); n.x = W / 2 + Math.cos(a) * 140 + (Math.random() - 0.5) * 20; n.y = H / 2 + Math.sin(a) * 140 + (Math.random() - 0.5) * 20; });
    const K = 110, ITER = 300;
    for (let it = 0; it < ITER; it++) {
      const t = 1 - it / ITER;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d = Math.hypot(dx, dy) || 0.01;
        const rep = 2600 / (d * d), fx = (dx / d) * rep, fy = (dy / d) * rep;
        nodes[i].x += fx * t * 6; nodes[i].y += fy * t * 6; nodes[j].x -= fx * t * 6; nodes[j].y -= fy * t * 6;
      }
      for (const l of links) { if (!l.s || !l.t) continue; let dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.hypot(dx, dy) || 0.01; const f = ((d - K) / d) * 0.09 * t; l.s.x += dx * f; l.s.y += dy * f; l.t.x -= dx * f; l.t.y -= dy * f; }
      for (const n of nodes) { n.x += (W / 2 - n.x) * 0.012 * t; n.y += (H / 2 - n.y) * 0.012 * t; }
    }
    for (const n of nodes) { n.x = Math.max(30, Math.min(W - 30, n.x)); n.y = Math.max(26, Math.min(H - 26, n.y)); }
  }
  const gRadius = (n) => n.analyzed ? 15 : Math.min(13, 6 + n.weight);

  function drawGraph(canvas) {
    const { nodes, links } = graphModel();
    if (!nodes.length) { canvas.innerHTML = `<p class="muted" style="text-align:center;padding:40px 0">Dodaj konto, aby zbudować sieć.</p>`; return; }
    layoutGraph(nodes, links);
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "g-svg");
    const refs = new Map();
    const color = { ref: "var(--border)", following: "#3897f0", follower: "#3fb950" };
    for (const l of links) {
      if (!l.s || !l.t) continue;
      const line = document.createElementNS(SVGNS, "line");
      line.setAttribute("stroke", color[l.type] || "var(--border)");
      line.setAttribute("stroke-width", String(Math.min(4, 1 + (l.weight - 1) * 0.6)));
      line.setAttribute("stroke-opacity", l.type === "ref" ? "0.8" : "0.6");
      svg.appendChild(line); l.el = line;
    }
    for (const n of nodes) {
      const g = document.createElementNS(SVGNS, "g"); g.style.cursor = "grab";
      const c = document.createElementNS(SVGNS, "circle"); c.setAttribute("r", String(gRadius(n)));
      c.setAttribute("class", n.analyzed ? "n-analyzed" : n.shared ? "n-shared" : "n-ref");
      const title = document.createElementNS(SVGNS, "title"); title.textContent = `@${n.id}${n.analyzed ? " (analizowane)" : ""}${n.shared ? " — wspólne" : ""}`;
      g.appendChild(c); g.appendChild(title);
      let label = null;
      if (n.analyzed || n.shared) { label = document.createElementNS(SVGNS, "text"); label.setAttribute("class", "g-label"); label.setAttribute("text-anchor", "middle"); label.textContent = "@" + n.id; g.appendChild(label); }
      svg.appendChild(g); refs.set(n, { c, label });
      enableDrag(g, n, () => syncGraph(nodes, links, refs));
    }
    canvas.innerHTML = ""; canvas.appendChild(svg); syncGraph(nodes, links, refs);
  }
  function syncGraph(nodes, links, refs) {
    for (const l of links) { if (!l.el || !l.s || !l.t) continue; l.el.setAttribute("x1", l.s.x); l.el.setAttribute("y1", l.s.y); l.el.setAttribute("x2", l.t.x); l.el.setAttribute("y2", l.t.y); }
    for (const n of nodes) { const r = refs.get(n); if (!r) continue; r.c.setAttribute("cx", n.x); r.c.setAttribute("cy", n.y); if (r.label) { r.label.setAttribute("x", n.x); r.label.setAttribute("y", n.y - gRadius(n) - 5); } }
  }
  function enableDrag(g, n, onMove) {
    let dragging = false;
    const toSvg = (ev) => { const s = g.ownerSVGElement, pt = s.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; return pt.matrixTransform(s.getScreenCTM().inverse()); };
    g.addEventListener("pointerdown", (ev) => { dragging = true; g.setPointerCapture(ev.pointerId); g.style.cursor = "grabbing"; });
    g.addEventListener("pointermove", (ev) => { if (!dragging) return; const p = toSvg(ev); n.x = Math.max(20, Math.min(W - 20, p.x)); n.y = Math.max(20, Math.min(H - 20, p.y)); onMove(); });
    const end = (ev) => { dragging = false; g.style.cursor = "grab"; try { g.releasePointerCapture(ev.pointerId); } catch {} };
    g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
  }

  /* ---------------------------- Bąbelki ---------------------------------- */
  function packBubble(nodes) {
    nodes.forEach((n) => { n.x = W / 2 + (Math.random() - 0.5) * 60; n.y = H / 2 + (Math.random() - 0.5) * 60; });
    for (let it = 0; it < 320; it++) {
      for (const n of nodes) { n.x += (W / 2 - n.x) * 0.02; n.y += (H / 2 - n.y) * 0.02; }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01; const min = a.r + b.r + 2;
        if (d < min) { const p = (min - d) / d / 2; dx *= p; dy *= p; a.x -= dx; a.y -= dy; b.x += dx; b.y += dy; }
      }
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) { minX = Math.min(minX, n.x - n.r); maxX = Math.max(maxX, n.x + n.r); minY = Math.min(minY, n.y - n.r); maxY = Math.max(maxY, n.y + n.r); }
    const dx = W / 2 - (minX + maxX) / 2, dy = H / 2 - (minY + maxY) / 2;
    for (const n of nodes) { n.x += dx; n.y += dy; n.x = Math.max(n.r + 2, Math.min(W - n.r - 2, n.x)); n.y = Math.max(n.r + 2, Math.min(H - n.r - 2, n.y)); }
  }

  function drawBubble(canvas) {
    const data = bubbleData();
    if (!data.length) { canvas.innerHTML = `<p class="muted" style="text-align:center;padding:40px 0">Dodaj konta (lub wczytaj listy), aby zbudować bąble.</p>`; return; }
    const max = data[0].value || 1;
    const nodes = data.slice(0, 80).map((d) => ({ ...d, r: 9 + Math.sqrt(d.value / max) * 34 }));
    packBubble(nodes);
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "g-svg");
    for (const n of nodes) {
      const g = document.createElementNS(SVGNS, "g");
      const c = document.createElementNS(SVGNS, "circle"); c.setAttribute("cx", n.x); c.setAttribute("cy", n.y); c.setAttribute("r", n.r);
      c.setAttribute("class", n.shared ? "b-shared" : "b-ref");
      const title = document.createElementNS(SVGNS, "title"); title.textContent = `@${n.name} — ${n.value} (u ${n.sources.size} z ${accounts.size})`;
      g.appendChild(c); g.appendChild(title);
      if (n.r >= 20) { const label = document.createElementNS(SVGNS, "text"); label.setAttribute("x", n.x); label.setAttribute("y", n.y + 3); label.setAttribute("text-anchor", "middle"); label.setAttribute("class", "b-label"); label.textContent = "@" + (n.name.length > 14 ? n.name.slice(0, 13) + "…" : n.name); g.appendChild(label); }
      svg.appendChild(g);
    }
    canvas.innerHTML = ""; canvas.appendChild(svg);
  }

  return { init, addAccount, removeAccount };
})();
