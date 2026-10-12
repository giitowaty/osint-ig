"use strict";

/* ----------------------------------------------------------------------------
 * OSINT-IG — analiza pojedynczego profilu Instagram (czysty front, bez backendu)
 *
 * Instagram blokuje zapytania cross-origin (CORS), więc publiczne dane profilu
 * próbujemy pobrać przez kilka CORS-proxy po kolei. Gdy wszystkie zawiodą,
 * profil wchodzi w tryb ręczny — pola statystyk stają się edytowalne, a analiza
 * przelicza się na żywo.
 * -------------------------------------------------------------------------- */

const IG_ENDPOINT =
  "https://www.instagram.com/api/v1/users/web_profile_info/?username=";

// Publiczne CORS-proxy próbowane po kolei. Pierwszy, który zwróci poprawny
// JSON z danymi profilu, wygrywa.
const PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

const form = document.getElementById("analyze-form");
const input = document.getElementById("username");
const btn = document.getElementById("analyze-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");

/* ---------------------------- Pomocnicze --------------------------------- */

function normalizeUsername(raw) {
  let v = (raw || "").trim();
  if (!v) return "";
  const m = v.match(/instagram\.com\/([^/?#]+)/i);
  if (m) v = m[1];
  return v.replace(/^@+/, "").trim();
}

function formatNumber(n) {
  if (n === null || n === undefined || n === "" || Number.isNaN(Number(n))) {
    return "—";
  }
  return Number(n).toLocaleString("pl-PL");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function emptyProfile(username) {
  return {
    username,
    fullName: "",
    bio: "",
    externalUrl: "",
    avatar: "",
    verified: false,
    private: false,
    followers: null,
    following: null,
    posts: null,
    manual: true,
  };
}

/* ------------------------------ Pobieranie ------------------------------- */

function parseProfile(json, username) {
  const user = json && json.data && json.data.user;
  if (!user) return null;
  return {
    username: user.username || username,
    fullName: user.full_name || "",
    bio: user.biography || "",
    externalUrl: user.external_url || "",
    avatar: user.profile_pic_url_hd || user.profile_pic_url || "",
    verified: !!user.is_verified,
    private: !!user.is_private,
    followers: user.edge_followed_by ? user.edge_followed_by.count : null,
    following: user.edge_follow ? user.edge_follow.count : null,
    posts: user.edge_owner_to_timeline_media
      ? user.edge_owner_to_timeline_media.count
      : null,
    manual: false,
  };
}

async function fetchProfile(username) {
  const target = IG_ENDPOINT + encodeURIComponent(username);

  for (const build of PROXIES) {
    try {
      const res = await fetch(build(target), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;

      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        continue; // najczęściej IG oddał stronę logowania zamiast JSON-a
      }
      const profile = parseProfile(json, username);
      if (profile) return profile;
    } catch {
      // Sieć/CORS/proxy padło — próbujemy następnego.
    }
  }
  return null;
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

// Zwraca listę wniosków: { icon, text }.
function insights(p) {
  const out = [];
  const f = p.followers === null || p.followers === "" ? null : Number(p.followers);
  const fw = p.following === null || p.following === "" ? null : Number(p.following);
  const posts = p.posts === null || p.posts === "" ? null : Number(p.posts);
  const r = ratio(p);
  const fpp = followersPerPost(p);

  // Status konta
  out.push({
    icon: p.verified ? "✓" : "○",
    text: p.verified
      ? "Konto zweryfikowane (niebieski znaczek)."
      : "Konto niezweryfikowane.",
  });
  out.push({
    icon: p.private ? "🔒" : "🌐",
    text: p.private
      ? "Profil prywatny — pełne statystyki i treści są ukryte."
      : "Profil publiczny.",
  });

  // Zasięg wg liczby obserwujących
  if (f !== null) {
    let tier;
    if (f >= 1_000_000) tier = "mega-konto (1 mln+ obserwujących)";
    else if (f >= 100_000) tier = "duży zasięg (macro-influencer)";
    else if (f >= 10_000) tier = "średni zasięg (micro-influencer)";
    else if (f >= 1_000) tier = "mały zasięg (nano-influencer)";
    else tier = "konto niszowe / prywatne grono";
    out.push({ icon: "📈", text: `Skala konta: ${tier}.` });
  }

  // Ratio obserwujący/obserwuje
  if (r !== null) {
    let desc;
    if (r >= 10) desc = "silnie „influencerski” — obserwujących znacznie więcej niż obserwowanych";
    else if (r >= 2) desc = "nadwyżka obserwujących nad obserwowanymi";
    else if (r >= 0.5) desc = "zbalansowany stosunek obserwujących do obserwowanych";
    else desc = "obserwuje więcej kont, niż samo ma obserwujących (typowe dla kont prywatnych / nowych / botów)";
    out.push({ icon: "⚖️", text: `Ratio ${r.toFixed(2)} — ${desc}.` });
  }

  // Aktywność / publikacje
  if (posts !== null) {
    let act;
    if (posts === 0) act = "brak opublikowanych postów";
    else if (posts < 10) act = "bardzo mało postów — konto świeże lub mało aktywne";
    else if (posts < 100) act = "umiarkowana liczba postów";
    else act = "bogate archiwum postów — konto aktywne od dłuższego czasu";
    out.push({ icon: "🗂️", text: `Posty: ${formatNumber(posts)} — ${act}.` });
  }

  // Obserwujący na post (proxy potencjalnego zasięgu)
  if (fpp !== null) {
    out.push({
      icon: "👁️",
      text: `~${formatNumber(Math.round(fpp))} obserwujących na post (orientacyjny potencjalny zasięg).`,
    });
  }

  // Bio / link
  out.push({
    icon: p.bio ? "📝" : "📄",
    text: p.bio ? "Bio wypełnione." : "Puste bio.",
  });
  if (p.externalUrl) {
    out.push({ icon: "🔗", text: "W bio podany link zewnętrzny." });
  }

  return out;
}

/* ------------------------------ Renderowanie ----------------------------- */

const STATS = [
  { key: "followers", label: "Obserwujący" },
  { key: "following", label: "Obserwuje" },
  { key: "posts", label: "Posty" },
];

let currentProfile = null;

function statValue(p, key) {
  const v = p[key];
  return v === null || v === "" ? null : Number(v);
}

function tilesHtml(p) {
  const tiles = STATS.map((s) => {
    const val = statValue(p, s.key);
    if (p.manual) {
      return `<div class="tile">
          <span class="tile-label">${s.label}</span>
          <input class="tile-input" type="number" min="0" inputmode="numeric"
                 data-key="${s.key}" value="${val === null ? "" : val}" placeholder="—" />
        </div>`;
    }
    return `<div class="tile">
        <span class="tile-label">${s.label}</span>
        <span class="tile-value">${formatNumber(val)}</span>
      </div>`;
  }).join("");

  const r = ratio(p);
  const ratioTile = `<div class="tile">
      <span class="tile-label">Ratio (obs./obserwuje)</span>
      <span class="tile-value" id="ratio-tile">${r === null ? "—" : r.toFixed(2)}</span>
    </div>`;

  return tiles + ratioTile;
}

function insightsHtml(p) {
  const items = insights(p)
    .map((i) => `<li><span class="ins-icon">${i.icon}</span><span>${escapeHtml(i.text)}</span></li>`)
    .join("");
  return `<ul class="insights">${items}</ul>`;
}

function render(p) {
  currentProfile = p;

  const initial = (p.username || "?").charAt(0).toUpperCase();
  const avatar = p.avatar
    ? `<img class="avatar" src="${escapeHtml(p.avatar)}" alt="" referrerpolicy="no-referrer"
         onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar avatar-fallback',textContent:'${escapeHtml(initial)}'}))" />`
    : `<div class="avatar avatar-fallback">${escapeHtml(initial)}</div>`;

  const badges =
    (p.verified ? `<span class="badge verified">✓</span>` : "") +
    (p.private ? `<span class="badge private">prywatny</span>` : "");

  const manualNote = p.manual
    ? `<p class="manual-note">
         Nie udało się pobrać danych automatycznie. Uzupełnij je ręcznie lub
         <a href="https://www.instagram.com/${escapeHtml(p.username)}/" target="_blank" rel="noopener" class="relink">otwórz profil na IG</a>.
       </p>`
    : "";

  const link = p.externalUrl
    ? `<a class="ext-link" href="${escapeHtml(p.externalUrl)}" target="_blank" rel="noopener">${escapeHtml(p.externalUrl)}</a>`
    : "";

  resultEl.innerHTML = `
    <article class="card">
      ${manualNote}
      <div class="card-head">
        ${avatar}
        <div class="names">
          <div class="handle">@${escapeHtml(p.username)} ${badges}</div>
          ${p.fullName ? `<div class="fullname">${escapeHtml(p.fullName)}</div>` : ""}
        </div>
      </div>
      ${p.bio ? `<p class="bio">${escapeHtml(p.bio)}</p>` : ""}
      ${link}
      <div class="tiles">${tilesHtml(p)}</div>
      <h2 class="section-title">Analiza</h2>
      <div id="insights-wrap">${insightsHtml(p)}</div>
    </article>`;
  resultEl.hidden = false;

  // Edycja ręcznych pól → aktualizuj model, ratio i analizę na żywo.
  resultEl.querySelectorAll("input.tile-input").forEach((inp) => {
    inp.addEventListener("input", () => {
      const raw = inp.value.trim();
      currentProfile[inp.dataset.key] = raw === "" ? null : Number(raw);

      const r = ratio(currentProfile);
      const ratioTile = document.getElementById("ratio-tile");
      if (ratioTile) ratioTile.textContent = r === null ? "—" : r.toFixed(2);

      const wrap = document.getElementById("insights-wrap");
      if (wrap) wrap.innerHTML = insightsHtml(currentProfile);
    });
  });
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
  statusEl.textContent = `Pobieram dane profilu @${username}…`;
  resultEl.hidden = true;

  const fetched = await fetchProfile(username);
  const profile = fetched || emptyProfile(username);

  if (fetched) {
    statusEl.textContent = "Gotowe ✓";
    statusEl.classList.remove("error");
  } else {
    statusEl.textContent =
      `Nie udało się pobrać @${username}. Uzupełnij dane ręcznie w karcie poniżej.`;
    statusEl.classList.add("error");
  }

  render(profile);
  btn.disabled = false;
});
