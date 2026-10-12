"use strict";

/* ----------------------------------------------------------------------------
 * OSINT-IG — porównywarka profili Instagram (czysty front, bez backendu)
 *
 * Instagram blokuje zapytania cross-origin (CORS), więc publiczne dane profilu
 * próbujemy pobrać przez kilka CORS-proxy po kolei. Gdy wszystkie zawiodą,
 * profil wchodzi w tryb ręczny — pola stają się edytowalne.
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

const form = document.getElementById("compare-form");
const inputA = document.getElementById("user-a");
const inputB = document.getElementById("user-b");
const btn = document.getElementById("compare-btn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

/* ---------------------------- Pomocnicze --------------------------------- */

function normalizeUsername(raw) {
  let v = (raw || "").trim();
  if (!v) return "";
  // Zdejmij pełny URL profilu, jeśli ktoś wklei link.
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
    avatar: "",
    verified: false,
    private: false,
    followers: null,
    following: null,
    posts: null,
    manual: true, // domyślnie ręczny; ustawiamy false po udanym pobraniu
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
        // Najczęściej IG oddał stronę logowania zamiast JSON-a → spróbuj dalej.
        continue;
      }
      const profile = parseProfile(json, username);
      if (profile) return profile;
    } catch {
      // Sieć/CORS/proxy padło — próbujemy następnego.
    }
  }
  return null;
}

/* ------------------------------ Renderowanie ----------------------------- */

const METRICS = [
  { key: "followers", label: "Obserwujący", higher: true },
  { key: "following", label: "Obserwuje", higher: true },
  { key: "posts", label: "Posty", higher: true },
  { key: "ratio", label: "Ratio (obs./obserwuje)", higher: true, derived: true },
];

function ratio(p) {
  if (!p.following || Number(p.following) === 0) return null;
  if (p.followers === null || p.followers === "") return null;
  return Number(p.followers) / Number(p.following);
}

function metricValue(p, key) {
  if (key === "ratio") {
    const r = ratio(p);
    return r === null ? null : r;
  }
  const v = p[key];
  return v === null || v === "" ? null : Number(v);
}

function formatMetric(key, val) {
  if (val === null) return "—";
  if (key === "ratio") return val.toFixed(2);
  return formatNumber(val);
}

function cardHtml(p, side) {
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
         Nie udało się pobrać danych tego profilu automatycznie.
         Uzupełnij je ręcznie lub
         <a href="https://www.instagram.com/${escapeHtml(p.username)}/" target="_blank" rel="noopener" class="relink">otwórz profil na IG</a>.
       </p>`
    : "";

  const stats = METRICS.map((m) => {
    const val = metricValue(p, m.key);
    if (p.manual && !m.derived) {
      return `<li>
          <span class="label">${m.label}</span>
          <input class="edit" type="number" min="0" inputmode="numeric"
                 data-side="${side}" data-key="${m.key}"
                 value="${val === null ? "" : val}" placeholder="—" />
        </li>`;
    }
    return `<li>
        <span class="label">${m.label}</span>
        <span class="value" data-side="${side}" data-key="${m.key}">${formatMetric(m.key, val)}</span>
      </li>`;
  }).join("");

  return `
    <article class="card" data-side="${side}">
      ${manualNote}
      <div class="card-head">
        ${avatar}
        <div class="names">
          <div class="handle">@${escapeHtml(p.username)} ${badges}</div>
          ${p.fullName ? `<div class="fullname">${escapeHtml(p.fullName)}</div>` : ""}
        </div>
      </div>
      ${p.bio ? `<p class="bio">${escapeHtml(p.bio)}</p>` : ""}
      <ul class="stats">${stats}</ul>
    </article>`;
}

let current = { a: null, b: null };

function highlightWinners() {
  const { a, b } = current;
  if (!a || !b) return;

  // Komórka metryki to albo wyświetlany <span class="value">, albo
  // edytowalny <input class="edit"> (tryb ręczny) — obsłuż oba.
  const cell = (side, key) =>
    resultsEl.querySelector(
      `.value[data-side="${side}"][data-key="${key}"], input.edit[data-side="${side}"][data-key="${key}"]`
    );

  for (const m of METRICS) {
    const va = metricValue(a, m.key);
    const vb = metricValue(b, m.key);

    const elA = cell("a", m.key);
    const elB = cell("b", m.key);

    // Odśwież tekst dla pól pochodnych (ratio zależy od ręcznych wartości).
    if (m.derived) {
      if (elA && elA.tagName !== "INPUT") elA.textContent = formatMetric(m.key, va);
      if (elB && elB.tagName !== "INPUT") elB.textContent = formatMetric(m.key, vb);
    }

    if (elA) elA.classList.remove("win");
    if (elB) elB.classList.remove("win");

    if (va === null || vb === null || va === vb) continue;
    const aWins = m.higher ? va > vb : va < vb;
    if (aWins && elA) elA.classList.add("win");
    if (!aWins && elB) elB.classList.add("win");
  }
}

function render(a, b) {
  current = { a, b };
  resultsEl.innerHTML = cardHtml(a, "a") + cardHtml(b, "b");
  resultsEl.hidden = false;

  // Edycja ręcznych pól → aktualizuj model i podświetlenia na żywo.
  resultsEl.querySelectorAll("input.edit").forEach((inp) => {
    inp.addEventListener("input", () => {
      const side = inp.dataset.side;
      const key = inp.dataset.key;
      const raw = inp.value.trim();
      current[side][key] = raw === "" ? null : Number(raw);
      highlightWinners();
    });
  });

  highlightWinners();
}

/* ------------------------------- Zdarzenia ------------------------------- */

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const ua = normalizeUsername(inputA.value);
  const ub = normalizeUsername(inputB.value);

  if (!ua || !ub) {
    statusEl.textContent = "Podaj obie nazwy użytkownika.";
    statusEl.classList.add("error");
    return;
  }
  statusEl.classList.remove("error");

  btn.disabled = true;
  statusEl.textContent = "Pobieram dane profili z Instagrama…";
  resultsEl.hidden = true;

  const [resA, resB] = await Promise.all([fetchProfile(ua), fetchProfile(ub)]);

  const a = resA || emptyProfile(ua);
  const b = resB || emptyProfile(ub);

  const failed = [];
  if (!resA) failed.push("@" + ua);
  if (!resB) failed.push("@" + ub);

  if (failed.length === 0) {
    statusEl.textContent = "Gotowe ✓";
    statusEl.classList.remove("error");
  } else {
    statusEl.textContent =
      `Nie udało się pobrać: ${failed.join(", ")}. Uzupełnij dane ręcznie w kartach poniżej.`;
    statusEl.classList.add("error");
  }

  render(a, b);
  btn.disabled = false;
});
