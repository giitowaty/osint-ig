"use strict";

/* ----------------------------------------------------------------------------
 * OSINT-IG — analiza pojedynczego profilu Instagram (front).
 *
 * Dane pobiera z własnego backendu (/api/profile), który obchodzi CORS. Gdy
 * backend lub Instagram zawiedzie, karta przechodzi w tryb ręczny z edytowalnymi
 * kafelkami, a analiza przelicza się na żywo.
 * -------------------------------------------------------------------------- */

const form = document.getElementById("analyze-form");
const input = document.getElementById("username");
const btn = document.getElementById("analyze-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const historyEl = document.getElementById("history");

const HISTORY_KEY = "osint-ig-history";

/* ---------------------------- Pomocnicze --------------------------------- */

function normalizeUsername(raw) {
  let v = (raw || "").trim();
  if (!v) return "";
  const m = v.match(/instagram\.com\/([^/?#]+)/i);
  if (m) v = m[1];
  return v.replace(/^@+/, "").trim();
}

function formatNumber(n) {
  if (n === null || n === undefined || n === "" || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("pl-PL");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function emptyProfile(username) {
  return {
    username, fullName: "", bio: "", externalUrl: "", avatar: "",
    verified: false, private: false,
    followers: null, following: null, posts: null, manual: true,
  };
}

/* ------------------------------ Pobieranie ------------------------------- */

async function loadProfile(username) {
  const res = await fetch(`/api/profile?username=${encodeURIComponent(username)}`);
  const data = await res.json().catch(() => ({ ok: false, error: "Zła odpowiedź serwera." }));
  if (!res.ok || !data.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.handled = true;
    throw err;
  }
  return data; // { profile, posts, audience }
}

/* -------------------------------- Analiza -------------------------------- */

function ratio(p) {
  if (!p.following || Number(p.following) === 0) return null;
  if (p.followers === null || p.followers === "") return null;
  return Number(p.followers) / Number(p.following);
}

function followersPerPost(p) {
  if (!p.posts || Number(p.posts) === 0) return null;
  if (p.followers === null || p.followers === "") return null;
  return Number(p.followers) / Number(p.posts);
}

function insights(p) {
  const out = [];
  const f = p.followers === null || p.followers === "" ? null : Number(p.followers);
  const posts = p.posts === null || p.posts === "" ? null : Number(p.posts);
  const r = ratio(p);
  const fpp = followersPerPost(p);

  out.push({ icon: p.verified ? "✓" : "○",
    text: p.verified ? "Konto zweryfikowane (niebieski znaczek)." : "Konto niezweryfikowane." });
  out.push({ icon: p.private ? "🔒" : "🌐",
    text: p.private ? "Profil prywatny — pełne statystyki i treści są ukryte." : "Profil publiczny." });

  if (f !== null) {
    let tier;
    if (f >= 1_000_000) tier = "mega-konto (1 mln+ obserwujących)";
    else if (f >= 100_000) tier = "duży zasięg (macro-influencer)";
    else if (f >= 10_000) tier = "średni zasięg (micro-influencer)";
    else if (f >= 1_000) tier = "mały zasięg (nano-influencer)";
    else tier = "konto niszowe / prywatne grono";
    out.push({ icon: "📈", text: `Skala konta: ${tier}.` });
  }
  if (r !== null) {
    let desc;
    if (r >= 10) desc = "silnie „influencerski” — obserwujących znacznie więcej niż obserwowanych";
    else if (r >= 2) desc = "nadwyżka obserwujących nad obserwowanymi";
    else if (r >= 0.5) desc = "zbalansowany stosunek obserwujących do obserwowanych";
    else desc = "obserwuje więcej kont, niż samo ma obserwujących (typowe dla kont prywatnych / nowych / botów)";
    out.push({ icon: "⚖️", text: `Ratio ${r.toFixed(2)} — ${desc}.` });
  }
  if (posts !== null) {
    let act;
    if (posts === 0) act = "brak opublikowanych postów";
    else if (posts < 10) act = "bardzo mało postów — konto świeże lub mało aktywne";
    else if (posts < 100) act = "umiarkowana liczba postów";
    else act = "bogate archiwum postów — konto aktywne od dłuższego czasu";
    out.push({ icon: "🗂️", text: `Posty: ${formatNumber(posts)} — ${act}.` });
  }
  if (fpp !== null) {
    out.push({ icon: "👁️",
      text: `~${formatNumber(Math.round(fpp))} obserwujących na post (orientacyjny potencjalny zasięg).` });
  }
  out.push({ icon: p.bio ? "📝" : "📄", text: p.bio ? "Bio wypełnione." : "Puste bio." });
  if (p.externalUrl) out.push({ icon: "🔗", text: "W bio podany link zewnętrzny." });
  return out;
}

// Podsumowanie treści z ostatnich postów.
function contentSummary(posts, profile) {
  if (!posts || !posts.length) return null;
  const typeCounts = { image: 0, video: 0, carousel: 0 };
  let likeSum = 0, likeN = 0, commentSum = 0, commentN = 0;
  const tags = new Map();
  let topPost = null;

  for (const p of posts) {
    typeCounts[p.type] = (typeCounts[p.type] || 0) + 1;
    if (p.likes != null) { likeSum += p.likes; likeN++; }
    if (p.comments != null) { commentSum += p.comments; commentN++; }
    const text = `${p.caption} ${p.alt}`;
    for (const m of text.matchAll(/#([\p{L}\p{N}_]{2,30})/gu)) {
      const t = m[1].toLowerCase();
      tags.set(t, (tags.get(t) || 0) + 1);
    }
    if (p.likes != null && (!topPost || p.likes > topPost.likes)) topPost = p;
  }

  const avgLikes = likeN ? Math.round(likeSum / likeN) : null;
  const avgComments = commentN ? Math.round(commentSum / commentN) : null;
  const f = profile.followers;
  const engagement =
    avgLikes != null && avgComments != null && f
      ? ((avgLikes + avgComments) / f) * 100
      : null;

  const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]);

  return { count: posts.length, typeCounts, avgLikes, avgComments, engagement, topTags, topPost };
}

/* ------------------------------ Renderowanie ----------------------------- */

const STATS = [
  { key: "followers", label: "Obserwujący" },
  { key: "following", label: "Obserwuje" },
  { key: "posts", label: "Posty" },
];

let current = null; // { profile, posts, audience, summary }

function statValue(p, key) {
  const v = p[key];
  return v === null || v === "" ? null : Number(v);
}

function tilesHtml(p) {
  const tiles = STATS.map((s) => {
    const val = statValue(p, s.key);
    if (p.manual) {
      return `<div class="tile"><span class="tile-label">${s.label}</span>
        <input class="tile-input" type="number" min="0" inputmode="numeric"
               data-key="${s.key}" value="${val === null ? "" : val}" placeholder="—" /></div>`;
    }
    return `<div class="tile"><span class="tile-label">${s.label}</span>
      <span class="tile-value">${formatNumber(val)}</span></div>`;
  }).join("");
  const r = ratio(p);
  return tiles + `<div class="tile"><span class="tile-label">Ratio (obs./obserwuje)</span>
      <span class="tile-value" id="ratio-tile">${r === null ? "—" : r.toFixed(2)}</span></div>`;
}

function insightsHtml(p) {
  return `<ul class="insights">${
    insights(p).map((i) =>
      `<li><span class="ins-icon">${i.icon}</span><span>${escapeHtml(i.text)}</span></li>`).join("")
  }</ul>`;
}

function postsHtml(posts) {
  if (!posts || !posts.length) return "";
  const icon = { image: "🖼️", video: "▶", carousel: "▦" };
  const cells = posts.slice(0, 12).map((p) => {
    const href = p.shortcode ? `https://www.instagram.com/p/${encodeURIComponent(p.shortcode)}/` : "#";
    const thumb = p.thumbnail
      ? `<img loading="lazy" src="${escapeHtml(p.thumbnail)}" alt="" referrerpolicy="no-referrer"
           onerror="this.style.display='none'" />`
      : "";
    return `<a class="post" href="${href}" target="_blank" rel="noopener" title="${escapeHtml(p.alt || p.caption || "")}">
        ${thumb}
        <span class="post-type">${icon[p.type] || ""}</span>
        <span class="post-meta">♥ ${formatNumber(p.likes)} · 💬 ${formatNumber(p.comments)}</span>
      </a>`;
  }).join("");
  return `<h2 class="section-title">Ostatnie posty</h2><div class="posts">${cells}</div>`;
}

function summaryHtml(s) {
  if (!s) return "";
  const tc = s.typeCounts;
  const typeLine = `🖼️ ${tc.image} zdjęć · ▶ ${tc.video} wideo · ▦ ${tc.carousel} karuzel`;
  const tags = s.topTags.length
    ? `<div class="tags">${s.topTags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join("")}</div>`
    : `<p class="muted">Brak hashtagów w ostatnich postach.</p>`;
  const eng = s.engagement != null
    ? `<li><span class="ins-icon">🔥</span><span>Zaangażowanie: <strong>${s.engagement.toFixed(2)}%</strong>
         (śr. ${formatNumber(s.avgLikes)} lajków i ${formatNumber(s.avgComments)} komentarzy / obserwujący).</span></li>`
    : "";
  return `
    <h2 class="section-title">Podsumowanie treści</h2>
    <ul class="insights">
      <li><span class="ins-icon">🎬</span><span>Formaty (${s.count} ost. postów): ${typeLine}.</span></li>
      ${eng}
      ${s.avgLikes != null ? `<li><span class="ins-icon">♥</span><span>Średnio ${formatNumber(s.avgLikes)} lajków na post.</span></li>` : ""}
    </ul>
    <p class="muted" style="margin:10px 2px 6px">Najczęstsze hashtagi:</p>
    ${tags}`;
}

function classificationHtml(c) {
  if (!c) return "";
  const conf = Math.round((c.confidence || 0) * 100);
  const chips = c.labels
    .map((l) => `<span class="class-chip" title="${escapeHtml(l.reason)}">${escapeHtml(l.label)}</span>`)
    .join("");
  const reasons = c.labels
    .map((l) => `<li><span class="ins-icon">•</span><span><strong>${escapeHtml(l.label)}</strong> — ${escapeHtml(l.reason)}</span></li>`)
    .join("");
  return `
    <h2 class="section-title">Klasyfikacja konta</h2>
    <div class="class-primary">
      <span class="class-badge">${escapeHtml(c.primary)}</span>
      <span class="muted">pewność ~${conf}%</span>
    </div>
    <div class="class-chips">${chips}</div>
    <ul class="insights" style="margin-top:12px">${reasons}</ul>`;
}

const KIND_LABEL = { kategoria: "temat", konto: "konto", hashtag: "hashtag" };

function interestsHtml(list) {
  if (!list || !list.length) {
    return `<h2 class="section-title">Zainteresowania</h2>
      <p class="muted">Za mało opisów/hashtagów, by wyznaczyć zainteresowania.</p>`;
  }
  const max = list[0].weight || 1;
  const sum = list.reduce((a, i) => a + i.weight, 0) || 1;
  const rows = list.map((i) => {
    const pct = Math.round((i.weight / sum) * 100);
    return `<div class="rank-row">
        <span class="rank-name"><span class="kind-dot ${i.kind}" title="${KIND_LABEL[i.kind] || ""}"></span>${escapeHtml(i.label)}</span>
        <span class="rank-bar ${i.kind}"><span style="width:${Math.max(8, Math.round((i.weight / max) * 100))}%"></span></span>
        <span class="rank-pct">${pct}%</span>
      </div>`;
  }).join("");
  return `<h2 class="section-title">Zainteresowania</h2>
    <p class="muted" style="margin:0 2px 10px">Z tego, co konto publikuje i udostępnia —
      <span class="kind-dot kategoria"></span> temat,
      <span class="kind-dot konto"></span> konto (oznaczenia/collab/@wzmianki),
      <span class="kind-dot hashtag"></span> hashtag. Stories nie są dostępne publicznie.</p>
    <div class="ranklist">${rows}</div>`;
}

function topicsHtml(t) {
  if (!t || !t.topics || !t.topics.length) {
    return `<h2 class="section-title">Tematyka treści</h2>
      <p class="muted">Za mało opisów/hashtagów, by określić tematykę.</p>`;
  }
  const max = t.topics[0].hits || 1;
  const rows = t.topics.map((x) => {
    const pct = Math.round(x.share * 100);
    return `<div class="topic-row">
        <span class="topic-name">${escapeHtml(x.category)}</span>
        <span class="topic-bar"><span style="width:${Math.max(8, Math.round((x.hits / max) * 100))}%"></span></span>
        <span class="topic-pct">${pct}%</span>
      </div>`;
  }).join("");
  return `<h2 class="section-title">Tematyka treści</h2>
    <p class="muted" style="margin:0 2px 10px">Dominujące tematy wg opisów, hashtagów i opisów zdjęć:</p>
    <div class="topics">${rows}</div>`;
}

function sentimentHtml(s) {
  if (!s || !s.available) {
    return `<h2 class="section-title">Wydźwięk komentarzy</h2>
      <p class="manual-note">${escapeHtml((s && s.reason) || "Brak komentarzy do analizy.")}</p>`;
  }
  const total = s.positive + s.neutral + s.negative || 1;
  const bar = (cls, n) => `<div class="seg ${cls}" style="width:${(n / total) * 100}%" title="${n}"></div>`;
  const ex = (label, cls, txt) => txt
    ? `<li><span class="dot ${cls}"></span><span class="muted">${label}:</span> „${escapeHtml(txt)}”</li>`
    : "";
  return `
    <h2 class="section-title">Wydźwięk komentarzy</h2>
    <p class="disclaimer">⚠ Szacunek wydźwięku z próbki ${s.sampleSize} podglądowych komentarzy
      (leksykon słów + emoji). Ogólny ton: <strong>${escapeHtml(s.tone)}</strong>.</p>
    <div class="genderbar">${bar("pos", s.positive)}${bar("neu", s.neutral)}${bar("neg", s.negative)}</div>
    <ul class="gender-legend">
      <li><span class="dot pos"></span>Pozytywne: ${s.positive} (${s.positivePct}%)</li>
      <li><span class="dot neu"></span>Neutralne: ${s.neutral} (${s.neutralPct}%)</li>
      <li><span class="dot neg"></span>Negatywne: ${s.negative} (${s.negativePct}%)</li>
    </ul>
    <ul class="examples">
      ${ex("przykład +", "pos", s.examples && s.examples.positive)}
      ${ex("przykład −", "neg", s.examples && s.examples.negative)}
    </ul>`;
}

function audienceHtml(a) {
  if (!a) return "";
  if (!a.available) {
    return `<h2 class="section-title">Płeć odbiorców (szacunek)</h2>
      <p class="manual-note">Brak próbki komentujących/lajkujących do oszacowania (IG nie udostępnił podglądu).</p>`;
  }
  const total = a.female + a.male + a.unknown || 1;
  const pct = (n) => Math.round((n / total) * 100);
  const bar = (cls, n) => `<div class="seg ${cls}" style="width:${(n / total) * 100}%" title="${n}"></div>`;
  return `
    <h2 class="section-title">Płeć odbiorców (szacunek)</h2>
    <p class="disclaimer">⚠ To <strong>nie</strong> jest demografia obserwujących. To zgadywanie płci z imion w
      próbce ${a.sampleSize} osób ${escapeHtml(a.source)}. Obarczone dużym błędem.</p>
    <div class="genderbar">${bar("f", a.female)}${bar("m", a.male)}${bar("u", a.unknown)}</div>
    <ul class="gender-legend">
      <li><span class="dot f"></span>Kobiety: ${a.female} (${pct(a.female)}%)</li>
      <li><span class="dot m"></span>Mężczyźni: ${a.male} (${pct(a.male)}%)</li>
      <li><span class="dot u"></span>Nieokreślona: ${a.unknown} (${pct(a.unknown)}%)</li>
    </ul>`;
}

function exportText(c) {
  const p = c.profile, s = c.summary, a = c.audience;
  const L = [];
  L.push(`OSINT-IG — analiza @${p.username}`);
  if (p.fullName) L.push(`Nazwa: ${p.fullName}`);
  L.push(`Status: ${p.verified ? "zweryfikowany" : "niezweryfikowany"}, ${p.private ? "prywatny" : "publiczny"}`);
  if (p.category) L.push(`Kategoria IG: ${p.category}`);
  L.push(`Obserwujący: ${formatNumber(p.followers)} | Obserwuje: ${formatNumber(p.following)} | Posty: ${formatNumber(p.posts)}`);
  const r = ratio(p);
  if (r !== null) L.push(`Ratio: ${r.toFixed(2)}`);
  const cls = c.content && c.content.classification;
  if (cls) L.push(`Klasyfikacja: ${cls.primary} [${cls.labels.map((l) => l.label).join(", ")}]`);
  if (s) {
    L.push("");
    L.push(`Treści (${s.count} ost. postów): ${s.typeCounts.image} zdjęć, ${s.typeCounts.video} wideo, ${s.typeCounts.carousel} karuzel`);
    if (s.engagement != null) L.push(`Zaangażowanie: ${s.engagement.toFixed(2)}%`);
    if (s.topTags.length) L.push(`Hashtagi: ${s.topTags.map((t) => "#" + t).join(" ")}`);
  }
  const content = c.content;
  if (content && content.topics && content.topics.topics && content.topics.topics.length) {
    L.push("");
    L.push("Tematyka: " + content.topics.topics.map((t) => `${t.category} ${Math.round(t.share * 100)}%`).join(", "));
  }
  if (content && content.interests && content.interests.length) {
    L.push("Zainteresowania: " + content.interests.map((i) => i.label).join(", "));
  }
  if (content && content.sentiment && content.sentiment.available) {
    const s = content.sentiment;
    L.push(`Wydźwięk komentarzy (${s.sampleSize}): ${s.tone} — poz ${s.positivePct}% / neu ${s.neutralPct}% / neg ${s.negativePct}%`);
  }
  if (a && a.available) {
    L.push("");
    L.push(`Płeć odbiorców (szacunek, próbka ${a.sampleSize}): K ${a.female} / M ${a.male} / ? ${a.unknown}`);
  }
  return L.join("\n");
}

function render(data) {
  const p = data.profile;
  current = {
    profile: p,
    posts: data.posts || [],
    audience: data.audience || null,
    content: data.content || null,
    connections: data.connections || [],
    summary: p.manual ? null : contentSummary(data.posts, p),
  };

  const initial = (p.username || "?").charAt(0).toUpperCase();
  const avatar = p.avatar
    ? `<img class="avatar" src="${escapeHtml(p.avatar)}" alt="" referrerpolicy="no-referrer"
         onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar avatar-fallback',textContent:'${escapeHtml(initial)}'}))" />`
    : `<div class="avatar avatar-fallback">${escapeHtml(initial)}</div>`;
  const badges =
    (p.verified ? `<span class="badge verified">✓</span>` : "") +
    (p.private ? `<span class="badge private">prywatny</span>` : "");
  const manualNote = p.manual
    ? `<p class="manual-note">Nie udało się pobrać danych automatycznie. Uzupełnij je ręcznie lub
         <a href="https://www.instagram.com/${escapeHtml(p.username)}/" target="_blank" rel="noopener" class="relink">otwórz profil na IG</a>.</p>`
    : "";
  const link = p.externalUrl
    ? `<a class="ext-link" href="${escapeHtml(p.externalUrl)}" target="_blank" rel="noopener">${escapeHtml(p.externalUrl)}</a>`
    : "";
  const catChip = p.category ? `<span class="cat-chip">${escapeHtml(p.category)}</span>` : "";
  const ct = current.content;

  const head = `
    ${manualNote}
    <div class="card-head">
      ${avatar}
      <div class="names">
        <div class="handle">@${escapeHtml(p.username)} ${badges}</div>
        ${p.fullName ? `<div class="fullname">${escapeHtml(p.fullName)} ${catChip}</div>` : (catChip ? `<div class="fullname">${catChip}</div>` : "")}
      </div>
      ${!p.manual ? `<div class="export">
        <button type="button" class="btn-ghost" id="copy-btn">Kopiuj</button>
        <button type="button" class="btn-ghost" id="json-btn">JSON</button>
        <button type="button" class="btn-ghost" id="print-btn">Drukuj / PDF</button>
      </div>` : ""}
    </div>
    ${p.bio ? `<p class="bio">${escapeHtml(p.bio)}</p>` : ""}
    ${link}`;

  let body;
  if (p.manual) {
    // Tryb ręczny: bez zakładek, tylko edytowalne kafelki + analiza.
    body = `
      <div class="tiles">${tilesHtml(p)}</div>
      <h2 class="section-title">Analiza</h2>
      <div id="insights-wrap">${insightsHtml(p)}</div>`;
  } else {
    body = `
      <div class="layout">
        <nav class="sidenav" role="tablist">
          <button class="navitem active" data-tab="przeglad" role="tab"><span class="ni">📊</span> Przegląd</button>
          <button class="navitem" data-tab="tresci" role="tab"><span class="ni">🖼️</span> Treści</button>
          <button class="navitem" data-tab="odbiorcy" role="tab"><span class="ni">👥</span> Odbiorcy</button>
          <button class="navitem" data-tab="graf" role="tab"><span class="ni">🕸️</span> Graf</button>
        </nav>
        <div class="panels">
          <section class="tab-panel active" data-panel="przeglad">
            <div class="tiles">${tilesHtml(p)}</div>
            <div class="grid-2">
              <div><h2 class="section-title">Analiza</h2><div id="insights-wrap">${insightsHtml(p)}</div></div>
              <div>${ct ? classificationHtml(ct.classification) : ""}</div>
            </div>
          </section>
          <section class="tab-panel" data-panel="tresci">
            ${postsHtml(current.posts)}
            ${summaryHtml(current.summary)}
            <div class="grid-2">
              <div>${ct ? topicsHtml(ct.topics) : ""}</div>
              <div>${ct ? interestsHtml(ct.interests) : ""}</div>
            </div>
          </section>
          <section class="tab-panel" data-panel="odbiorcy">
            <div class="grid-2">
              <div>${ct ? sentimentHtml(ct.sentiment) : ""}</div>
              <div>${audienceHtml(current.audience)}</div>
            </div>
          </section>
          <section class="tab-panel" data-panel="graf">
            <div id="graph-host"></div>
          </section>
        </div>
      </div>`;
  }

  resultEl.innerHTML = `<article class="card">${head}${body}</article>`;
  resultEl.hidden = false;

  // Graf powiązań (seed = bieżący profil i jego powiązania).
  if (!p.manual && window.OsintGraph) {
    const gh = document.getElementById("graph-host");
    if (gh) window.OsintGraph.init(gh, loadProfile, p.username, current.connections);
  }

  // Przełączanie zakładek (boczna nawigacja).
  const tabs = resultEl.querySelectorAll(".navitem");
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    resultEl.querySelectorAll(".tab-panel").forEach((pan) =>
      pan.classList.toggle("active", pan.dataset.panel === tab.dataset.tab));
  }));

  // Tryb ręczny: edycja kafelków → przelicz ratio i analizę.
  resultEl.querySelectorAll("input.tile-input").forEach((inp) => {
    inp.addEventListener("input", () => {
      const raw = inp.value.trim();
      current.profile[inp.dataset.key] = raw === "" ? null : Number(raw);
      const r = ratio(current.profile);
      const rt = document.getElementById("ratio-tile");
      if (rt) rt.textContent = r === null ? "—" : r.toFixed(2);
      const wrap = document.getElementById("insights-wrap");
      if (wrap) wrap.innerHTML = insightsHtml(current.profile);
    });
  });

  // Eksport.
  const copyBtn = document.getElementById("copy-btn");
  if (copyBtn) copyBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(exportText(current)); copyBtn.textContent = "Skopiowano ✓"; }
    catch { copyBtn.textContent = "Błąd"; }
    setTimeout(() => (copyBtn.textContent = "Kopiuj"), 1500);
  });
  const jsonBtn = document.getElementById("json-btn");
  if (jsonBtn) jsonBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `osint-ig-${current.profile.username}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const printBtn = document.getElementById("print-btn");
  if (printBtn) printBtn.addEventListener("click", () => window.print());
}

/* ------------------------------- Historia -------------------------------- */

function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}
function pushHistory(username) {
  try {
    const list = readHistory().filter((u) => u !== username);
    list.unshift(username);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 8)));
  } catch { /* localStorage niedostępny */ }
  renderHistory();
}
function renderHistory() {
  const list = readHistory();
  if (!historyEl) return;
  if (!list.length) { historyEl.hidden = true; historyEl.innerHTML = ""; return; }
  historyEl.hidden = false;
  historyEl.innerHTML =
    `<span class="hist-label">Ostatnie:</span>` +
    list.map((u) => `<button type="button" class="chip" data-u="${escapeHtml(u)}">@${escapeHtml(u)}</button>`).join("");
  historyEl.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => { input.value = c.dataset.u; form.requestSubmit(); }));
}

/* ------------------------------- Zdarzenia ------------------------------- */

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = normalizeUsername(input.value);
  if (!username) {
    statusEl.textContent = "Podaj nazwę użytkownika.";
    statusEl.classList.add("error");
    return;
  }
  statusEl.classList.remove("error");
  btn.disabled = true;
  statusEl.innerHTML = `<span class="spinner"></span> Pobieram dane profilu @${escapeHtml(username)}…`;
  resultEl.hidden = true;

  try {
    const data = await loadProfile(username);
    statusEl.textContent = "Gotowe ✓";
    statusEl.classList.remove("error");
    render(data);
    pushHistory(data.profile.username || username);
  } catch (err) {
    statusEl.textContent = `Nie udało się pobrać @${username}: ${err.message} — uzupełnij dane ręcznie.`;
    statusEl.classList.add("error");
    render({ profile: emptyProfile(username), posts: [], audience: null });
  } finally {
    btn.disabled = false;
  }
});

renderHistory();
