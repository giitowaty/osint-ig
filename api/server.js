"use strict";

/* ----------------------------------------------------------------------------
 * OSINT-IG — backend proxy (zero zależności zewnętrznych).
 *
 * Serwuje statyczny front ORAZ proxy do Instagrama, który obchodzi CORS i
 * dokłada nagłówek x-ig-app-id wymagany przez endpoint web_profile_info.
 * Zwraca znormalizowany profil, ostatnie posty oraz szacunek płci z próbki
 * komentujących/lajkujących (bez dodatkowych zapytań do IG).
 *
 * Uruchomienie:  node api/server.js        (domyślnie http://localhost:8000)
 * -------------------------------------------------------------------------- */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { guessGender } = require("./names");
const {
  classifyTopics, commentSentiment, deriveInterests, classifyAccount,
} = require("./content");

const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT || 8000;
const IG_APP_ID = "936619743392459";
const IG_ENDPOINT =
  "https://www.instagram.com/api/v1/users/web_profile_info/?username=";

const STATIC = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "application/javascript; charset=utf-8" },
  "/graph.js": { file: "graph.js", type: "application/javascript; charset=utf-8" },
  "/bubble.js": { file: "bubble.js", type: "application/javascript; charset=utf-8" },
  "/collector.js": { file: "collector.js", type: "application/javascript; charset=utf-8" },
  "/session.js": { file: "session.js", type: "application/javascript; charset=utf-8" },
};

/* ------------------------------ IG fetch --------------------------------- */

async function fetchInstagram(username) {
  const url = IG_ENDPOINT + encodeURIComponent(username);
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "x-ig-app-id": IG_APP_ID,
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    const err = new Error(`Instagram odpowiedział HTTP ${res.status}`);
    err.status = res.status === 404 ? 404 : 502;
    throw err;
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error("Instagram nie zwrócił danych (prawdopodobnie wymaga logowania).");
    err.status = 502;
    throw err;
  }
  const user = json && json.data && json.data.user;
  if (!user) {
    const err = new Error("Nie znaleziono profilu.");
    err.status = 404;
    throw err;
  }
  return user;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wyłuskuje nazwy kont z odpowiedzi IG (friendships followers/following).
function usersFromResponse(j) {
  if (!j || !Array.isArray(j.users)) return [];
  return j.users.map((u) => u && u.username).filter(Boolean);
}

/**
 * Pobiera listę obserwujących/obserwowanych konta przy użyciu cookie sesji IG
 * podanego przez użytkownika. Scraping przez zalogowaną sesję — używane tylko
 * na żądanie, sessionid nie jest nigdzie zapisywany.
 */
async function fetchFriendList(username, type, sessionid, limit) {
  const user = await fetchInstagram(username); // daje m.in. user.id
  const id = user.id;
  if (!id) { const e = new Error("Nie udało się ustalić ID konta."); e.status = 502; throw e; }
  const path = type === "following" ? "following" : "followers";
  const cap = Math.min(Math.max(1, limit || 300), 2000);
  const PAGE = 50;
  const out = [];
  let maxId = "", pages = 0;
  while (out.length < cap && pages < Math.ceil(cap / PAGE) + 3) {
    const url = `https://www.instagram.com/api/v1/friendships/${id}/${path}/?count=${PAGE}` +
      (maxId ? `&max_id=${encodeURIComponent(maxId)}` : "");
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "x-ig-app-id": IG_APP_ID,
        "X-Requested-With": "XMLHttpRequest",
        Referer: `https://www.instagram.com/${encodeURIComponent(username)}/`,
        Accept: "*/*",
        Cookie: `sessionid=${sessionid}`,
      },
    });
    if (res.status === 401 || res.status === 403) {
      const e = new Error("Sesja odrzucona lub brak dostępu (wygasłe cookie albo konto prywatne).");
      e.status = 403; throw e;
    }
    if (!res.ok) break;
    const j = await res.json().catch(() => null);
    const names = usersFromResponse(j);
    if (!names.length) break;
    for (const n of names) out.push(n);
    if (!j.next_max_id) break;
    maxId = j.next_max_id; pages++;
    await sleep(700); // delikatnie, by nie wywołać limitów
  }
  return { ok: true, username: user.username || username, type: path, count: out.length, users: out.slice(0, cap), truncated: out.length >= cap };
}

/**
 * Zwraca nazwę konta powiązanego z podanym cookie sesji IG (weryfikacja sesji
 * i pokazanie „z jakiego konta korzysta aplikacja”). Nie zapisuje sessionid.
 */
async function fetchWhoami(sessionid) {
  const res = await fetch("https://www.instagram.com/api/v1/accounts/current_user/?edit=false", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "x-ig-app-id": IG_APP_ID,
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://www.instagram.com/",
      Accept: "*/*",
      Cookie: `sessionid=${sessionid}`,
    },
  });
  if (res.status === 401 || res.status === 403) {
    const e = new Error("Sesja odrzucona (wygasłe lub błędne cookie)."); e.status = 401; throw e;
  }
  if (!res.ok) { const e = new Error(`Instagram HTTP ${res.status}`); e.status = 502; throw e; }
  const j = await res.json().catch(() => null);
  const username = j && j.user && j.user.username;
  if (!username) { const e = new Error("Nie udało się odczytać konta sesji."); e.status = 502; throw e; }
  return { ok: true, username };
}

/* ------------------------------ Normalizacja ----------------------------- */

function mediaType(node) {
  switch (node.__typename) {
    case "GraphVideo": return "video";
    case "GraphSidecar": return "carousel";
    default: return "image";
  }
}

function normalizePosts(user) {
  const edges =
    (user.edge_owner_to_timeline_media && user.edge_owner_to_timeline_media.edges) || [];
  return edges.map(({ node }) => {
    const caption =
      node.edge_media_to_caption &&
      node.edge_media_to_caption.edges[0] &&
      node.edge_media_to_caption.edges[0].node.text;
    const likes =
      (node.edge_liked_by && node.edge_liked_by.count) ??
      (node.edge_media_preview_like && node.edge_media_preview_like.count) ??
      null;
    // Konta oznaczone na zdjęciu + współautorzy (collab/regram).
    const tagged = [];
    const taggedEdges =
      (node.edge_media_to_tagged_user && node.edge_media_to_tagged_user.edges) || [];
    for (const e of taggedEdges) {
      const u = e.node && e.node.user;
      if (u && u.username) tagged.push(u.username);
    }
    for (const c of node.coauthor_producers || []) {
      if (c && c.username) tagged.push(c.username);
    }
    return {
      shortcode: node.shortcode || "",
      thumbnail: node.thumbnail_src || node.display_url || "",
      type: mediaType(node),
      isVideo: !!node.is_video,
      likes,
      comments: node.edge_media_to_comment ? node.edge_media_to_comment.count : null,
      caption: caption || "",
      alt: node.accessibility_caption || "",
      tagged,
    };
  });
}

/**
 * Zbiera podglądowe komentarze z ostatnich postów (bez dodatkowych zapytań).
 * Zwraca [{ username, fullName, text }].
 */
function collectComments(user) {
  const edges =
    (user.edge_owner_to_timeline_media && user.edge_owner_to_timeline_media.edges) || [];
  const out = [];
  for (const { node } of edges) {
    const comments =
      (node.edge_media_preview_comment && node.edge_media_preview_comment.edges) || [];
    for (const e of comments) {
      const n = e.node || {};
      const o = n.owner || {};
      out.push({ username: o.username || "", fullName: o.full_name || "", text: n.text || "" });
    }
  }
  return out;
}

/**
 * Zbiera konta powiązane z profilem: oznaczone na zdjęciach + współautorzy +
 * @wzmianki w opisach, z liczbą wystąpień. Zwraca [{ username, count }].
 */
function collectConnections(posts, own) {
  const ownN = String(own || "").toLowerCase();
  const freq = new Map();
  const bump = (raw) => {
    const a = String(raw || "").toLowerCase().replace(/^@/, "").trim();
    if (!a || a === ownN || a.length < 2) return;
    freq.set(a, (freq.get(a) || 0) + 1);
  };
  for (const p of posts) {
    for (const t of p.tagged || []) bump(t);
    for (const m of (p.caption || "").matchAll(/@([A-Za-z0-9._]{2,30})/g)) bump(m[1]);
  }
  return [...freq.entries()]
    .map(([username, count]) => ({ username, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

/**
 * Szacuje rozkład płci z próbki komentujących i lajkujących ostatnie posty.
 */
function estimateAudience(user) {
  const edges =
    (user.edge_owner_to_timeline_media && user.edge_owner_to_timeline_media.edges) || [];

  const seen = new Map(); // username -> fullName
  for (const c of collectComments(user)) {
    if (c.username) seen.set(c.username, c.fullName);
  }
  for (const { node } of edges) {
    const likes =
      (node.edge_media_preview_like && node.edge_media_preview_like.edges) || [];
    for (const e of likes) {
      const n = e.node;
      if (n && n.username) seen.set(n.username, n.full_name || "");
    }
  }

  let female = 0, male = 0, unknown = 0;
  for (const [username, fullName] of seen) {
    const g = guessGender(fullName, username).gender;
    if (g === "female") female++;
    else if (g === "male") male++;
    else unknown++;
  }

  const sampleSize = seen.size;
  return {
    available: sampleSize > 0,
    sampleSize,
    female,
    male,
    unknown,
    source: "próbka komentujących i lajkujących ostatnie posty (podgląd)",
  };
}

function buildPayload(user, username) {
  const posts = normalizePosts(user);
  const comments = collectComments(user);
  const profile = {
    username: user.username || username,
    fullName: user.full_name || "",
    bio: user.biography || "",
    externalUrl: user.external_url || "",
    avatar: user.profile_pic_url_hd || user.profile_pic_url || "",
    verified: !!user.is_verified,
    private: !!user.is_private,
    // Kategoria konta i flagi zawodowe/biznesowe nadawane w IG (autorytatywne).
    category: user.category_name || user.business_category_name || "",
    isBusiness: !!user.is_business_account,
    isProfessional: !!user.is_professional_account,
    followers: user.edge_followed_by ? user.edge_followed_by.count : null,
    following: user.edge_follow ? user.edge_follow.count : null,
    posts: user.edge_owner_to_timeline_media
      ? user.edge_owner_to_timeline_media.count
      : null,
  };
  const topics = classifyTopics(posts);
  return {
    ok: true,
    profile,
    posts,
    connections: collectConnections(posts, profile.username),
    audience: estimateAudience(user),
    content: {
      topics,
      interests: deriveInterests(posts, topics, profile.username),
      classification: classifyAccount(profile, topics, posts),
      sentiment: commentSentiment(comments),
    },
  };
}

/* -------------------------------- Routing -------------------------------- */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function serveStatic(res, entry) {
  fs.readFile(path.join(ROOT, entry.file), (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404");
      return;
    }
    res.writeHead(200, { "Content-Type": entry.type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);

  if (u.pathname === "/api/profile") {
    const username = (u.searchParams.get("username") || "").trim();
    if (!username) return sendJson(res, 400, { ok: false, error: "Brak parametru username." });
    try {
      const user = await fetchInstagram(username);
      return sendJson(res, 200, buildPayload(user, username));
    } catch (e) {
      return sendJson(res, e.status || 502, { ok: false, error: e.message });
    }
  }

  if (u.pathname === "/api/whoami") {
    const session = req.headers["x-ig-session"];
    if (!session) return sendJson(res, 401, { ok: false, error: "Brak sesji IG." });
    try {
      return sendJson(res, 200, await fetchWhoami(session));
    } catch (e) {
      return sendJson(res, e.status || 502, { ok: false, error: e.message });
    }
  }

  if (u.pathname === "/api/list") {
    const username = (u.searchParams.get("username") || "").trim();
    const type = u.searchParams.get("type") === "following" ? "following" : "followers";
    const limit = parseInt(u.searchParams.get("limit"), 10) || 300;
    const session = req.headers["x-ig-session"];
    if (!username) return sendJson(res, 400, { ok: false, error: "Brak parametru username." });
    if (!session) return sendJson(res, 401, { ok: false, error: "Brak sesji IG. Ustaw cookie sessionid." });
    try {
      const data = await fetchFriendList(username, type, session, limit);
      return sendJson(res, 200, data);
    } catch (e) {
      return sendJson(res, e.status || 502, { ok: false, error: e.message });
    }
  }

  const entry = STATIC[u.pathname];
  if (entry) return serveStatic(res, entry);

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("404");
});

// Startuj serwer tylko przy bezpośrednim uruchomieniu (nie przy imporcie w teście).
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`OSINT-IG działa na http://localhost:${PORT}`);
  });
}

module.exports = { server, buildPayload, estimateAudience, normalizePosts, collectConnections, usersFromResponse };
