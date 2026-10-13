"use strict";

/* ----------------------------------------------------------------------------
 * Ciasteczka sesji Instagrama przekazywane przez klienta.
 *
 * Klient wysyła je nagłówkiem `x-ig-cookies` ("name=value; name2=value2")
 * albo, w starszym trybie, samo `sessionid` nagłówkiem `x-ig-session`.
 * Serwer przepuszcza tylko ciasteczka z białej listy, waliduje znaki i nigdy
 * ich nie zapisuje ani nie loguje: żyją wyłącznie w czasie jednego zapytania.
 * -------------------------------------------------------------------------- */

const { ApiError } = require("./errors");

/** Ciasteczka, które wysyła przeglądarka zalogowana na instagram.com. */
const ALLOWED = new Set([
  "sessionid", "ds_user_id", "csrftoken", "mid", "ig_did", "ig_nrcb", "rur", "datr", "shbid", "shbts", "wd", "dpr",
]);

// Wartość ciasteczka: drukowalne ASCII bez spacji, średnika i przecinka (RFC 6265 cookie-octet + %).
const VALUE_RE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E"\\]{1,1024}$/;

function invalid(message, hint) {
  return new ApiError("BAD_REQUEST", {
    stage: "validate",
    message,
    hint: hint || "Połącz konto ponownie w zakładce Sesja IG (rozszerzenie albo wklejenie ciasteczek).",
  });
}

/**
 * Buduje obiekt sesji z nagłówków zapytania.
 * @returns {{ cookie: string, csrf: string|null, userId: string|null, names: string[] } | null}
 */
function sessionFromHeaders(headers) {
  const raw = headers["x-ig-cookies"];
  const legacy = headers["x-ig-session"];
  if (!raw && !legacy) return null;

  const jar = new Map();
  if (raw) {
    const str = String(raw);
    if (str.length > 6000) throw invalid("Nagłówek ciasteczek jest za długi.");
    for (const part of str.split(";")) {
      const p = part.trim();
      if (!p) continue;
      const eq = p.indexOf("=");
      if (eq <= 0) throw invalid("Ciasteczka mają niepoprawny format (oczekiwano name=value; …).");
      const name = p.slice(0, eq).trim();
      const value = p.slice(eq + 1).trim();
      if (!ALLOWED.has(name)) continue; // nieznane ciasteczka po cichu pomijamy
      if (!VALUE_RE.test(value)) throw invalid(`Ciasteczko ${name} zawiera niedozwolone znaki.`);
      jar.set(name, value);
    }
  } else {
    const v = String(legacy).trim();
    if (!VALUE_RE.test(v)) {
      throw invalid("Cookie sesji ma niepoprawny format.", "Wklej samą wartość sessionid, bez nazwy, średników i spacji.");
    }
    jar.set("sessionid", v);
  }

  if (!jar.has("sessionid")) {
    throw new ApiError("SESSION_MISSING", {
      stage: "validate",
      message: "Wśród przekazanych ciasteczek nie ma sessionid.",
      hint: "Bez sessionid Instagram nie rozpozna zalogowania. Wyeksportuj ciasteczka z karty, na której jesteś zalogowany.",
    });
  }
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  return {
    cookie,
    csrf: jar.get("csrftoken") || null,
    userId: jar.get("ds_user_id") || decodeURIComponent(jar.get("sessionid")).split(":")[0] || null,
    names: [...jar.keys()],
  };
}

module.exports = { sessionFromHeaders, ALLOWED };
