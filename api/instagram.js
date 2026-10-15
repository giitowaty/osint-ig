"use strict";

/* ----------------------------------------------------------------------------
 * Zapytania do Instagrama z pełną diagnostyką.
 *
 * Każde zapytanie jest mierzone i klasyfikowane: przy błędzie powstaje ApiError
 * z kodem (rate limit, wymagane logowanie, checkpoint, 404…) oraz szczegółami
 * odpowiedzi (status, wybrane nagłówki, fragment treści). Cookie sesji nigdy nie
 * trafia do diagnostyki ani logów.
 * -------------------------------------------------------------------------- */

const { ApiError, toApiError } = require("./errors");
const { profileFromWebGraphql } = require("./web-profile");

const IG_APP_ID = "936619743392459";
// Authenticated viewer query used by the web client (not a public profile lookup).
const VIEWER_URL = "https://www.instagram.com/graphql/query/?query_hash=d6f4427fbe92d846298cf93df0b937d3&variables=%7B%7D";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const TIMEOUT_MS = Number(process.env.OSINT_IG_TIMEOUT_MS) || 15000;
const LIST_PAGE = 50;
// Pauza między stronami list znajomych. Zamiast stałych 700 ms — losowy jitter
// z wolniejszego zakresu: mniej regularny rytm (trudniej wykryć automat) i wolniej,
// żeby nie zarobić bana. Można nadpisać zmiennymi środowiskowymi.
const LIST_DELAY_MIN_MS = Number(process.env.OSINT_IG_LIST_DELAY_MIN_MS) || 3000;
const LIST_DELAY_MAX_MS = Number(process.env.OSINT_IG_LIST_DELAY_MAX_MS) || 7000;
// Losowa liczba całkowita z zakresu [min, max].
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
// Bezpieczny, losowy czas pauzy między stronami (ms); odporny na złą konfigurację.
function listDelay() {
  let lo = Math.max(500, LIST_DELAY_MIN_MS);
  let hi = Math.max(lo, LIST_DELAY_MAX_MS);
  return randInt(lo, hi);
}

const DIAG_HEADERS = [
  "content-type", "content-length", "retry-after", "location", "x-ig-origin-region",
  "x-ig-request-elapsed-time-ms", "x-ig-peak-time", "x-fb-trip-id", "x-fb-debug",
  "x-frame-options",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------------------
 * Ochrona przed limitem: po odpowiedzi 429 przez pewien czas NIE pytamy IG
 * (każde kolejne zapytanie tylko przedłuża blokadę IP). Czas rośnie przy
 * kolejnych 429 (60 s → 2 min → 5 min → 10 min) i resetuje się po sukcesie.
 * ------------------------------------------------------------------------- */
const BACKOFF_MS = [60_000, 120_000, 300_000, 600_000];
// Cooldown PER KONTO (klucz = userId sesji, albo "anon" bez sesji): limit 429 na
// jednym koncie nie zamraża pozostałych — pula kont może dalej pracować.
const guards = new Map(); // key -> { until, strikes, last }

function guardFor(key) {
  let g = guards.get(key);
  if (!g) { g = { until: 0, strikes: 0, last: null }; guards.set(key, g); }
  return g;
}

/**
 * Stan cooldownu. Z kluczem: dla jednego konta. Bez klucza: agregat po wszystkich
 * kontach (active = którekolwiek aktywne), z rozbiciem per konto w `accounts`.
 */
function cooldownState(key) {
  if (key != null) {
    const g = guards.get(key);
    if (!g) return { active: false, remainingMs: 0, strikes: 0, lastAt: null };
    const left = g.until - Date.now();
    return { active: left > 0, remainingMs: Math.max(0, left), strikes: g.strikes, lastAt: g.last };
  }
  let active = false, remainingMs = 0, strikes = 0, lastAt = null;
  const accounts = {};
  for (const [k, g] of guards) {
    const left = Math.max(0, g.until - Date.now());
    accounts[k] = { active: left > 0, remainingMs: left, strikes: g.strikes, lastAt: g.last };
    if (left > 0) active = true;
    remainingMs = Math.max(remainingMs, left);
    strikes = Math.max(strikes, g.strikes);
    if (g.last && (!lastAt || g.last > lastAt)) lastAt = g.last;
  }
  return { active, remainingMs, strikes, lastAt, accounts };
}

function tripCooldown(key, retryAfterHeader) {
  const g = guardFor(key);
  const fromHeader = Number(retryAfterHeader) > 0 ? Number(retryAfterHeader) * 1000 : 0;
  const ms = fromHeader || BACKOFF_MS[Math.min(g.strikes, BACKOFF_MS.length - 1)];
  g.strikes++;
  g.until = Date.now() + ms;
  g.last = new Date().toISOString();
  return ms;
}

/** Reset cooldownu: z kluczem jednego konta, bez klucza — wszystkich. */
function resetCooldown(key) {
  if (key != null) guards.delete(key);
  else guards.clear();
}

function pickHeaders(res) {
  const out = {};
  for (const h of DIAG_HEADERS) {
    const v = res.headers.get(h);
    if (v) out[h] = v.length > 160 ? v.slice(0, 160) + "…" : v;
  }
  return out;
}

function snippet(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > 700 ? s.slice(0, 700) + "…" : s;
}

/** Wykrywa znane komunikaty IG w treści błędu (JSON lub HTML). */
function igMessage(json, text) {
  const m = json && (json.message || json.error_type || json.status === "fail" && json.status);
  if (m) return String(m);
  if (/checkpoint_required|challenge_required/i.test(text)) return "checkpoint_required";
  if (/login_required/i.test(text)) return "login_required";
  return "";
}

/**
 * Wykonuje zapytanie GET do IG i zwraca { json, text, upstream }.
 * @param {import('./trace').Trace} trace
 * @param {{ stage: string, label: string, url: string, referer?: string, session?: { cookie: string, csrf: string|null, names: string[] }, notFoundIsError?: boolean }} o
 */
async function igGet(trace, o) {
  return trace.step(o.stage, o.label, async (step) => {
    const acctKey = (o.session && o.session.userId) || "anon"; // klucz cooldownu per konto
    const cd = cooldownState(acctKey);
    if (cd.active && !o.ignoreCooldown) {
      throw new ApiError("IG_RATE_LIMITED", {
        stage: o.stage,
        message: `Wstrzymano zapytania do Instagrama na ${Math.ceil(cd.remainingMs / 1000)} s po ostatnim limicie.`,
        hint: "Aplikacja sama czeka, żeby nie przedłużać blokady. Kolejka wznowi pracę automatycznie.",
        detail: `lokalna blokada · ${cd.strikes}. limit z rzędu`,
        retryAfterMs: cd.remainingMs,
      });
    }
    const t0 = Date.now();
    const headers = {
      "User-Agent": UA,
      "x-ig-app-id": IG_APP_ID,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "*/*",
      "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: o.referer || "https://www.instagram.com/",
    };
    if (o.session) {
      // Komplet ciasteczek jak w przeglądarce + token CSRF, którego IG oczekuje przy sesji.
      headers.Cookie = o.session.cookie;
      if (o.session.csrf) headers["X-CSRFToken"] = o.session.csrf;
    }

    let res;
    try {
      res = await fetch(o.url, { method: o.method || "GET", headers: { ...headers, ...o.headers }, body: o.body,
        redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      const err = toApiError(e, o.stage);
      err.upstream = { method: "GET", url: o.url, ms: Date.now() - t0, timeoutMs: TIMEOUT_MS };
      throw err;
    }
    const text = await res.text().catch(() => "");
    const ms = Date.now() - t0;
    const contentType = res.headers.get("content-type") || "";
    let json = null;
    const jsonText = text.replace(/^for\s*\(\s*;;\s*\);\s*/, "");
    if (/json/i.test(contentType) || /^\s*[{[]/.test(jsonText)) {
      try { json = JSON.parse(jsonText); } catch { json = null; }
    }
    const upstream = {
      method: o.method || "GET",
      url: o.url,
      finalUrl: res.url !== o.url ? res.url : undefined,
      redirected: res.redirected || undefined,
      status: res.status,
      statusText: res.statusText,
      ms,
      bytes: text.length,
      headers: pickHeaders(res),
      // A viewer response can contain account/feed data. Keep only the error
      // category in session diagnostics, never the raw authenticated response.
      body: o.stage === "session" || o.responseType === "html" || o.body ? undefined : snippet(text),
      authenticated: !!o.session,
      cookies: o.session ? o.session.names : undefined,
    };

    // Treść skanujemy tylko przy błędzie: udana odpowiedź może zawierać te słowa np. w bio.
    const msg = !res.ok || !json || json.status === "fail" ? igMessage(json, text) : "";
    const fail = (code, extra) => new ApiError(code, { stage: o.stage, upstream, detail: msg || undefined, ...extra });

    if (/accounts\/login/.test(res.url)) throw fail(o.session ? "IG_SESSION_INVALID" : "IG_LOGIN_REQUIRED");
    if (res.status === 429 || /wait a few minutes|rate limit|spam/i.test(msg)) {
      const ms = tripCooldown(acctKey, res.headers.get("retry-after"));
      trace.log("warn", `Limit IG na koncie [${acctKey}]: wstrzymuję jego zapytania na ${Math.round(ms / 1000)} s (pozostałe konta pracują dalej).`);
      throw fail("IG_RATE_LIMITED", { retryAfterMs: ms });
    }
    if (/checkpoint_required|challenge_required/.test(msg)) throw fail("IG_CHECKPOINT");
    if (res.status === 401 || /login_required/.test(msg)) {
      throw fail(o.session ? "IG_SESSION_INVALID" : "IG_LOGIN_REQUIRED");
    }
    if (res.status === 403) throw fail("IG_FORBIDDEN");
    if (res.status === 404) throw fail("IG_NOT_FOUND");
    if (!res.ok) {
      throw fail("IG_HTTP_ERROR", { message: `Instagram zwrócił HTTP ${res.status} ${res.statusText || ""}`.trim() });
    }
    if (o.responseType === "html" && /text\/html/i.test(contentType)) {
      step.detail(`HTTP ${res.status} · dane inicjalizacji strony`);
      return { text, upstream };
    }
    if (json && (json.error || json.errors?.length)) {
      throw fail("IG_BAD_RESPONSE", { message: "Instagram odrzucił zapytanie GraphQL.", detail: "Brak poprawnych danych zapytania." });
    }
    if (!json) {
      if (/text\/html/i.test(contentType)) throw fail("IG_LOGIN_REQUIRED", {
        message: "Instagram zwrócił stronę HTML zamiast danych (ściana logowania).",
      });
      throw fail("IG_BAD_RESPONSE", { message: "Odpowiedź Instagrama nie jest poprawnym JSON-em." });
    }
    resetCooldown(acctKey);
    step.detail(`HTTP ${res.status} · ${(text.length / 1024).toFixed(1)} kB · ${ms} ms`);
    return { json, text, upstream };
  });
}

/** Pobiera surowy obiekt użytkownika z web_profile_info. */
async function fetchProfileUser(trace, username, session, knownId) {
  if (session) return fetchWebProfile(trace, username, session, knownId);
  const url = "https://www.instagram.com/api/v1/users/web_profile_info/?username=" + encodeURIComponent(username);
  const { json, upstream } = await igGet(trace, {
    stage: "fetch",
    label: `GET web_profile_info @${username}`,
    url,
    referer: `https://www.instagram.com/${encodeURIComponent(username)}/`,
    session,
  });
  const user = json && json.data && json.data.user;
  if (!user) {
    throw new ApiError("IG_NOT_FOUND", {
      stage: "fetch",
      upstream,
      message: `Instagram nie zwrócił danych konta @${username}.`,
      detail: "Pole data.user jest puste.",
    });
  }
  return user;
}

async function fetchWebProfile(trace, username, session, knownId) {
  const referer = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  const { text } = await igGet(trace, { stage: "bootstrap", label: `Inicjalizacja strony @${username}`,
    url: referer, session, responseType: "html" });
  // Extract only request tokens; never retain or log the authenticated HTML.
  const dtsg = text.match(/"DTSGInitialData"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/)?.[1];
  const lsd = text.match(/"LSD"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/)?.[1];
  const query = async (name, docId, variables) => {
    const body = new URLSearchParams({ doc_id: docId, variables: JSON.stringify(variables),
      fb_api_req_friendly_name: name, fb_api_caller_class: "RelayModern", __a: "1", __user: "0",
      __d: "www", av: session.userId || "0", __comet_req: "7", server_timestamps: "true" });
    if (dtsg) {
      body.set("fb_dtsg", dtsg);
      body.set("jazoest", "2" + [...dtsg].reduce((sum, c) => sum + c.charCodeAt(0), 0));
    }
    if (lsd) body.set("lsd", lsd);
    const result = await igGet(trace, { stage: "fetch", label: `${name} @${username}`,
      url: "https://www.instagram.com/graphql/query", method: "POST", body,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://www.instagram.com",
        ...(lsd ? { "X-FB-LSD": lsd } : {}) }, referer, session });
    return result.json;
  };
  const readDetails = async (id) => {
    const details = await query("PolarisProfilePageContentQuery", "28036671149327607", {
      enable_integrity_filters: true, id: String(id),
      __relay_internal__pv__PolarisCannesGuardianExperienceEnabledrelayprovider: true,
      __relay_internal__pv__PolarisCASB976ProfileEnabledrelayprovider: false,
      __relay_internal__pv__PolarisWebSchoolsEnabledrelayprovider: false,
      __relay_internal__pv__PolarisRepostsConsumptionEnabledrelayprovider: false,
      __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
    });
    const profile = details.data?.user;
    if (!profile || profile.username?.toLowerCase() !== username.toLowerCase()) {
      throw new ApiError("IG_BAD_RESPONSE", { stage: "fetch", message: "Dane Instagrama nie pasują do żądanego profilu." });
    }
    return profile;
  };
  const knownProfile = knownId ? await readDetails(knownId) : null;
  if (knownProfile && (knownProfile.media_count === 0 || (knownProfile.is_private && !knownProfile.friendship_status?.following))) {
    trace.log("info", "Dane profilu dostępne; brak widocznych postów dla połączonego konta.");
    return profileFromWebGraphql(knownProfile, []);
  }
  const posts = await query("PolarisProfilePostsQuery", "28542612348729311", {
    data: { count: 12, include_reel_media_seen_timestamp: true, include_relationship_info: true,
      latest_besties_reel_media: true, latest_reel_media: true }, username,
    __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: true,
    __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
    __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
  });
  const feed = posts.data?.xdt_api__v1__feed__user_timeline_graphql_connection;
  if (!feed || !Array.isArray(feed.edges)) throw new ApiError("IG_BAD_RESPONSE", {
    stage: "fetch", message: "Instagram nie zwrócił listy postów profilu." });
  const owner = feed.edges.map((e) => e.node?.user).find((u) => u?.username?.toLowerCase() === username.toLowerCase());
  const id = knownId || owner?.pk || owner?.id || text.match(/"profile_id"\s*:\s*"(\d+)"/)?.[1];
  if (!id) throw new ApiError("IG_BAD_RESPONSE", { stage: "fetch",
    message: "Nie udało się ustalić ID profilu bez widocznych postów.",
    hint: "Profil może być pusty lub prywatny. Sprawdź, czy jego posty są widoczne dla połączonego konta." });
  const profile = knownProfile || await readDetails(id);
  return profileFromWebGraphql(profile, feed.edges);
}

/** One bounded page, so the client can checkpoint a long followers run. */
async function fetchFollowersPage(trace, username, userId, session, cursor, count = 50) {
  const url = `https://www.instagram.com/api/v1/friendships/${userId}/followers/?count=${Math.min(50, Math.max(1, count))}&search_surface=follow_list_page` +
    (cursor ? `&max_id=${encodeURIComponent(cursor)}` : "");
  const { json } = await igGet(trace, { stage: "list", label: `Obserwujący @${username} · kolejna strona`,
    url, session, referer: `https://www.instagram.com/${encodeURIComponent(username)}/` });
  if (json.status === "fail" || !Array.isArray(json.users)) throw new ApiError("IG_BAD_RESPONSE", { stage: "list", message: "Instagram nie zwrócił listy obserwujących." });
  const users = json.users.filter((u) => u && /^[A-Za-z0-9._]{1,30}$/.test(u.username || "") && /^\d+$/.test(String(u.pk || u.id || "")))
    .map((u) => ({ username: u.username.toLowerCase(), id: String(u.pk || u.id) }));
  const nextCursor = json.next_max_id ? String(json.next_max_id) : null;
  if (nextCursor && nextCursor === cursor) throw new ApiError("IG_BAD_RESPONSE", { stage: "list", message: "Instagram zwrócił ponownie tę samą stronę obserwujących." });
  if (nextCursor && !users.length) throw new ApiError("IG_BAD_RESPONSE", { stage: "list", message: "Instagram zwrócił pustą stronę z kolejnym kursorem." });
  return { ok: true, username, userId, users, nextCursor,
    limited: !!json.should_limit_list_of_followers || (!!json.has_more && !nextCursor) };
}

/** Wyłuskuje nazwy kont z odpowiedzi IG (friendships followers/following). */
function usersFromResponse(j) {
  if (!j || !Array.isArray(j.users)) return [];
  return j.users.map((u) => u && u.username).filter(Boolean);
}

/**
 * Pobiera listę obserwujących/obserwowanych (paginacja z opóźnieniami). Każda
 * strona to osobny krok widoczny na żywo.
 */
async function fetchFriendList(trace, username, type, session, limit) {
  const user = await fetchProfileUser(trace, username, session);
  const id = user.id;
  if (!id) throw new ApiError("IG_BAD_RESPONSE", { stage: "fetch", message: "Nie udało się ustalić ID konta." });
  if (user.is_private && !user.followed_by_viewer) {
    trace.log("warn", `@${username} jest prywatne; lista będzie dostępna tylko, jeśli konto sesji je obserwuje.`);
  }
  const kind = type === "following" ? "following" : "followers";
  const cap = Math.min(Math.max(1, limit || 300), 2000);
  const out = [];
  let maxId = "";
  let page = 0;
  let stopReason = "koniec listy";
  while (out.length < cap && page < Math.ceil(cap / LIST_PAGE) + 3) {
    if (trace.cancelled) { stopReason = "anulowano"; break; }
    page++;
    const url = `https://www.instagram.com/api/v1/friendships/${id}/${kind}/?count=${LIST_PAGE}` +
      (maxId ? `&max_id=${encodeURIComponent(maxId)}` : "");
    let json;
    try {
      ({ json } = await igGet(trace, {
        stage: "list",
        label: `GET ${kind} @${username} · strona ${page}`,
        url,
        referer: `https://www.instagram.com/${encodeURIComponent(username)}/`,
        session,
      }));
    } catch (e) {
      // Pierwsza strona: błąd krytyczny. Kolejne: zwracamy to, co już mamy.
      if (page === 1) {
        if (e instanceof ApiError && e.code === "IG_FORBIDDEN" && user.is_private) {
          throw new ApiError("IG_PRIVATE", { stage: "list", upstream: e.upstream });
        }
        throw e;
      }
      trace.log("warn", `Przerwano na stronie ${page}: ${e.message}. Zwracam ${out.length} kont.`, e.toJSON ? { error: e.toJSON() } : undefined);
      stopReason = `błąd na stronie ${page}`;
      break;
    }
    const names = usersFromResponse(json);
    for (const n of names) out.push(n);
    trace.emit({ type: "progress", stage: "list", current: out.length, total: cap, label: `${out.length} kont` });
    if (!names.length) { stopReason = "pusta strona"; break; }
    if (!json.next_max_id) break;
    maxId = json.next_max_id;
    if (out.length < cap) {
      const wait = listDelay();
      trace.log("info", `Pauza ${(wait / 1000).toFixed(1)} s przed kolejną stroną (losowe tempo ${LIST_DELAY_MIN_MS / 1000}–${LIST_DELAY_MAX_MS / 1000} s, ochrona przed limitem).`);
      await sleep(wait);
    }
  }
  if (out.length >= cap) stopReason = `osiągnięto limit ${cap}`;
  return {
    ok: true,
    username: user.username || username,
    type: kind,
    count: Math.min(out.length, cap),
    users: out.slice(0, cap),
    truncated: out.length >= cap,
    pages: page,
    stopReason,
  };
}

/** Zwraca konto powiązane z cookie sesji. */
async function fetchWhoami(trace, session) {
  const { json, upstream } = await igGet(trace, {
    stage: "session",
    label: "GET web viewer (konto zalogowanej sesji)",
    url: VIEWER_URL,
    session,
  });
  const u = json && json.data && json.data.user;
  if (!u) {
    throw new ApiError("IG_SESSION_INVALID", { stage: "session", upstream });
  }
  if (!u.username || !u.id) {
    throw new ApiError("IG_BAD_RESPONSE", { stage: "session", upstream, message: "Nie udało się odczytać konta sesji." });
  }
  return {
    ok: true,
    username: u.username,
    fullName: u.full_name || "",
    avatar: u.profile_pic_url || "",
    userId: String(u.id),
    cookies: session.names,
  };
}

module.exports = { cooldownState, resetCooldown, igGet, fetchProfileUser, fetchFriendList, fetchFollowersPage, fetchWhoami, usersFromResponse, UA };
