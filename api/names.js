"use strict";

/* ----------------------------------------------------------------------------
 * Heurystyka płci na podstawie imienia wyłuskanego z nazwy użytkownika / nazwy
 * wyświetlanej. To NIE jest demografia obserwujących — to zgadywanie płci osób
 * z próbki komentujących/lajkujących, obarczone błędem. Część trafia do
 * kategorii "nieokreślona".
 * -------------------------------------------------------------------------- */

// Listy najpopularniejszych imion (PL + międzynarodowe). Celowo zwięzłe —
// pokrywają najczęstsze przypadki, reszta ląduje jako "nieokreślona".
const FEMALE = new Set([
  // PL
  "anna", "maria", "katarzyna", "malgorzata", "agnieszka", "barbara", "ewa",
  "krystyna", "magdalena", "elzbieta", "joanna", "aleksandra", "zofia",
  "monika", "teresa", "danuta", "natalia", "halina", "beata", "marta",
  "dorota", "julia", "karolina", "grazyna", "jadwiga", "iwona", "paulina",
  "weronika", "wanda", "renata", "patrycja", "justyna", "sylwia", "jolanta",
  "urszula", "wiktoria", "oliwia", "zuzanna", "maja", "lena", "hanna",
  "amelia", "alicja", "gabriela", "antonina", "michalina", "nadia", "kinga",
  "klaudia", "izabela", "edyta", "marzena", "bozena", "ewelina", "dominika",
  "emilia", "liliana", "laura", "nikola", "roksana", "sandra", "angelika",
  "kamila", "aneta", "marcelina", "martyna", "wioletta", "milena", "olga",
  // międzynarodowe
  "emma", "olivia", "sophia", "isabella", "mia", "charlotte", "amelie",
  "ava", "ella", "grace", "chloe", "lucy", "sofia", "elena", "sara", "sarah",
  "laura", "lea", "marie", "anne", "julie", "lisa", "nicole", "jessica",
  "jennifer", "ashley", "emily", "megan", "rachel", "hannah", "victoria",
  "elizabeth", "samantha", "lauren", "kayla", "alex", "taylor", "jordan",
]);

const MALE = new Set([
  // PL
  "jan", "piotr", "andrzej", "krzysztof", "stanislaw", "tomasz", "pawel",
  "marcin", "michal", "marek", "grzegorz", "jerzy", "tadeusz", "adam",
  "lukasz", "zbigniew", "ryszard", "dariusz", "henryk", "mariusz", "kazimierz",
  "wojciech", "robert", "mateusz", "marian", "rafal", "jacek", "jozef",
  "jakub", "kamil", "maciej", "mieczyslaw", "edward", "dawid", "karol",
  "wieslaw", "janusz", "slawomir", "artur", "waldemar", "bartosz", "konrad",
  "aleksander", "witold", "antoni", "franciszek", "filip", "szymon", "wiktor",
  "igor", "oskar", "nikodem", "leon", "alan", "patryk", "sebastian", "damian",
  "przemyslaw", "norbert", "radoslaw", "hubert", "cezary", "dominik", "kacper",
  "borys", "bruno", "ignacy", "tymoteusz", "milosz",
  // międzynarodowe
  "john", "james", "robert", "david", "william", "richard", "thomas",
  "charles", "daniel", "matthew", "mark", "paul", "steven", "andrew",
  "joshua", "kevin", "brian", "george", "edward", "ronald", "max", "leo",
  "noah", "liam", "lucas", "henry", "jack", "oliver", "harry", "luca",
  "marco", "carlos", "juan", "jose", "luis", "pedro", "antonio", "ahmed",
  "ali", "omar", "chris", "mike", "nick", "tom", "ben", "sam",
]);

// Imiona dwuznaczne / zależne od pisowni — do "nieokreślona", żeby nie zgadywać.
const AMBIGUOUS = new Set([
  "alex", "sam", "jordan", "taylor", "casey", "jamie", "robin", "charlie",
  "nikola", "andrea", "simone", "noa",
]);

/**
 * Wyłuskuje kandydatów na imię z tekstu (username / nazwa wyświetlana).
 * Dzieli po separatorach i odrzuca krótkie / liczbowe tokeny.
 */
function tokens(raw) {
  return String(raw || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // zdejmij diakrytyki
    .replace(/[^a-z._\- ]/g, " ")
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
    if (FEMALE.has(t)) return { gender: "female", confidence: 0.9 };
    if (MALE.has(t)) return { gender: "male", confidence: 0.9 };
  }

  // Słaba przesłanka: polskie imiona żeńskie prawie zawsze kończą się na -a.
  // Bierzemy pod uwagę tylko pierwszy "ludzko wyglądający" token.
  for (const t of cands) {
    if (AMBIGUOUS.has(t)) continue;
    if (/^[a-z]{4,}a$/.test(t) && !MALE.has(t)) {
      return { gender: "female", confidence: 0.4 };
    }
  }

  return { gender: "unknown", confidence: 0 };
}

module.exports = { guessGender, tokens };
