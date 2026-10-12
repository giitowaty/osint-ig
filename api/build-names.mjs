// Generator słownika imię → płeć (api/names-data.json) z otwartych zbiorów.
//
// Uruchomienie (wymaga devDependencies — patrz package.json):
//   npm install && npm run build:names
//
// Decyzja o płci przez głosowanie: każde źródło daje głos F/M, wygrywa
// większość; remis (imię faktycznie uniseks) -> pomijane (w runtime wyjdzie
// "nieokreślona"). Runtime (api/names.js) ładuje tylko wynikowy JSON, bez
// żadnych zależności.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUT = path.join(__dirname, "names-data.json");

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ł/g, "l") // ł nie rozkłada się przez NFD
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
}

const votes = new Map(); // name -> { f, m }
function vote(name, gender, w = 1) {
  const k = norm(name);
  if (k.length < 2) return;
  if (!votes.has(k)) votes.set(k, { f: 0, m: 0 });
  votes.get(k)[gender === "female" ? "f" : "m"] += w;
}

const stats = {};
function addList(arr, gender, label, w = 1) {
  for (const name of arr) vote(name, gender, w);
  stats[label] = arr.length;
}

// 1) gender-detection (lowercase, z diakrytykami) — ~19k + 19k, wiele języków
const gdM = require("gender-detection/genders/male");
const gdF = require("gender-detection/genders/female");
addList(Object.keys(gdM), "male", "gender-detection:male");
addList(Object.keys(gdF), "female", "gender-detection:female");

// 2) human-names (EN/IT/FR/DE/ES/NL)
const hn = require("human-names");
for (const k of Object.keys(hn)) {
  if (!Array.isArray(hn[k])) continue;
  if (/^female/.test(k)) addList(hn[k], "female", "human-names:" + k);
  else if (/^male/.test(k)) addList(hn[k], "male", "human-names:" + k);
}

// 3) @stdlib English (SSA)
addList(require("@stdlib/datasets-male-first-names-en")(), "male", "stdlib:male");
addList(require("@stdlib/datasets-female-first-names-en")(), "female", "stdlib:female");

// 4) imieniny — polskie imiona z kalendarza imienin + heurystyka płci PL (waga 2)
const MALE_A = new Set([
  "kuba", "bonawentura", "barnaba", "kosma", "jarema", "dyzma", "sawa", "saba",
  "juda", "nikita", "kostka", "zawisza",
]);
const FEMALE_NON_A = new Set([
  "noemi", "ruth", "rut", "beatrycze", "karmen", "ingrid", "miriam",
  "sulamita", "mercedes", "ester", "rachel", "dolores", "nikol",
]);
const imiona = require("imieniny/lib/imiona.js"); // [miesiąc][dzień] => [imiona]
const plNames = new Set();
for (const month of imiona) for (const day of month) for (const nm of day) plNames.add(nm);
let plVotes = 0;
for (const nm of plNames) {
  const k = norm(nm);
  if (k.length < 2) continue;
  let g;
  if (MALE_A.has(k)) g = "male";
  else if (FEMALE_NON_A.has(k)) g = "female";
  else if (k.endsWith("a")) g = "female";
  else g = "male";
  vote(nm, g, 2);
  plVotes++;
}
stats["imieniny:pl"] = plVotes;

// 5) Kuratorski suplement PL: popularne imiona i zdrobnienia używane w nazwach
// użytkowników (waga 3 — rozstrzyga kolizje z innymi lokalizacjami).
const PL_MALE = "kuba krzysiek krzysztof michal michał mateusz bartek bartosz tomek tomasz marek darek dariusz staszek stas wojtek wojciech grzesiek grzegorz piotrek piotr pawel paweł lukasz łukasz maciek maciej rafal rafał jacek janek jan adas adam kamil karol filip szymon sebastian damian norbert hubert kacper oskar igor leon antek franek nikodem alan patryk przemek przemysław radek radoslaw slawek sławomir zbyszek zbigniew mietek heniek wladek władysław olek aleksander bonawentura barnaba kosma dyzma jarema sawa saba juda nikita kostek".split(/\s+/);
const PL_FEMALE = "kasia katarzyna gosia malgorzata małgorzata ola aleksandra magda magdalena ela elzbieta elżbieta asia joanna aga agnieszka natalia karolina ania anna basia barbara zosia zofia kinga paulina patrycja justyna sylwia monika marta dorota beata renata iwona dominika weronika wiktoria oliwia maja lena zuzia zuzanna hania hanna amelia alicja gabrysia gabriela nina julia julka emilia klaudia sandra sara nikola roksana martyna wioletta milena edyta marzena bozena bożena ewelina sabina kamila aneta".split(/\s+/);
for (const n of PL_MALE) vote(n, "male", 3);
for (const n of PL_FEMALE) vote(n, "female", 3);
stats["pl-supplement"] = PL_MALE.length + PL_FEMALE.length;

// 6) Oficjalny rejestr PESEL (osoby żyjące, stan 2021-02-04) — źródło
// autorytatywne (waga 5). Pliki: api/data/pesel/imiona_{meskie,zenskie}.csv
// Format: IMIĘ_PIERWSZE,PŁEĆ,LICZBA_WYSTĄPIEŃ. Odcinamy rzadkie (szum/literówki).
const PESEL_MIN = 5;   // minimalna liczba żyjących osób o danym imieniu
const PESEL_W = 5;     // waga głosu PESEL
const peselF = new Map(), peselM = new Map();
function loadPesel(file, bucket) {
  const p = path.join(__dirname, "data", "pesel", file);
  if (!fs.existsSync(p)) { console.warn("Pominięto PESEL (brak pliku):", file); return 0; }
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  let n = 0;
  for (let i = 1; i < lines.length; i++) { // [0] = nagłówek
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(",");
    const k = norm(cols[0]);
    const count = parseInt(cols[2], 10) || 0;
    if (k.length < 2 || count < PESEL_MIN) continue;
    bucket.set(k, (bucket.get(k) || 0) + count);
    n++;
  }
  return n;
}
stats["pesel:female"] = loadPesel("imiona_zenskie.csv", peselF);
stats["pesel:male"] = loadPesel("imiona_meskie.csv", peselM);
let peselUnisex = 0;
for (const k of new Set([...peselF.keys(), ...peselM.keys()])) {
  const f = peselF.get(k) || 0, m = peselM.get(k) || 0;
  if (f > 0 && m > 0) {
    // imię uniseks w PESEL: przypisz płeć o wyraźnej przewadze (≥2×), inaczej pomiń
    if (f >= m * 2) vote(k, "female", PESEL_W);
    else if (m >= f * 2) vote(k, "male", PESEL_W);
    else peselUnisex++;
  } else if (f > 0) vote(k, "female", PESEL_W);
  else vote(k, "male", PESEL_W);
}
stats["pesel:unisex-pominięte"] = peselUnisex;

// --- decyzja ---
const female = [], male = [];
let ambiguous = 0;
for (const [name, v] of votes) {
  if (v.f > v.m) female.push(name);
  else if (v.m > v.f) male.push(name);
  else ambiguous++;
}
female.sort();
male.sort();

const out = {
  _meta: {
    generated: new Date().toISOString().slice(0, 10),
    sources: stats,
    counts: { female: female.length, male: male.length, ambiguous },
    note: "Wygenerowane przez api/build-names.mjs z otwartych zbiorów. Płeć rozstrzygana głosowaniem; remisy (uniseks) pominięte.",
  },
  female,
  male,
};

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`Zapisano ${OUT}`);
console.log(`female: ${female.length}, male: ${male.length}, pominięte(uniseks): ${ambiguous}`);
