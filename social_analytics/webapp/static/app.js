"use strict";

/* Dashboard social_analytics — pobiera wynik z /api/analyze i renderuje
 * statystyki, paski tematyczne, ranking wpływu i graf SVG. */

const SVGNS = "http://www.w3.org/2000/svg";
const W = 720, H = 440;

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n === null || n === undefined || Number.isNaN(Number(n)))
  ? "—" : Number(n).toLocaleString("pl-PL");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function setStatus(msg, kind) {
  const el = $("status");
  el.textContent = msg || "";
  el.className = "text-xs mt-3 min-h-[1rem] " +
    (kind === "err" ? "text-amber-400" : kind === "ok" ? "text-good" : "text-dim");
}

async function loadSample() {
  setStatus("Wczytuję przykład…");
  try {
    const r = await fetch("/api/sample");
    const data = await r.json();
    $("input").value = JSON.stringify(data, null, 2);
    setStatus("Przykład wczytany — kliknij „Analizuj”.", "ok");
  } catch (e) { setStatus("Nie udało się wczytać przykładu: " + e.message, "err"); }
}

async function runAnalyze() {
  let payload;
  try {
    payload = JSON.parse($("input").value);
  } catch { setStatus("Niepoprawny JSON w polu wejściowym.", "err"); return; }

  setStatus("Analizuję…");
  $("analyze").disabled = true;
  try {
    const r = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    render(data);
    setStatus("Gotowe ✓", "ok");
  } catch (e) {
    setStatus("Błąd: " + e.message, "err");
  } finally { $("analyze").disabled = false; }
}

function render(data) {
  const primary = data.primary;
  if (!primary) { setStatus("Brak danych konta w wyniku.", "err"); return; }
  $("results").classList.remove("hidden");
  renderAcct(primary.profile);
  renderStats(primary.metrics, primary.profile);
  renderTopics(primary.topics);
  renderInfluence(data.influence || []);
  renderGraph(data.graph || { nodes: [], links: [] }, data.summary);
}

function renderAcct(p) {
  const initial = (p.username || "?").charAt(0).toUpperCase();
  $("acct").innerHTML = `
    <div class="w-16 h-16 rounded-full bg-elev border border-edge grid place-items-center text-2xl font-bold text-dim">${esc(initial)}</div>
    <div>
      <div class="text-lg font-bold flex items-center gap-2">@${esc(p.username)}
        ${p.verified ? '<span class="text-info text-sm">✓</span>' : ""}
        ${p.category ? `<span class="text-[11px] font-semibold text-accent bg-accent/10 border border-accent/30 rounded-full px-2 py-0.5">${esc(p.category)}</span>` : ""}
      </div>
      ${p.full_name ? `<div class="text-dim text-sm">${esc(p.full_name)}</div>` : ""}
    </div>`;
}

function statCard(label, value, sub) {
  return `<div class="bg-panel border border-edge rounded-xl p-4">
    <div class="text-xs text-dim font-semibold">${esc(label)}</div>
    <div class="text-2xl font-extrabold tabular-nums mt-1">${value}</div>
    ${sub ? `<div class="text-[11px] text-dim mt-0.5">${esc(sub)}</div>` : ""}
  </div>`;
}

function renderStats(m, p) {
  const er = m.engagement_rate_pct;
  $("stats").innerHTML = [
    statCard("Obserwujący", fmt(p.followers)),
    statCard("Engagement rate", er === null ? "—" : er.toFixed(2) + "%", "śr. (lajki+kom.) / obserwujący"),
    statCard("Śr. lajki / post", fmt(m.avg_likes)),
    statCard("Posty (próbka)", fmt(m.posts_analyzed), `${fmt(m.total_likes)} lajków łącznie`),
  ].join("");
}

function renderTopics(topics) {
  if (!topics || !topics.length) { $("topics").innerHTML = `<p class="text-dim text-sm">Za mało danych do tematyki.</p>`; return; }
  const max = topics[0].score || 1;
  $("topics").innerHTML = topics.map((t) => {
    const pct = Math.round(t.score * 100);
    const w = Math.max(6, Math.round((t.score / max) * 100));
    return `<div>
      <div class="flex justify-between text-sm mb-1"><span class="font-semibold">${esc(t.category)}</span><span class="text-dim tabular-nums">${pct}%</span></div>
      <div class="bar h-2.5 rounded-full bg-elev overflow-hidden"><span class="block h-full rounded-full bg-gradient-to-r from-accent2 to-accent" style="width:${w}%"></span></div>
    </div>`;
  }).join("");
}

const INFL_COLOR = { hub: "text-accent", bridge: "text-accent2", connector: "text-info", peripheral: "text-dim" };

function renderInfluence(influence) {
  if (!influence.length) { $("influence").innerHTML = `<li class="text-dim">Brak danych grafowych.</li>`; return; }
  $("influence").innerHTML = influence.slice(0, 10).map((n) => {
    const label = n.node.startsWith("#") ? n.node : "@" + n.node;
    return `<li class="flex items-center justify-between gap-2">
      <span class="truncate">${esc(label)}</span>
      <span class="flex items-center gap-2 shrink-0">
        <span class="text-[11px] font-bold uppercase ${INFL_COLOR[n.influence] || "text-dim"}">${esc(n.influence)}</span>
        <span class="text-dim tabular-nums text-xs">${(n.score).toFixed(2)}</span>
      </span></li>`;
  }).join("");
}

/* ------------------------------- Graf ---------------------------------- */
function renderGraph(graph, summary) {
  const host = $("graph");
  const nodes = (graph.nodes || []).map((n) => ({ ...n }));
  const idToNode = new Map(nodes.map((n) => [n.id, n]));
  const links = (graph.links || [])
    .map((l) => ({ ...l, s: idToNode.get(l.source), t: idToNode.get(l.target) }))
    .filter((l) => l.s && l.t);

  $("graph-legend").innerHTML = `
    <span><span class="inline-block w-2.5 h-2.5 rounded-full align-middle" style="background:#e1306c"></span> hub</span>
    <span><span class="inline-block w-2.5 h-2.5 rounded-full align-middle" style="background:#f77737"></span> bridge</span>
    <span><span class="inline-block w-2.5 h-2.5 rounded-full align-middle" style="background:#3897f0"></span> konto</span>
    <span><span class="inline-block w-2.5 h-2.5 rounded-full align-middle" style="background:#4a5768"></span> hashtag</span>`;

  if (!nodes.length) { host.innerHTML = `<p class="text-dim text-sm text-center py-10">Brak grafu (brak powiązań lub networkx niedostępny).</p>`; return; }

  layout(nodes, links);

  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "w-full h-auto select-none");
  svg.style.touchAction = "none";

  for (const l of links) {
    const line = document.createElementNS(SVGNS, "line");
    line.setAttribute("stroke", l.relation === "uses" ? "#2b3a2f" : "#243040");
    line.setAttribute("stroke-width", String(Math.min(4, 1 + ((l.weight || 1) - 1) * 0.6)));
    line.setAttribute("stroke-opacity", "0.75");
    svg.appendChild(line); l.el = line;
  }
  const refs = new Map();
  for (const n of nodes) {
    const g = document.createElementNS(SVGNS, "g"); g.setAttribute("class", "node");
    const c = document.createElementNS(SVGNS, "circle");
    c.setAttribute("r", String(nodeRadius(n)));
    c.setAttribute("fill", nodeColor(n));
    c.setAttribute("stroke", "#0b0f14"); c.setAttribute("stroke-width", "1.5");
    const title = document.createElementNS(SVGNS, "title");
    title.textContent = `${n.kind === "hashtag" ? n.id : "@" + n.id} · ${n.influence || ""}`;
    g.appendChild(c); g.appendChild(title);
    let label = null;
    if (n.kind === "account" || n.influence === "hub" || n.influence === "bridge") {
      label = document.createElementNS(SVGNS, "text");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", "#e6edf3"); label.setAttribute("font-size", "11");
      label.setAttribute("font-weight", "600"); label.setAttribute("paint-order", "stroke");
      label.setAttribute("stroke", "#0b0f14"); label.setAttribute("stroke-width", "3");
      label.textContent = n.kind === "hashtag" ? n.id : "@" + n.id;
      g.appendChild(label);
    }
    svg.appendChild(g); refs.set(n, { c, label });
    enableDrag(g, n, () => sync(nodes, links, refs));
  }
  host.innerHTML = ""; host.appendChild(svg);
  sync(nodes, links, refs);
}

function nodeRadius(n) {
  if (n.kind === "hashtag") return 7;
  return 9 + (n.score || 0) * 10;
}
function nodeColor(n) {
  if (n.kind === "hashtag") return "#4a5768";
  if (n.influence === "hub") return "#e1306c";
  if (n.influence === "bridge") return "#f77737";
  return "#3897f0";
}

function layout(nodes, links) {
  nodes.forEach((n, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, nodes.length);
    n.x = W / 2 + Math.cos(a) * 130 + (Math.random() - 0.5) * 20;
    n.y = H / 2 + Math.sin(a) * 130 + (Math.random() - 0.5) * 20;
  });
  const K = 95, ITER = 280;
  for (let it = 0; it < ITER; it++) {
    const t = 1 - it / ITER;
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d = Math.hypot(dx, dy) || 0.01;
        const rep = 2200 / (d * d), fx = (dx / d) * rep, fy = (dy / d) * rep;
        nodes[i].x += fx * t * 6; nodes[i].y += fy * t * 6; nodes[j].x -= fx * t * 6; nodes[j].y -= fy * t * 6;
      }
    for (const l of links) {
      let dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.hypot(dx, dy) || 0.01;
      const f = ((d - K) / d) * 0.09 * t;
      l.s.x += dx * f; l.s.y += dy * f; l.t.x -= dx * f; l.t.y -= dy * f;
    }
    for (const n of nodes) { n.x += (W / 2 - n.x) * 0.012 * t; n.y += (H / 2 - n.y) * 0.012 * t; }
  }
  for (const n of nodes) { n.x = Math.max(24, Math.min(W - 24, n.x)); n.y = Math.max(22, Math.min(H - 22, n.y)); }
}

function sync(nodes, links, refs) {
  for (const l of links) {
    if (!l.el) continue;
    l.el.setAttribute("x1", l.s.x); l.el.setAttribute("y1", l.s.y);
    l.el.setAttribute("x2", l.t.x); l.el.setAttribute("y2", l.t.y);
  }
  for (const n of nodes) {
    const r = refs.get(n); if (!r) continue;
    r.c.setAttribute("cx", n.x); r.c.setAttribute("cy", n.y);
    if (r.label) { r.label.setAttribute("x", n.x); r.label.setAttribute("y", n.y - nodeRadius(n) - 4); }
  }
}

function enableDrag(g, n, onMove) {
  let dragging = false;
  const toSvg = (ev) => { const s = g.ownerSVGElement, pt = s.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; return pt.matrixTransform(s.getScreenCTM().inverse()); };
  g.addEventListener("pointerdown", (ev) => { dragging = true; g.setPointerCapture(ev.pointerId); });
  g.addEventListener("pointermove", (ev) => { if (!dragging) return; const p = toSvg(ev); n.x = Math.max(16, Math.min(W - 16, p.x)); n.y = Math.max(16, Math.min(H - 16, p.y)); onMove(); });
  const end = (ev) => { dragging = false; try { g.releasePointerCapture(ev.pointerId); } catch {} };
  g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
}

$("analyze").addEventListener("click", runAnalyze);
$("load-sample").addEventListener("click", loadSample);
loadSample();
