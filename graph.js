"use strict";

/* ----------------------------------------------------------------------------
 * OSINT-IG — graf powiązań między kontami.
 *
 * Węzły: analizowane konta (duże) + konta przez nie oznaczane/wzmiankowane
 * (małe). Krawędzie: „konto A wspomina/oznacza B” (grubość = liczba wystąpień).
 * Konto wskazywane przez ≥2 analizowane profile to wspólne (pośrednie)
 * powiązanie — jest wyróżnione. Symulacja sił i rysowanie bez zależności.
 * -------------------------------------------------------------------------- */

window.OsintGraph = (function () {
  const SVGNS = "http://www.w3.org/2000/svg";
  const W = 760, H = 480;

  let host = null;          // kontener DOM
  let fetchFn = null;       // async (username) => payload
  const analyzed = new Map(); // username -> { connections: [{username,count}] }
  let status = "";

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  const norm = (u) => String(u || "").toLowerCase().replace(/^@+/, "").replace(/.*instagram\.com\//, "").replace(/[/?#].*$/, "").trim();

  function parseList(text) {
    const out = [];
    for (const tok of String(text || "").split(/[\s,;]+/)) {
      const u = norm(tok);
      if (u.length >= 2) out.push(u);
    }
    return [...new Set(out)];
  }

  function newAcc(connections) {
    return { connections: (connections || []).slice(), following: [], followers: [] };
  }

  function init(el, fetch, seedUsername, seedConnections) {
    host = el;
    fetchFn = fetch;
    analyzed.clear();
    status = "";
    if (seedUsername) analyzed.set(norm(seedUsername), newAcc(seedConnections));
    render();
  }

  async function addAccount(raw) {
    const u = norm(raw);
    if (!u) return;
    if (analyzed.has(u)) { status = `@${u} jest już w grafie.`; render(); return; }
    status = `Pobieram @${u}…`;
    render();
    try {
      const data = await fetchFn(u);
      analyzed.set(data.profile.username || u, newAcc(data.connections));
      status = "";
    } catch (e) {
      status = `Nie udało się dodać @${u}: ${e.message}`;
    }
    render();
  }

  function removeAccount(u) {
    analyzed.delete(norm(u));
    render();
  }

  // Ręcznie wklejona lista znajomych dla konta: type = 'following' | 'follower'.
  function setList(u, type, text) {
    const acc = analyzed.get(norm(u));
    if (!acc) return;
    const list = parseList(text);
    const key = type === "follower" ? "followers" : "following";
    acc[key] = list;
    status = `Wczytano ${list.length} kont (${type === "follower" ? "obserwujący" : "obserwowani"}) dla @${norm(u)}.`;
    render();
  }

  /* --------------------------- Model grafu ------------------------------- */
  function buildModel() {
    const nodes = new Map(); // id -> node
    const node = (id, analyzedFlag) => {
      let n = nodes.get(id);
      if (!n) { n = { id, analyzed: false, sources: new Set(), weight: 0 }; nodes.set(id, n); }
      if (analyzedFlag) n.analyzed = true;
      return n;
    };
    const links = [];
    for (const [u, info] of analyzed) {
      node(u, true);
      const addRef = (name, weight, type) => {
        const nm = norm(name);
        if (!nm || nm === u) return;
        const b = node(nm, false);
        b.sources.add(u);
        b.weight += weight;
        // kierunek: s wskazuje na t (s obserwuje/wspomina t).
        if (type === "follower") links.push({ sId: nm, tId: u, weight, type });
        else links.push({ sId: u, tId: nm, weight, type });
      };
      for (const c of info.connections || []) addRef(c.username, c.count || 1, "ref");
      for (const f of info.following || []) addRef(f, 1, "following");
      for (const f of info.followers || []) addRef(f, 1, "follower");
    }
    // „wspólne” = konto wskazywane przez ≥2 analizowane profile
    for (const n of nodes.values()) n.shared = n.sources.size >= 2;
    return { nodes: [...nodes.values()], links };
  }

  /* --------------------------- Symulacja sił ----------------------------- */
  function layout(nodes, links) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const l of links) { l.s = byId.get(l.sId); l.t = byId.get(l.tId); }
    nodes.forEach((n, i) => {
      const a = (2 * Math.PI * i) / Math.max(1, nodes.length);
      n.x = W / 2 + Math.cos(a) * 140 + (Math.random() - 0.5) * 20;
      n.y = H / 2 + Math.sin(a) * 140 + (Math.random() - 0.5) * 20;
    });
    const K = 110, ITER = 300;
    for (let it = 0; it < ITER; it++) {
      const t = 1 - it / ITER;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          let dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          let d = Math.hypot(dx, dy) || 0.01;
          const rep = 2600 / (d * d);
          const fx = (dx / d) * rep, fy = (dy / d) * rep;
          nodes[i].x += fx * t * 6; nodes[i].y += fy * t * 6;
          nodes[j].x -= fx * t * 6; nodes[j].y -= fy * t * 6;
        }
      }
      for (const l of links) {
        if (!l.s || !l.t) continue;
        let dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
        let d = Math.hypot(dx, dy) || 0.01;
        const f = ((d - K) / d) * 0.09 * t;
        l.s.x += dx * f; l.s.y += dy * f; l.t.x -= dx * f; l.t.y -= dy * f;
      }
      for (const n of nodes) { n.x += (W / 2 - n.x) * 0.012 * t; n.y += (H / 2 - n.y) * 0.012 * t; }
    }
    for (const n of nodes) {
      n.x = Math.max(30, Math.min(W - 30, n.x));
      n.y = Math.max(26, Math.min(H - 26, n.y));
    }
  }

  function radius(n) {
    if (n.analyzed) return 15;
    return Math.min(13, 6 + n.weight);
  }

  /* ----------------------------- Render ---------------------------------- */
  function render() {
    if (!host) return;
    const accList = [...analyzed.keys()];
    const chips = accList.map((u) => {
      const a = analyzed.get(u);
      const parts = [];
      if (a.following && a.following.length) parts.push(`obs-ni:${a.following.length}`);
      if (a.followers && a.followers.length) parts.push(`obs:${a.followers.length}`);
      const tag = parts.length ? ` <span class="b-src">${parts.join(" ")}</span>` : "";
      return `<span class="g-chip">@${esc(u)}${tag} <button type="button" class="g-x" data-u="${esc(u)}" title="usuń">×</button></span>`;
    }).join("");
    const opts = accList.map((u) => `<option value="${esc(u)}">@${esc(u)}</option>`).join("");

    host.innerHTML = `
      <h2 class="section-title">Graf powiązań</h2>
      <p class="muted" style="margin:0 2px 10px">Dodawaj konta, by zobaczyć powiązania (oznaczenia, współautorstwo, @wzmianki).
        Konto wskazywane przez kilka profili = <span style="color:var(--accent-2)">wspólne powiązanie</span>.
        Możesz też <strong>wkleić ręcznie</strong> listę obserwujących/obserwowanych dla wybranego konta.</p>
      <form class="g-form" id="g-form">
        <div class="field-input" style="flex:1">
          <span class="at">@</span>
          <input type="text" id="g-input" placeholder="konto do dodania" spellcheck="false" />
        </div>
        <button type="submit" class="btn-ghost">Dodaj</button>
      </form>
      <div class="g-chips">${chips || '<span class="muted">Brak kont w grafie.</span>'}</div>
      ${accList.length ? `
      <details class="b-paste">
        <summary>Wklej listę znajomych (obserwujący / obserwowani) dla konta</summary>
        <div class="b-paste-body">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select id="g-acc">${opts}</select>
            <select id="g-type">
              <option value="following">Obserwowani (to konto obserwuje)</option>
              <option value="follower">Obserwujący (obserwują to konto)</option>
            </select>
          </div>
          <textarea id="g-text" rows="4" placeholder="Wklej nazwy kont — po spacji, przecinku lub w nowych liniach. @ opcjonalne."></textarea>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn-ghost" id="g-apply">Zastosuj do wybranego konta</button>
            <button type="button" class="btn-ghost" id="g-fetch">⤓ Pobierz z sesji IG</button>
          </div>
        </div>
      </details>` : ""}
      ${status ? `<p class="muted" style="margin:8px 2px">${esc(status)}</p>` : ""}
      <div class="g-canvas" id="g-canvas"></div>
      <div class="g-legend">
        <span><span class="g-dot analyzed"></span>analizowane</span>
        <span><span class="g-dot ref"></span>powiązane</span>
        <span><span class="g-dot shared"></span>wspólne (≥2)</span>
        <span><span class="g-dot" style="background:#3897f0"></span>obserwuje →</span>
        <span><span class="g-dot" style="background:#3fb950"></span>obserwujący →</span>
      </div>`;

    // zdarzenia
    host.querySelector("#g-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = host.querySelector("#g-input");
      addAccount(inp.value);
      inp.value = "";
    });
    host.querySelectorAll(".g-x").forEach((b) =>
      b.addEventListener("click", () => removeAccount(b.dataset.u)));
    const apply = host.querySelector("#g-apply");
    if (apply) apply.addEventListener("click", () =>
      setList(host.querySelector("#g-acc").value, host.querySelector("#g-type").value, host.querySelector("#g-text").value));
    const fetchBtn = host.querySelector("#g-fetch");
    if (fetchBtn) fetchBtn.addEventListener("click", async () => {
      if (!window.OsintSession || !window.OsintSession.active()) {
        status = "Najpierw ustaw sesję IG (panel 🔐 poniżej)."; render(); return;
      }
      const uu = host.querySelector("#g-acc").value;
      const tt = host.querySelector("#g-type").value;
      status = `Pobieram listę (${tt === "follower" ? "obserwujący" : "obserwowani"}) dla @${uu}…`; render();
      try {
        const r = await window.OsintSession.fetchList(uu, tt === "follower" ? "followers" : "following");
        setList(uu, tt, r.users.join("\n"));
        if (r.truncated) status += " (ucięto do limitu)";
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

    drawGraph(host.querySelector("#g-canvas"));
  }

  function drawGraph(canvas) {
    const { nodes, links } = buildModel();
    if (!nodes.length) {
      canvas.innerHTML = `<p class="muted" style="text-align:center;padding:40px 0">Dodaj konto, aby zbudować graf.</p>`;
      return;
    }
    layout(nodes, links);

    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "g-svg");
    const refs = new Map();

    const linkColor = { ref: "var(--border)", following: "#3897f0", follower: "#3fb950" };
    for (const l of links) {
      if (!l.s || !l.t) continue;
      const line = document.createElementNS(SVGNS, "line");
      line.setAttribute("stroke", linkColor[l.type] || "var(--border)");
      line.setAttribute("stroke-width", String(Math.min(4, 1 + (l.weight - 1) * 0.6)));
      line.setAttribute("stroke-opacity", l.type === "ref" ? "0.8" : "0.6");
      svg.appendChild(line);
      l.el = line;
    }
    for (const n of nodes) {
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("class", "g-node");
      g.style.cursor = "grab";
      const c = document.createElementNS(SVGNS, "circle");
      c.setAttribute("r", String(radius(n)));
      c.setAttribute("class", n.analyzed ? "n-analyzed" : n.shared ? "n-shared" : "n-ref");
      const title = document.createElementNS(SVGNS, "title");
      title.textContent = `@${n.id}${n.analyzed ? " (analizowane)" : ""}${n.shared ? " — wspólne" : ""}`;
      g.appendChild(c); g.appendChild(title);
      // etykieta tylko dla analizowanych i wspólnych (żeby nie zaśmiecać)
      let label = null;
      if (n.analyzed || n.shared) {
        label = document.createElementNS(SVGNS, "text");
        label.setAttribute("class", "g-label");
        label.setAttribute("text-anchor", "middle");
        label.textContent = "@" + n.id;
        g.appendChild(label);
      }
      svg.appendChild(g);
      refs.set(n, { g, c, label });
      enableDrag(g, n, () => sync(nodes, links, refs));
    }
    canvas.innerHTML = "";
    canvas.appendChild(svg);
    sync(nodes, links, refs);
  }

  function sync(nodes, links, refs) {
    for (const l of links) {
      if (!l.el || !l.s || !l.t) continue;
      l.el.setAttribute("x1", l.s.x); l.el.setAttribute("y1", l.s.y);
      l.el.setAttribute("x2", l.t.x); l.el.setAttribute("y2", l.t.y);
    }
    for (const n of nodes) {
      const r = refs.get(n); if (!r) continue;
      r.c.setAttribute("cx", n.x); r.c.setAttribute("cy", n.y);
      if (r.label) { r.label.setAttribute("x", n.x); r.label.setAttribute("y", n.y - radius(n) - 5); }
    }
  }

  function enableDrag(g, n, onMove) {
    let dragging = false;
    const svg = () => g.ownerSVGElement;
    const toSvg = (ev) => {
      const s = svg(); const pt = s.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      const m = s.getScreenCTM().inverse();
      const p = pt.matrixTransform(m);
      return p;
    };
    g.addEventListener("pointerdown", (ev) => {
      dragging = true; g.setPointerCapture(ev.pointerId); g.style.cursor = "grabbing";
    });
    g.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      const p = toSvg(ev);
      n.x = Math.max(20, Math.min(W - 20, p.x));
      n.y = Math.max(20, Math.min(H - 20, p.y));
      onMove();
    });
    const end = (ev) => { dragging = false; g.style.cursor = "grab"; try { g.releasePointerCapture(ev.pointerId); } catch {} };
    g.addEventListener("pointerup", end);
    g.addEventListener("pointercancel", end);
  }

  return { init, addAccount, removeAccount };
})();
