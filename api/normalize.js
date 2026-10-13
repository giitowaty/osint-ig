"use strict";

/* ----------------------------------------------------------------------------
 * Normalizacja surowych danych web_profile_info do modelu aplikacji.
 * Czyste funkcje bez sieci (testowane w api/test.js).
 * -------------------------------------------------------------------------- */

const { guessGender } = require("./names");
const {
  classifyTopics, commentSentiment, deriveInterests, classifyAccount,
} = require("./content");

function mediaType(node) {
  switch (node.__typename) {
    case "GraphVideo": return "video";
    case "GraphSidecar": return "carousel";
    default: return "image";
  }
}

const timeline = (user) =>
  (user.edge_owner_to_timeline_media && user.edge_owner_to_timeline_media.edges) || [];

function normalizePosts(user) {
  return timeline(user).map(({ node }) => {
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
    for (const e of (node.edge_media_to_tagged_user && node.edge_media_to_tagged_user.edges) || []) {
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
      views: node.video_view_count ?? null,
      takenAt: node.taken_at_timestamp ? node.taken_at_timestamp * 1000 : null,
      likes,
      comments: node.edge_media_to_comment ? node.edge_media_to_comment.count : null,
      caption: caption || "",
      alt: node.accessibility_caption || "",
      location: (node.location && node.location.name) || "",
      tagged,
    };
  });
}

/** Podglądowe komentarze z ostatnich postów: [{ username, fullName, text }]. */
function collectComments(user) {
  const out = [];
  for (const { node } of timeline(user)) {
    for (const e of (node.edge_media_preview_comment && node.edge_media_preview_comment.edges) || []) {
      const n = e.node || {};
      const o = n.owner || {};
      out.push({ username: o.username || "", fullName: o.full_name || "", text: n.text || "" });
    }
  }
  return out;
}

/**
 * Konta powiązane z profilem: oznaczone + współautorzy + @wzmianki w opisach,
 * z liczbą wystąpień i rodzajem relacji. Zwraca [{ username, count, kinds }].
 */
function collectConnections(posts, own) {
  const ownN = String(own || "").toLowerCase();
  const freq = new Map();
  const bump = (raw, kind) => {
    const a = String(raw || "").toLowerCase().replace(/^@/, "").trim();
    if (!a || a === ownN || a.length < 2) return;
    const cur = freq.get(a) || { count: 0, kinds: new Set() };
    cur.count++;
    cur.kinds.add(kind);
    freq.set(a, cur);
  };
  for (const p of posts) {
    for (const t of p.tagged || []) bump(t, "tag");
    for (const m of (p.caption || "").matchAll(/@([A-Za-z0-9._]{2,30})/g)) bump(m[1].replace(/\.+$/, ""), "mention");
  }
  return [...freq.entries()]
    .map(([username, v]) => ({ username, count: v.count, kinds: [...v.kinds] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}

/** Hashtagi z opisów: [{ tag, count }]. */
function collectHashtags(posts) {
  const freq = new Map();
  for (const p of posts) {
    for (const m of `${p.caption} ${p.alt}`.matchAll(/#([\p{L}\p{N}_]{2,30})/gu)) {
      const t = m[1].toLowerCase();
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  return [...freq.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

/** Szacuje rozkład płci z próbki komentujących i lajkujących ostatnie posty. */
function estimateAudience(user) {
  const seen = new Map(); // username -> fullName
  for (const c of collectComments(user)) {
    if (c.username) seen.set(c.username, c.fullName);
  }
  for (const { node } of timeline(user)) {
    for (const e of (node.edge_media_preview_like && node.edge_media_preview_like.edges) || []) {
      const n = e.node;
      if (n && n.username) seen.set(n.username, n.full_name || "");
    }
  }
  let female = 0, male = 0, unknown = 0;
  const sample = [];
  for (const [username, fullName] of seen) {
    const g = guessGender(fullName, username);
    if (g.gender === "female") female++;
    else if (g.gender === "male") male++;
    else unknown++;
    if (sample.length < 60) sample.push({ username, fullName, gender: g.gender, confidence: g.confidence });
  }
  return {
    available: seen.size > 0,
    sampleSize: seen.size,
    female,
    male,
    unknown,
    sample,
    source: "próbka komentujących i lajkujących ostatnie posty (podgląd)",
  };
}

function buildProfile(user, username) {
  return {
    id: user.id || null,
    username: user.username || username,
    fullName: user.full_name || "",
    bio: user.biography || "",
    externalUrl: user.external_url || "",
    avatar: user.profile_pic_url_hd || user.profile_pic_url || "",
    verified: !!user.is_verified,
    private: !!user.is_private,
    category: user.category_name || user.business_category_name || "",
    isBusiness: !!user.is_business_account,
    isProfessional: !!user.is_professional_account,
    followers: user.edge_followed_by ? user.edge_followed_by.count : null,
    following: user.edge_follow ? user.edge_follow.count : null,
    posts: user.edge_owner_to_timeline_media ? user.edge_owner_to_timeline_media.count : null,
    highlights: user.highlight_reel_count ?? null,
  };
}

/**
 * Buduje pełny payload. Gdy podano `trace`, każdy etap analizy jest raportowany.
 */
async function buildPayloadTraced(user, username, trace) {
  const run = (stage, label, fn) => (trace ? trace.step(stage, label, fn) : fn({ detail() {}, warn() {}, progress() {} }));

  const profile = await run("normalize", "Normalizacja profilu", (s) => {
    const p = buildProfile(user, username);
    s.detail(`@${p.username} · ${p.private ? "prywatny" : "publiczny"}${p.verified ? " · zweryfikowany" : ""}`);
    return p;
  });
  const posts = await run("normalize", "Normalizacja postów", (s) => {
    const list = normalizePosts(user);
    if (!list.length) s.warn(profile.private ? "Profil prywatny: brak postów w odpowiedzi." : "Brak postów w odpowiedzi IG.");
    else s.detail(`${list.length} postów`);
    return list;
  });
  const comments = collectComments(user);
  const connections = await run("analyze", "Powiązania (oznaczenia, collab, @wzmianki)", (s) => {
    const c = collectConnections(posts, profile.username);
    s.detail(`${c.length} kont`);
    return c;
  });
  const hashtags = collectHashtags(posts);
  const topics = await run("analyze", "Klasyfikacja tematyki", (s) => {
    const t = classifyTopics(posts);
    if (!t) s.warn("Za mało tekstu do klasyfikacji.");
    else s.detail(t.topics.slice(0, 3).map((x) => x.category).join(", ") || "brak dominujących");
    return t;
  });
  const interests = deriveInterests(posts, topics, profile.username);
  const classification = await run("analyze", "Archetyp konta", (s) => {
    const c = classifyAccount(profile, topics, posts);
    if (c) s.detail(`${c.primary} (~${Math.round((c.confidence || 0) * 100)}%)`);
    return c;
  });
  const sentiment = await run("analyze", "Wydźwięk komentarzy", (s) => {
    const r = commentSentiment(comments);
    if (!r || !r.available) s.warn((r && r.reason) || "Brak komentarzy.");
    else s.detail(`${r.sampleSize} komentarzy · ton: ${r.tone}`);
    return r;
  });
  const audience = await run("analyze", "Szacunek płci odbiorców", (s) => {
    const a = estimateAudience(user);
    if (!a.available) s.warn("Brak próbki komentujących/lajkujących.");
    else s.detail(`próbka ${a.sampleSize} osób`);
    return a;
  });

  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    profile,
    posts,
    connections,
    hashtags,
    audience,
    content: { topics, interests, classification, sentiment },
  };
}

/** Wersja synchroniczna (bez trace) — zachowana dla testów i zgodności. */
function buildPayload(user, username) {
  const profile = buildProfile(user, username);
  const posts = normalizePosts(user);
  const topics = classifyTopics(posts);
  return {
    ok: true,
    profile,
    posts,
    connections: collectConnections(posts, profile.username),
    hashtags: collectHashtags(posts),
    audience: estimateAudience(user),
    content: {
      topics,
      interests: deriveInterests(posts, topics, profile.username),
      classification: classifyAccount(profile, topics, posts),
      sentiment: commentSentiment(collectComments(user)),
    },
  };
}

module.exports = {
  buildPayload, buildPayloadTraced, buildProfile, normalizePosts, collectComments,
  collectConnections, collectHashtags, estimateAudience,
};
