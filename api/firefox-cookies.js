"use strict";

/* ----------------------------------------------------------------------------
 * Odczyt ciasteczek Instagrama z lokalnego Firefoksa (jedno kliknięcie w UI).
 *
 * Firefox trzyma ciasteczka w NIEzaszyfrowanej bazie `cookies.sqlite` w profilu
 * użytkownika — więc backend (działa na tym samym komputerze) może je odczytać
 * i zwrócić frontowi gotowy nagłówek sesji, bez grzebania w F12.
 *
 * Zasady:
 *   • tylko ODCZYT; bazę kopiujemy do katalogu tymczasowego (Firefox ją blokuje),
 *     czytamy kopię i kasujemy ją po wszystkim;
 *   • bierzemy wyłącznie ciasteczka instagram.com z białej listy (jak w cookies.js);
 *   • NIGDY nie logujemy wartości sessionid — tylko fakt znalezienia konta.
 *
 * Bez zależności zewnętrznych: wbudowane `node:sqlite` (Node ≥ 22).
 * -------------------------------------------------------------------------- */

const fs = require("fs");
const os = require("os");
const path = require("path");

// Ciasteczka IG, które przepuszczamy (spójne z api/cookies.js ALLOWED).
const WANT = ["sessionid", "ds_user_id", "csrftoken", "mid", "ig_did", "rur", "datr"];

/** Katalogi, w których Firefox trzyma profile — zależnie od systemu i pakietu. */
function firefoxRoots() {
  const home = os.homedir();
  const roots = [];
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    roots.push(path.join(appdata, "Mozilla", "Firefox"));
  } else if (process.platform === "darwin") {
    roots.push(path.join(home, "Library", "Application Support", "Firefox"));
  } else {
    roots.push(path.join(home, ".mozilla", "firefox"));
    roots.push(path.join(home, "snap", "firefox", "common", ".mozilla", "firefox"));
    roots.push(path.join(home, ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox"));
  }
  return roots.filter((r) => safeExists(r));
}

function safeExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

/** Zbiera ścieżki do wszystkich `cookies.sqlite` (profile wprost i w Profiles/). */
function cookieDbs() {
  const out = [];
  for (const root of firefoxRoots()) {
    const dirs = [root, path.join(root, "Profiles")];
    for (const d of dirs) {
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const db = path.join(d, e.name, "cookies.sqlite");
        if (safeExists(db)) out.push({ profile: e.name, db });
      }
    }
  }
  return out;
}

/** Czyta ciasteczka IG z jednej bazy (kopia tymczasowa). Zwraca kandydata albo null. */
function readOne(profile, db) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require("node:sqlite")); }
  catch { throw new Error("node:sqlite niedostępne — wymagany Node 22+."); }

  const tmp = path.join(os.tmpdir(), `osint-ff-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`);
  try {
    fs.copyFileSync(db, tmp);
    // Firefox bywa w trybie WAL — dokopiuj -wal/-shm, jeśli są (inaczej braknie świeżych zapisów).
    for (const ext of ["-wal", "-shm"]) { try { if (fs.existsSync(db + ext)) fs.copyFileSync(db + ext, tmp + ext); } catch {} }

    const conn = new DatabaseSync(tmp, { readOnly: true });
    let rows = [];
    try {
      const q = conn.prepare(
        "SELECT name, value, host, lastAccessed FROM moz_cookies " +
        "WHERE host LIKE '%instagram.com' AND name IN (" + WANT.map(() => "?").join(",") + ")"
      );
      rows = q.all(...WANT);
    } finally { conn.close(); }

    // Dla każdej nazwy bierzemy wartość o najświeższym lastAccessed.
    const best = new Map();
    let newest = 0;
    for (const r of rows) {
      if (!r || !r.value) continue;
      const prev = best.get(r.name);
      if (!prev || (r.lastAccessed || 0) > (prev.lastAccessed || 0)) best.set(r.name, r);
      if ((r.lastAccessed || 0) > newest) newest = r.lastAccessed || 0;
    }
    if (!best.has("sessionid")) return null; // bez sessionid konto jest bezużyteczne

    const names = [];
    const parts = [];
    for (const n of WANT) {
      const r = best.get(n);
      if (r) { names.push(n); parts.push(`${n}=${r.value}`); }
    }
    return {
      profile,
      userId: best.get("ds_user_id")?.value || null,
      names,
      cookie: parts.join("; "),
      lastAccessed: newest, // mikrosekundy (epoch); do sortowania
    };
  } finally {
    for (const ext of ["", "-wal", "-shm"]) { try { fs.rmSync(tmp + ext, { force: true }); } catch {} }
  }
}

/**
 * Znajduje w Firefoksie wszystkie konta IG z aktywną sesją.
 * @returns {{ ok: boolean, candidates: Array<{profile,userId,names,cookie,lastAccessed}>, error?: string }}
 */
function readInstagramSessions() {
  const dbs = cookieDbs();
  if (!dbs.length) {
    return { ok: false, candidates: [], error: "Nie znaleziono profilu Firefoksa na tym komputerze." };
  }
  const candidates = [];
  let lastErr = null;
  for (const { profile, db } of dbs) {
    try {
      const c = readOne(profile, db);
      if (c) candidates.push(c);
    } catch (e) { lastErr = e; }
  }
  if (!candidates.length) {
    return {
      ok: false,
      candidates: [],
      error: lastErr
        ? lastErr.message
        : "W Firefoksie nie znaleziono zalogowanej sesji Instagrama. Zaloguj się na instagram.com w Firefoksie i spróbuj ponownie.",
    };
  }
  candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); // najświeższa pierwsza
  return { ok: true, candidates };
}

module.exports = { readInstagramSessions };
