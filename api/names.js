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

// Słowa częste w nazwach kont IG, które w międzynarodowych zbiorach imion
// występują jako imiona („kawa”, „foto”…), a w nazwie konta prawie nigdy nimi
// nie są. Bez tej listy „Studio Foto” wychodziło „mężczyzna 90%”.
// Zapis po normalizacji (bez polskich znaków).
const NOT_NAMES = new Set([
  "kawa", "kawka", "kawusia", "coffee", "cafe", "kawiarnia", "foto", "fotografia", "photo", "photography", "studio",
  "sklep", "shop", "store", "butik", "boutique", "design", "official", "oficjalny", "travel", "podroze", "food",
  "jedzenie", "art", "sztuka", "music", "muzyka", "pizza", "pizzeria", "moda", "fashion", "beauty", "uroda",
  "fitness", "sport", "life", "love", "world", "team", "club", "klub", "bar", "restauracja", "salon", "hair",
  "nails", "makeup", "blog", "vlog", "polska", "poland", "warszawa", "krakow", "gdansk", "wroclaw", "poznan",
  "lodz", "media", "news", "radio", "film", "kino", "gaming", "auto", "moto", "home", "garden", "ogrod", "mama",
  "tata", "baby", "kids", "dzieci", "natura", "nature", "flowers", "kwiaty", "yoga", "joga", "zdrowie", "health",
  "ksiazki", "books", "beer", "piwo", "wino", "wine", "tattoo", "tatuaz", "the", "and", "official",
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
  const fromName = tokens(displayName).filter((t) => !NOT_NAMES.has(t));
  const fromUser = tokens(username).filter((t) => !NOT_NAMES.has(t));
  const cands = [...fromName, ...fromUser];

  for (const t of cands) {
    if (AMBIGUOUS.has(t)) continue;
    const f = FEMALE.has(t), m = MALE.has(t);
    if (f && !m) return { gender: "female", confidence: 0.9 };
    if (m && !f) return { gender: "male", confidence: 0.9 };
  }

  // Słaba przesłanka: polskie imiona żeńskie prawie zawsze kończą się na -a.
  // Tylko dla pierwszego słowa (tam zwykle stoi imię) — inaczej łapie zwykłe
  // słowa w rodzaju „pizza” czy „kawa”.
  const first = tokens(displayName)[0] ?? tokens(username)[0];
  if (first && !NOT_NAMES.has(first) && !AMBIGUOUS.has(first) && !MALE.has(first) && /^[a-z]{4,}a$/.test(first)) {
    return { gender: "female", confidence: 0.4 };
  }

  return { gender: "unknown", confidence: 0 };
}

module.exports = { guessGender, tokens, FEMALE, MALE };
