"use strict";

/* ----------------------------------------------------------------------------
 * Ustrukturyzowane błędy API.
 *
 * Każdy błąd niesie: stabilny kod (do rozpoznania po stronie UI), etap, w którym
 * wystąpił, czytelny komunikat, podpowiedź „co zrobić”, status HTTP zwracany
 * klientowi oraz (jeśli dotyczy) szczegóły odpowiedzi Instagrama: URL, status,
 * nagłówki diagnostyczne, fragment treści i czas trwania.
 * -------------------------------------------------------------------------- */

const CODES = {
  BAD_REQUEST: {
    status: 400,
    message: "Nieprawidłowe zapytanie.",
    hint: "Sprawdź nazwę konta: dozwolone są litery, cyfry, kropka i podkreślenie (max 30 znaków).",
  },
  SESSION_MISSING: {
    status: 401,
    message: "Brak cookie sesji IG.",
    hint: "Wklej sessionid w ustawieniach sesji. Używaj konta pomocniczego, nie głównego.",
  },
  IG_NOT_FOUND: {
    status: 404,
    message: "Instagram nie zna takiego konta.",
    hint: "Konto mogło zostać usunięte, zmienić nazwę albo jest literówka w nazwie.",
  },
  IG_RATE_LIMITED: {
    status: 429,
    message: "Instagram ograniczył liczbę zapytań (rate limit).",
    hint: "Odczekaj kilka do kilkunastu minut. Zmiana sieci (np. hotspot) zwykle pomaga od razu.",
  },
  IG_LOGIN_REQUIRED: {
    status: 502,
    message: "Instagram zażądał logowania zamiast zwrócić dane.",
    hint: "IG blokuje anonimowe zapytania z tego adresu IP. Odczekaj, zmień sieć albo uzupełnij dane ręcznie.",
  },
  IG_FORBIDDEN: {
    status: 403,
    message: "Instagram odmówił dostępu.",
    hint: "Konto może być prywatne, a sesja nie ma do niego dostępu, albo IG zablokował zapytanie.",
  },
  IG_SESSION_INVALID: {
    status: 401,
    message: "Instagram odrzucił cookie sesji.",
    hint: "Cookie wygasło albo zostało unieważnione (wylogowanie, zmiana hasła). Pobierz nowy sessionid.",
  },
  IG_CHECKPOINT: {
    status: 403,
    message: "Instagram wymaga weryfikacji konta sesji (checkpoint).",
    hint: "Zaloguj się na to konto w przeglądarce i przejdź weryfikację. Do tego czasu sesja nie zadziała.",
  },
  IG_PRIVATE: {
    status: 403,
    message: "Profil jest prywatny.",
    hint: "Listy i treści prywatnych kont są dostępne tylko dla zaakceptowanych obserwujących.",
  },
  IG_BAD_RESPONSE: {
    status: 502,
    message: "Instagram zwrócił odpowiedź w nieoczekiwanym formacie.",
    hint: "IG mógł zmienić API. Zobacz fragment odpowiedzi poniżej; często pomaga ponowienie za chwilę.",
  },
  IG_HTTP_ERROR: {
    status: 502,
    message: "Instagram zwrócił błąd HTTP.",
    hint: "Błąd po stronie Instagrama. Spróbuj ponownie za chwilę.",
  },
  NETWORK_ERROR: {
    status: 502,
    message: "Brak połączenia z Instagramem.",
    hint: "Sprawdź internet, DNS, VPN lub firewall. Serwer nie mógł nawiązać połączenia z instagram.com.",
  },
  TIMEOUT: {
    status: 504,
    message: "Instagram nie odpowiedział w wyznaczonym czasie.",
    hint: "Połączenie jest wolne albo IG celowo opóźnia odpowiedzi. Spróbuj ponownie.",
  },
  IMAGE_BLOCKED: {
    status: 400,
    message: "Ten adres obrazka nie jest dozwolony.",
    hint: "Proxy obrazków obsługuje tylko CDN Instagrama (cdninstagram.com, fbcdn.net).",
  },
  INTERNAL: {
    status: 500,
    message: "Wewnętrzny błąd serwera.",
    hint: "To błąd aplikacji, nie Instagrama. Szczegóły techniczne są poniżej.",
  },
};

class ApiError extends Error {
  /**
   * @param {keyof CODES} code
   * @param {{ message?: string, hint?: string, stage?: string, upstream?: object, cause?: unknown, detail?: string }} [opts]
   */
  constructor(code, opts = {}) {
    const def = CODES[code] || CODES.INTERNAL;
    super(opts.message || def.message);
    this.code = CODES[code] ? code : "INTERNAL";
    this.status = def.status;
    this.hint = opts.hint || def.hint;
    this.stage = opts.stage || null;
    this.upstream = opts.upstream || null;
    this.detail = opts.detail || null;
    this.retryAfterMs = opts.retryAfterMs || null;
    if (opts.cause) this.cause = opts.cause;
  }

  toJSON() {
    return {
      code: this.code,
      status: this.status,
      message: this.message,
      hint: this.hint,
      stage: this.stage,
      detail: this.detail,
      upstream: this.upstream,
      retryAfterMs: this.retryAfterMs,
    };
  }
}

/** Zamienia dowolny wyjątek na ApiError (z zachowaniem przyczyny). */
function toApiError(e, stage) {
  if (e instanceof ApiError) {
    if (!e.stage && stage) e.stage = stage;
    return e;
  }
  const cause = e && e.cause;
  const name = (e && e.name) || "";
  const sysCode = (cause && cause.code) || (e && e.code) || "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new ApiError("TIMEOUT", { stage, detail: String(e.message || e) });
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|UND_ERR/.test(sysCode)
    || (name === "TypeError" && /fetch failed/i.test(String(e.message)))) {
    return new ApiError("NETWORK_ERROR", {
      stage,
      detail: `${sysCode || name}: ${(cause && cause.message) || e.message}`,
    });
  }
  return new ApiError("INTERNAL", {
    stage,
    detail: (e && e.stack) ? String(e.stack).split("\n").slice(0, 6).join("\n") : String(e),
  });
}

module.exports = { ApiError, CODES, toApiError };
