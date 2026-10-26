"use strict";

/* ----------------------------------------------------------------------------
 * OSINT-IG — backend (zero zależności runtime).
 *
 *  • proxy do Instagrama (omija CORS, dokłada wymagane nagłówki),
 *  • strumień postępu na żywo (SSE): każdy krok zadania widać w UI,
 *  • ustrukturyzowane błędy z diagnostyką odpowiedzi IG,
 *  • proxy obrazków z CDN IG (miniatury blokowane przez CORP),
 *  • serwowanie zbudowanego frontu (dist/) w trybie web.
 *
 * Uruchomienie:  node api/server.js   (domyślnie http://127.0.0.1:8000)
 * Zmienne: PORT, HOST, OSINT_STATIC_DIR, OSINT_ALLOWED_ORIGINS (po przecinku).
 * -------------------------------------------------------------------------- */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { createHash } = require("node:crypto");
const { ApiError, CODES, toApiError } = require("./errors");
const { Trace } = require("./trace");
const { sessionFromHeaders } = require("./cookies");
const { createExtensionBridge } = require("./extension-bridge");
const {
  fetchProfileUser, fetchFriendList, fetchFollowersPage, fetchWhoami, usersFromResponse, cooldownState, resetCooldown, UA,
} = require("./instagram");
const {
  buildPayload, buildPayloadTraced, normalizePosts, collectConnections, estimateAudience,
} = require("./normalize");

const VERSION = "0.5.0";
const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || "127.0.0.1";
const STATIC_DIR = process.env.OSINT_STATIC_DIR || path.join(__dirname, "..", "dist");
const STARTED = Date.now();

const ALLOWED_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...String(process.env.OSINT_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
]);

// Pamięć podręczna wyników analizy: ponowne otwarcie profilu nie pyta IG.
const CACHE_TTL_MS = Number(process.env.OSINT_CACHE_TTL_MS) || 15 * 60_000;
const profileCache = new Map(); // key -> { at, payload }
const cacheKey = (username, session) => `${username.toLowerCase()}|${session ? createHash("sha256").update(session.cookie).digest("hex") : "a"}`;

const IMG_HOSTS = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

/* ------------------------------- Pomocnicze ------------------------------- */

function stamp() {
  return new Date().toISOString().slice(11, 23);
}

function log(...args) {
  console.log(`[${stamp()}]`, ...args);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "x-ig-session, x-ig-cookies, content-type, accept, x-osint-bridge, x-osint-transfer, x-osint-result",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    };
  }
  return {};
}

function sendJson(req, res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(req),
  });
  res.end(body);
}

/** Normalizuje nazwę konta (akceptuje @nick, URL profilu) i waliduje znaki. */
function parseUsername(raw) {
  let v = String(raw || "").trim();
  const m = v.match(/instagram\.com\/([^/?#]+)/i);
  if (m) v = m[1];
  v = v.replace(/^@+/, "").trim();
  if (!v) throw new ApiError("BAD_REQUEST", { stage: "validate", message: "Brak nazwy konta (parametr username)." });
  if (!/^[A-Za-z0-9._]{1,30}$/.test(v)) {
    throw new ApiError("BAD_REQUEST", {
      stage: "validate",
      message: `„${v.slice(0, 40)}” nie jest poprawną nazwą konta Instagram.`,
    });
  }
  return v;
}

function parseUserId(raw, required = false) {
  if (!raw && !required) return undefined;
  if (!/^\d{1,30}$/.test(raw || "")) throw new ApiError("BAD_REQUEST", { stage: "validate", message: "Niepoprawne ID konta Instagram." });
  return raw;
}

function readSession(req, required) {
  const s = sessionFromHeaders(req.headers);
  if (!s && required) throw new ApiError("SESSION_MISSING", { stage: "validate" });
  return s;
}

const wantsStream = (req, u) =>
  u.searchParams.get("stream") === "1" || /text\/event-stream/.test(req.headers.accept || "");

/**
 * Uruchamia zadanie z trace. W trybie strumienia wysyła SSE:
 *   event: trace  → kroki/logi/postęp (na żywo)
 *   event: result → wynik
 *   event: error  → ApiError.toJSON()
 * W trybie zwykłym zwraca JSON z dołączonym `trace`.
 */
async function runJob(req, res, u, job, fn) {
  const stream = wantsStream(req, u);
  let closed = false;
  let heartbeat = null;
  const write = (event, data) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const trace = new Trace(job, stream ? (ev) => write("trace", ev) : null);

  if (stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...corsHeaders(req),
    });
    res.on("close", () => { closed = true; trace.cancelled = true; clearInterval(heartbeat); });
    heartbeat = setInterval(() => { if (!closed) res.write(": ping\n\n"); }, 10000);
    write("start", { job, traceId: trace.id, at: new Date().toISOString() });
  }

  const t0 = Date.now();
  try {
    const result = await fn(trace);
    const ms = Date.now() - t0;
    log(`${job} ok ${ms}ms`);
    if (stream) { write("result", { ...result, ms }); res.end(); }
    else sendJson(req, res, 200, { ...result, ms, trace: trace.events });
  } catch (e) {
    const err = toApiError(e, e && e.stage);
    const ms = Date.now() - t0;
    log(`${job} FAIL ${err.code} ${err.message} (${ms}ms)`);
    const body = { ok: false, error: { ...err.toJSON(), job, ms, traceId: trace.id } };
    if (stream) { write("error", body.error); res.end(); }
    else sendJson(req, res, err.status, { ...body, trace: trace.events });
  } finally {
    clearInterval(heartbeat);
  }
}

/* ------------------------------ Proxy obrazków ---------------------------- */

async function proxyImage(req, res, u) {
  const raw = u.searchParams.get("url") || "";
  let target;
  try { target = new URL(raw); } catch { target = null; }
  if (!target || target.protocol !== "https:" || !IMG_HOSTS.test(target.hostname)) {
    return sendJson(req, res, 400, { ok: false, error: new ApiError("IMAGE_BLOCKED", { stage: "image", detail: raw.slice(0, 200) }).toJSON() });
  }
  try {
    const up = await fetch(target, {
      headers: { "User-Agent": UA, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(15000),
    });
    if (!up.ok) {
      res.writeHead(up.status === 404 ? 404 : 502, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(req) });
      return res.end(`CDN IG: HTTP ${up.status}`);
    }
    const buf = Buffer.from(await up.arrayBuffer());
    res.writeHead(200, {
      "Content-Type": up.headers.get("content-type") || "image/jpeg",
      "Content-Length": buf.length,
      "Cache-Control": "private, max-age=3600",
      "Cross-Origin-Resource-Policy": "cross-origin",
      ...corsHeaders(req),
    });
    res.end(buf);
  } catch (e) {
    const err = toApiError(e, "image");
    res.writeHead(err.status, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(req) });
    res.end(err.message);
  }
}

/* ------------------------------ Pliki statyczne --------------------------- */

function serveStatic(req, res, pathname) {
  const root = path.resolve(STATIC_DIR);
  let rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (!rel) rel = "index.html";
  let file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("403");
  }
  fs.stat(file, (err, st) => {
    // SPA: nieznane ścieżki bez rozszerzenia → index.html
    if (err || !st.isFile()) {
      if (path.extname(rel)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("404");
      }
      file = path.join(root, "index.html");
    }
    fs.readFile(file, (e2, data) => {
      if (e2) {
        res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(
          "<!doctype html><meta charset=utf-8><title>OSINT-IG</title>" +
          "<body style='font-family:system-ui;padding:40px;background:#1c1917;color:#e7e5e4'>" +
          "<h1>Front nie jest zbudowany</h1><p>Uruchom <code>npm run build</code>, a potem <code>npm start</code>. " +
          "W trybie deweloperskim użyj <code>npm run dev</code>.</p></body>"
        );
      }
      const ext = path.extname(file).toLowerCase();
      const immutable = rel.startsWith("assets/");
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      });
      res.end(data);
    });
  });
}

/* --------------------------------- Routing -------------------------------- */

const extensionBridge = createExtensionBridge({ allowedOrigins: ALLOWED_ORIGINS, sendJson });
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const t0 = Date.now();
  res.on("finish", () => {
    if (u.pathname.startsWith("/api/") && u.pathname !== "/api/img" && !u.pathname.startsWith("/api/extension/")) {
      log(`${req.method} ${u.pathname}${u.search.replace(/url=[^&]+/, "url=…")} → ${res.statusCode} ${Date.now() - t0}ms`);
    }
  });

  try {
    if (await extensionBridge.handle(req, res)) return;
  } catch {
    return sendJson(req, res, 400, { ok: false, message: "Błąd połączenia rozszerzenia." });
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, OPTIONS" });
    return res.end();
  }

  try {
    switch (u.pathname) {
      case "/api/health":
        return sendJson(req, res, 200, {
          ok: true,
          version: VERSION,
          node: process.version,
          platform: `${process.platform}-${process.arch}`,
          pid: process.pid,
          uptimeMs: Date.now() - STARTED,
          host: HOST,
          port: PORT,
          sea: (() => { try { return require("node:sea").isSea(); } catch { return false; } })(),
          cooldown: cooldownState(),
          cache: { entries: profileCache.size, ttlMs: CACHE_TTL_MS },
        });

      case "/api/cooldown/reset":
        resetCooldown();
        log("Ręcznie zdjęto blokadę zapytań do IG.");
        return sendJson(req, res, 200, { ok: true, cooldown: cooldownState() });

      case "/api/cache/clear": {
        const n = profileCache.size;
        profileCache.clear();
        return sendJson(req, res, 200, { ok: true, cleared: n });
      }

      case "/api/errors":
        return sendJson(req, res, 200, { ok: true, codes: CODES });

      case "/api/import/firefox": {
        // Czyta ciasteczka IG z lokalnego Firefoksa (serwer działa na tym samym PC).
        // Zwraca front gotowe nagłówki sesji; wartości sessionid nie trafiają do logów.
        let result;
        try {
          const { readInstagramSessions } = require("./firefox-cookies");
          result = readInstagramSessions();
        } catch (e) {
          return sendJson(req, res, 200, { ok: false, candidates: [], error: `Odczyt z Firefoksa nie powiódł się: ${e.message}` });
        }
        if (result.ok) {
          const who = result.candidates.map((c) => `profil ${c.profile}${c.userId ? ` · id ${c.userId}` : ""}`).join(", ");
          log(`Firefox: znaleziono ${result.candidates.length} zalogowaną sesję IG (${who}).`);
        }
        return sendJson(req, res, 200, result);
      }

      case "/api/profile": {
        const username = parseUsername(u.searchParams.get("username"));
        const knownId = parseUserId(u.searchParams.get("userId"));
        const session = readSession(req, false);
        return runJob(req, res, u, `profile @${username}`, async (trace) => {
          trace.log("info", `Analiza @${username}${session ? ` (z sesją IG: ${session.names.length} ciasteczek)` : " (anonimowo)"}`);
          const key = cacheKey(username, session);
          const hit = profileCache.get(key);
          if (hit && u.searchParams.get("fresh") !== "1" && Date.now() - hit.at < CACHE_TTL_MS) {
            const age = Math.round((Date.now() - hit.at) / 1000);
            await trace.step("cache", "Wynik z pamięci podręcznej serwera", (s) => s.detail(`wiek ${age} s · bez zapytania do IG`));
            return { ...hit.payload, cached: true, cacheAgeMs: Date.now() - hit.at };
          }
          const user = await fetchProfileUser(trace, username, session || undefined, knownId);
          const payload = await buildPayloadTraced(user, username, trace);
          profileCache.set(key, { at: Date.now(), payload });
          if (profileCache.size > 300) profileCache.delete(profileCache.keys().next().value);
          return payload;
        });
      }

      case "/api/whoami": {
        const session = readSession(req, true);
        return runJob(req, res, u, "whoami", (trace) => fetchWhoami(trace, session));
      }

      case "/api/list": {
        const username = parseUsername(u.searchParams.get("username"));
        const type = u.searchParams.get("type") === "following" ? "following" : "followers";
        const limit = parseInt(u.searchParams.get("limit"), 10) || 300;
        const session = readSession(req, true);
        return runJob(req, res, u, `${type} @${username}`, (trace) => {
          trace.log("info", `Lista ${type === "following" ? "obserwowanych" : "obserwujących"} @${username}, limit ${limit}`);
          return fetchFriendList(trace, username, type, session, limit);
        });
      }

      case "/api/followers/page": {
        const username = parseUsername(u.searchParams.get("username"));
        const userId = parseUserId(u.searchParams.get("userId"), true);
        const cursor = u.searchParams.get("cursor") || "";
        if (cursor.length > 2048 || /[\r\n]/.test(cursor)) throw new ApiError("BAD_REQUEST", { stage: "validate" });
        const count = Number(u.searchParams.get("count")) || 50;
        const session = readSession(req, true);
        return runJob(req, res, u, `followers @${username}`, (trace) => fetchFollowersPage(trace, username, userId, session, cursor, count));
      }

      case "/api/img":
        return proxyImage(req, res, u);

      default:
        if (u.pathname.startsWith("/api/")) {
          return sendJson(req, res, 404, {
            ok: false,
            error: { code: "NOT_FOUND", message: `Nieznany endpoint ${u.pathname}.`, hint: "Dostępne: /api/health, /api/profile, /api/list, /api/whoami, /api/img." },
          });
        }
        return serveStatic(req, res, u.pathname);
    }
  } catch (e) {
    const err = toApiError(e, e && e.stage);
    return sendJson(req, res, err.status, { ok: false, error: err.toJSON() });
  }
});

/** Uruchamia nasłuch (wywoływane przy `node api/server.js` i z sidecara Tauri). */
function start() {
  const extensionPort = Number(process.env.OSINT_EXTENSION_PORT) || 17654;
  extensionBridge.listener.on("error", (e) => {
    log(`Połączenie rozszerzenia niedostępne na porcie ${extensionPort} (${e.code}). Zamknij inne instancje OSINT-IG.`);
  });
  extensionBridge.listener.listen(extensionPort, "127.0.0.1");
  server.on("close", () => extensionBridge.listener.close());
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.error(`[OSINT-IG] Port ${PORT} jest zajęty. Zamknij inną instancję albo ustaw PORT=…`);
    } else {
      console.error("[OSINT-IG] Błąd serwera:", e);
    }
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    // Linia czytana przez powłokę Tauri — nie zmieniaj formatu.
    console.log(`OSINT-IG READY http://${HOST}:${PORT}`);
    log(`OSINT-IG v${VERSION} · node ${process.version} · http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  });
  // Powłoka Tauri zamyka stdin przy wyjściu: kończymy się razem z nią (bez sierot).
  if (process.env.OSINT_SIDECAR === "1") {
    process.stdin.on("end", () => process.exit(0));
    process.stdin.resume();
  }
}

// Startuj serwer tylko przy bezpośrednim uruchomieniu (nie przy imporcie w teście).
if (require.main === module) start();

module.exports = {
  server, start, buildPayload, estimateAudience, normalizePosts, collectConnections, usersFromResponse, parseUsername,
};
