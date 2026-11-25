"use strict";

/* ----------------------------------------------------------------------------
 * Autotest połączenia z Instagramem.
 *
 * Sprawdza po kolei każde zapytanie, z którego korzysta program, na jednym
 * znanym publicznym profilu i mówi, które przestało działać oraz który klucz
 * pliku ig-queries.json (patrz ig-queries.js) trzeba poprawić. Limit 429 lub
 * checkpoint przerywa dalsze sprawdzanie — kolejne zapytania tylko by go
 * przedłużyły.
 * -------------------------------------------------------------------------- */

const { ApiError, toApiError } = require("./errors");
const { QUERY_KEYS } = require("./ig-queries");
const {
  fetchWebInfoProfile, fetchWhoami, pageTokens, readProfilePosts, readProfileDetails, loadQueries,
} = require("./instagram");

const STOP_CODES = new Set(["IG_RATE_LIMITED", "IG_CHECKPOINT"]);
// Kody, przy których zapytanie dotarło do IG, ale ten je odrzucił lub zwrócił coś
// nieoczekiwanego — typowy objaw zmienionego identyfikatora.
const SUSPECT_ID_CODES = new Set(["IG_BAD_RESPONSE", "IG_HTTP_ERROR", "IG_NOT_FOUND"]);

function hintFor(code, configKey, cfgPath) {
  if (code === "IG_RATE_LIMITED") return "Instagram ogranicza zapytania. Odczekaj i uruchom autotest ponownie — to nie błąd konfiguracji.";
  if (code === "IG_CHECKPOINT") return "Instagram wymaga potwierdzenia konta (checkpoint). Zaloguj się na nie w przeglądarce i potwierdź.";
  if (code === "IG_SESSION_INVALID") return "Sesja wygasła lub została odrzucona. Połącz konto ponownie w widoku Sesja IG.";
  if (code === "IG_LOGIN_REQUIRED") return "Instagram żąda logowania dla zapytań bez sesji z tego adresu IP. Połącz sesję IG — to nie błąd konfiguracji.";
  if (code === "SERVER_UNREACHABLE" || code === "NETWORK_ERROR" || code === "TIMEOUT") return "Brak połączenia z Instagramem. Sprawdź internet.";
  if (configKey && SUSPECT_ID_CODES.has(code)) {
    return `Instagram mógł zmienić identyfikator zapytania. Wpisz nowy „${configKey}” w ${cfgPath} ` +
      "(w przeglądarce: DevTools → Sieć → filtr „graphql”, otwórz profil i skopiuj doc_id z zapytania o tej nazwie).";
  }
  return null;
}

/**
 * @param {import('./trace').Trace} trace
 * @param {string} username  znany publiczny profil, np. "instagram"
 * @param {object|null} session
 */
async function runSelftest(trace, username, session) {
  const cfg = loadQueries();
  const checks = [];
  let stopped = null;

  /** Uruchamia jeden test. `fn` zwraca opis wyniku (string). */
  const check = async (id, label, configKey, fn) => {
    const base = { id, label, configKey: configKey || null, configLabel: configKey ? QUERY_KEYS[configKey].label : null };
    if (stopped) {
      checks.push({ ...base, status: "skipped", message: `Pominięto: ${stopped}.` });
      return null;
    }
    try {
      const { detail, value } = await fn();
      checks.push({ ...base, status: "ok", message: detail });
      return value;
    } catch (e) {
      const err = toApiError(e, e && e.stage);
      if (STOP_CODES.has(err.code)) stopped = err.code === "IG_RATE_LIMITED" ? "limit Instagrama" : "checkpoint konta";
      checks.push({ ...base, status: "fail", code: err.code, message: err.message, hint: hintFor(err.code, configKey, cfg.path) });
      return null;
    }
  };

  trace.log("info", `Autotest na profilu @${username}${session ? " (z sesją IG)" : " (bez sesji)"}. Konfiguracja zapytań: ${cfg.source === "file" ? cfg.path : "wartości domyślne"}.`);
  if (cfg.errors.length) trace.log("warn", `Plik ${cfg.path}: ${cfg.errors.join("; ")}`);

  const anon = await check("public", "Profil publiczny bez sesji (web_profile_info)", "appId", async () => {
    const u = await fetchWebInfoProfile(trace, username, null);
    const followers = u.edge_followed_by?.count;
    return { value: u, detail: `@${u.username}${followers != null ? ` · ${followers.toLocaleString("pl-PL")} obserwujących` : ""}` };
  });

  if (!session) {
    checks.push({ id: "session", label: "Zapytania z sesją IG", configKey: null, configLabel: null, status: "skipped",
      message: "Pominięto: brak połączonej sesji. Połącz konto w widoku Sesja IG, aby sprawdzić także zapytania GraphQL." });
  } else {
    // Weryfikacja ma kilka metod (users/{id}/info, current_user, stare query_hash) — nie wskazujemy
    // jednego klucza konfiguracji, tylko podajemy, która metoda zadziałała.
    await check("whoami", "Konto zalogowanej sesji", null, async () => {
      const who = await fetchWhoami(trace, session);
      return { detail: `zalogowano jako @${who.username} (metoda: ${who.via})` };
    });
    const tokens = await check("tokens", "Tokeny strony profilu (fb_dtsg, lsd)", null, async () => {
      const tk = await pageTokens(trace, username, session);
      if (!tk.dtsg || !tk.lsd) {
        throw new ApiError("IG_SESSION_INVALID", { stage: "bootstrap",
          message: "Strona profilu nie zawiera tokenów żądań — Instagram nie uznał sesji za zalogowaną." });
      }
      return { value: tk, detail: "fb_dtsg i lsd obecne" };
    });
    if (!tokens && !stopped) stopped = "brak tokenów strony";
    let ownerId = anon?.id || null;
    await check("posts", "Posty profilu (GraphQL)", "profilePosts", async () => {
      const edges = await readProfilePosts(trace, username, session, tokens);
      const owner = edges.map((e) => e.node?.user).find((u) => u?.username?.toLowerCase() === username.toLowerCase());
      ownerId = ownerId || owner?.pk || owner?.id || tokens.profileId || null;
      return { detail: `${edges.length} postów` };
    });
    await check("details", "Dane profilu (GraphQL)", "profilePageContent", async () => {
      if (!ownerId) throw new ApiError("IG_BAD_RESPONSE", { stage: "fetch", message: "Nie ustalono ID profilu (poprzednie testy go nie zwróciły)." });
      const p = await readProfileDetails(trace, username, session, tokens, ownerId);
      return { detail: `@${p.username}${p.follower_count != null ? ` · ${Number(p.follower_count).toLocaleString("pl-PL")} obserwujących` : ""}` };
    });
  }

  const failed = checks.filter((c) => c.status === "fail");
  return {
    ok: failed.length === 0,
    username,
    authenticated: !!session,
    checks,
    config: { source: cfg.source, path: cfg.path, overrides: cfg.overrides, errors: cfg.errors, values: cfg.values },
  };
}

module.exports = { runSelftest, hintFor };
