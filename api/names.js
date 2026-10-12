"use strict";

/* ----------------------------------------------------------------------------
 * Heurystyka płci na podstawie imienia wyłuskanego z nazwy użytkownika / nazwy
 * wyświetlanej. NIE jest to demografia obserwujących — to zgadywanie płci osób
 * z próbki komentujących/lajkujących, obarczone błędem.
 *
 * Słownik imion (names-data.json) jest generowany z otwartych zbiorów skryptem
 * api/build-names.mjs (gender-detection, human-names, @stdlib, imieniny).
 * -------------------------------------------------------------------------- */

const data = require("./names-data.json");

const FEMALE = new Set(data.female);
const MALE = new Set(data.male);

// Imiona uniseks — wymuszamy "unknown", nawet jeśli zbiór przechyla się w stronę
// jednej płci.
const AMBIGUOUS = new Set([
  "alex", "sam", "jordan", "taylor", "casey", "jamie", "robin", "charlie",
  "andrea", "simone", "noa", "sasha", "jessie", "dominique", "kim",
]);

/** Normalizacja identyczna jak w build-names.mjs (ł nie rozkłada się przez NFD). */
function normChar(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z._\- ]/g, " ");
}

/** Wyłuskuje kandydatów na imię z tekstu (username / nazwa wyświetlana). */
function tokens(raw) {
  return normChar(raw)
    .split(/[._\-\s]+/)
    .filter((t) => t.length >= 3);
}

/**
 * Zgaduje płeć. Zwraca { gender: 'female'|'male'|'unknown', confidence: 0..1 }.
 * Kolejność: słownik → (dla PL) końcówka -a jako słaba przesłanka żeńska.
 */
function guessGender(displayName, username) {
  const cands = [...tokens(displayName), ...tokens(username)];

  for (const t of cands) {
    if (AMBIGUOUS.has(t)) continue;
    const f = FEMALE.has(t), m = MALE.has(t);
    if (f && !m) return { gender: "female", confidence: 0.9 };
    if (m && !f) return { gender: "male", confidence: 0.9 };
  }

  // Słaba przesłanka: polskie imiona żeńskie prawie zawsze kończą się na -a.
  for (const t of cands) {
    if (AMBIGUOUS.has(t) || MALE.has(t)) continue;
    if (/^[a-z]{4,}a$/.test(t)) return { gender: "female", confidence: 0.4 };
  }

  return { gender: "unknown", confidence: 0 };
}

module.exports = { guessGender, tokens, FEMALE, MALE };
