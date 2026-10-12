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
    return {
      shortcode: node.shortcode || "",
      thumbnail: node.thumbnail_src || node.display_url || "",
      type: mediaType(node),
      isVideo: !!node.is_video,
      likes,
      comments: node.edge_media_to_comment ? node.edge_media_to_comment.count : null,
      caption: caption || "",
      alt: node.accessibility_caption || "",
    };
  });
}

/**
 * Zbiera próbkę użytkowników z podglądowych komentarzy i polubień postów
 * (bez dodatkowych zapytań) i szacuje rozkład płci.
 */
function estimateAudience(user) {
  const edges =
    (user.edge_owner_to_timeline_media && user.edge_owner_to_timeline_media.edges) || [];

  const seen = new Map(); // username -> fullName
  for (const { node } of edges) {
    const comments =
      (node.edge_media_preview_comment && node.edge_media_preview_comment.edges) || [];
    for (const e of comments) {
      const o = e.node && e.node.owner;
      if (o && o.username) seen.set(o.username, o.full_name || "");
    }
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
  return {
    ok: true,
    profile: {
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
    },
    posts: normalizePosts(user),
    audience: estimateAudience(user),
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

module.exports = { server, buildPayload, estimateAudience, normalizePosts };
