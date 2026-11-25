"use strict";

/* ----------------------------------------------------------------------------
 * Identyfikatory nieoficjalnych zapytań Instagrama.
 *
 * Instagram co jakiś czas zmienia identyfikatory zapytań GraphQL (doc_id,
 * query_hash). Zamiast przebudowywać program, można je nadpisać plikiem JSON:
 *
 *   • ścieżka z OSINT_IG_QUERIES, albo
 *   • ~/.osint-ig/ig-queries.json   (Windows: C:\Users\<nazwa>\.osint-ig\…)
 *
 * Przykład pliku:  { "profilePosts": "1234567890123456" }
 * Brakujące klucze biorą wartości domyślne. Plik jest czytany przy każdym
 * zapytaniu — po zapisaniu zmiany restart nie jest potrzebny. Autotest (/api/selftest) mówi, które
 * zapytanie przestało działać i który klucz poprawić.
 * -------------------------------------------------------------------------- */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Klucze konfiguracji: domyślna wartość, format i do czego służy. */
const QUERY_KEYS = {
  appId: { value: "936619743392459", pattern: /^\d{6,20}$/, label: "x-ig-app-id (nagłówek aplikacji web)" },
  viewerQueryHash: { value: "d6f4427fbe92d846298cf93df0b937d3", pattern: /^[0-9a-f]{32}$/, label: "query_hash konta zalogowanej sesji (whoami)" },
  profilePageContent: { value: "28036671149327607", pattern: /^\d{6,25}$/, label: "doc_id PolarisProfilePageContentQuery (dane profilu z sesją)" },
  profilePosts: { value: "28542612348729311", pattern: /^\d{6,25}$/, label: "doc_id PolarisProfilePostsQuery (posty profilu z sesją)" },
};

const DEFAULTS = Object.fromEntries(Object.entries(QUERY_KEYS).map(([k, v]) => [k, v.value]));

function configPath() {
  return process.env.OSINT_IG_QUERIES || path.join(os.homedir(), ".osint-ig", "ig-queries.json");
}

/**
 * Bieżące identyfikatory. Zwraca `{ values, source, path, overrides, errors }`:
 * `source` = "default" | "file"; `errors` opisuje odrzucone wpisy pliku.
 */
function loadQueries() {
  const file = configPath();
  let st = null;
  try { st = fs.statSync(file); } catch { /* brak pliku = same wartości domyślne */ }
  if (!st) {
    return { values: { ...DEFAULTS }, source: "default", path: file, overrides: [], errors: [] };
  }
  // Plik ma kilkaset bajtów: czytamy go za każdym razem, więc zmiana działa od razu.
  const errors = [];
  const values = { ...DEFAULTS };
  const overrides = [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("plik musi zawierać obiekt JSON { \"klucz\": \"wartość\" }");
    for (const [key, val] of Object.entries(raw)) {
      const spec = QUERY_KEYS[key];
      if (!spec) { errors.push(`nieznany klucz „${key}” (dozwolone: ${Object.keys(QUERY_KEYS).join(", ")})`); continue; }
      const v = String(val).trim();
      if (!spec.pattern.test(v)) { errors.push(`„${key}”: niepoprawna wartość „${v.slice(0, 40)}”`); continue; }
      values[key] = v;
      if (v !== spec.value) overrides.push(key);
    }
  } catch (e) {
    errors.push(`nie da się odczytać pliku: ${e.message}`);
  }
  return { values, source: overrides.length ? "file" : "default", path: file, overrides, errors };
}

/** Pojedyncza wartość (z uwzględnieniem pliku nadpisań). */
const query = (key) => loadQueries().values[key];

module.exports = { QUERY_KEYS, DEFAULTS, loadQueries, query, configPath };
