// Uruchamianie jednym kliknięciem (Windows/macOS/Linux) — wołane przez start-*.
//
// Robi wszystko, czego wymaga świeża albo zaktualizowana kopia:
//   1. sprawdza wersję Node (Vite 8 wymaga ^20.19 albo >=22.12),
//   2. instaluje zależności, gdy ich brak albo zmienił się package.json/.npmrc,
//   3. buduje interfejs, gdy brak dist/ albo źródła zmieniły się od ostatniego
//      builda (np. po `git pull`) — inaczej serwowana byłaby stara wersja,
//   4. sprawdza port: gdy działa już ta sama wersja, tylko otwiera przeglądarkę;
//      gdy port zajmuje coś innego (np. stara wersja), startuje na wolnym porcie,
//   5. startuje serwer i otwiera przeglądarkę. Ctrl+C / zamknięcie okna kończy.
//
// Bez zależności npm — sam Node.

import { createHash } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath zamiast import.meta.dirname: działa też na starym Node, więc
// komunikat o zbyt starej wersji zdąży się wyświetlić.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const isWin = process.platform === "win32"
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const VERSION = pkg.version
const BASE_PORT = Number(process.env.PORT) || 8000

const c = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = c("1")
const dim = c("2")
const red = c("31")
const green = c("32")
const yellow = c("33")

function fail(msg, hint) {
  console.error("\n  " + red("[!] " + msg))
  if (hint) console.error("      " + hint)
  console.error("")
  process.exit(1)
}

/* ------------------------------- 1. Node --------------------------------- */
function checkNode() {
  const [maj, min] = process.versions.node.split(".").map(Number)
  const ok = (maj === 20 && min >= 19) || (maj === 22 && min >= 12) || maj >= 23
  if (!ok) {
    fail(
      `Za stara wersja Node.js (${process.version}). Potrzebna: 20.19+ albo 22.12+.`,
      "Zainstaluj aktualną wersję LTS z https://nodejs.org i uruchom ponownie."
    )
  }
}

/* ------------------------------ odciski --------------------------------- */
function hashFiles(files) {
  const h = createHash("sha1")
  for (const rel of files) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue
    h.update(rel.replaceAll("\\", "/") + "\0")
    h.update(fs.readFileSync(abs))
  }
  return h.digest("hex")
}

function walk(dir, out = []) {
  const abs = path.join(root, dir)
  if (!fs.existsSync(abs)) return out
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

const readStamp = (f) => {
  try {
    return fs.readFileSync(f, "utf8").trim()
  } catch {
    return ""
  }
}

/* -------------------------- 2. zależności npm --------------------------- */
function npm(args) {
  // shell na Windows: npm to npm.cmd (bez powłoki Node nie uruchomi .cmd).
  const r = spawnSync("npm", args, { cwd: root, stdio: "inherit", shell: isWin })
  if (r.error) fail("Nie udało się uruchomić npm.", String(r.error.message || r.error))
  return r.status === 0
}

function ensureDeps() {
  const stampFile = path.join(root, "node_modules", ".osint-install")
  const want = hashFiles(["package.json", ".npmrc"])
  const hasTools = fs.existsSync(path.join(root, "node_modules", "vite", "package.json"))
  if (hasTools && readStamp(stampFile) === want) return
  console.log(
    "  " + bold(hasTools ? "Zmieniły się zależności — aktualizuję (1–2 min)…" : "Pierwsze uruchomienie: instaluję zależności (1–2 min)…")
  )
  if (!npm(["install", "--ignore-scripts", "--no-audit", "--no-fund"])) {
    fail("Instalacja zależności nie powiodła się (szczegóły wyżej).", "Sprawdź internet i uruchom ponownie.")
  }
  fs.writeFileSync(stampFile, want)
}

/* ------------------------------ 3. build -------------------------------- */
function ensureBuild() {
  const sources = [
    ...walk("src"),
    ...walk("public"),
    "index.html",
    "vite.config.ts",
    "package.json",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "components.json",
  ].sort()
  const want = hashFiles(sources)
  const stampFile = path.join(root, "dist", ".osint-build")
  const built = fs.existsSync(path.join(root, "dist", "index.html"))
  if (built && readStamp(stampFile) === want) return
  console.log("  " + bold(built ? "Wykryto nową wersję — przebudowuję interfejs…" : "Buduję interfejs (pierwszy raz)…"))
  if (!npm(["run", "build"])) fail("Budowanie interfejsu nie powiodło się (szczegóły wyżej).")
  fs.writeFileSync(stampFile, want)
}

/* ------------------------------ 4. port --------------------------------- */
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once("error", () => resolve(false))
    s.once("listening", () => s.close(() => resolve(true)))
    s.listen(port, "127.0.0.1")
  })
}

async function runningVersion(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return null
    const j = await r.json()
    return j && j.ok ? String(j.version || "?") : null
  } catch {
    return null
  }
}

async function pickPort() {
  if (await portFree(BASE_PORT)) return { port: BASE_PORT }
  const v = await runningVersion(BASE_PORT)
  if (v === VERSION) return { port: BASE_PORT, alreadyRunning: true }
  console.log(
    "  " +
      yellow(
        v
          ? `Na porcie ${BASE_PORT} działa inna wersja OSINT-IG (${v}). Zamknij jej okno, żeby nie mylić wersji.`
          : `Port ${BASE_PORT} jest zajęty przez inny program.`
      )
  )
  for (let p = BASE_PORT + 1; p <= BASE_PORT + 20; p++) {
    if (await portFree(p)) return { port: p }
  }
  fail(`Brak wolnego portu w zakresie ${BASE_PORT}–${BASE_PORT + 20}.`)
}

/* --------------------------- 5. przeglądarka ---------------------------- */
function openBrowser(url) {
  const [cmd, args] = isWin
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]]
  const hint = () => console.log("  " + yellow(`Nie udało się otworzyć przeglądarki — wejdź ręcznie na ${url}`))
  try {
    const p = spawn(cmd, args, { stdio: "ignore", detached: true })
    // Błąd uruchomienia (np. brak xdg-open) przychodzi asynchronicznie jako
    // zdarzenie 'error' — bez obsługi wywróciłby cały launcher.
    p.on("error", hint)
    p.unref()
  } catch {
    hint()
  }
}

/* -------------------------------- start --------------------------------- */
async function main() {
  console.log("\n  " + bold(`OSINT-IG ${VERSION}`) + dim(`  ·  Node ${process.version}`) + "\n")
  checkNode()
  ensureDeps()
  ensureBuild()

  const { port, alreadyRunning } = await pickPort()
  const url = `http://localhost:${port}`
  if (alreadyRunning) {
    console.log("  " + green(`OSINT-IG ${VERSION} już działa — otwieram ${url}`) + "\n")
    openBrowser(url)
    return
  }

  console.log("  " + green(`Uruchamiam OSINT-IG na ${url}`))
  console.log("  " + dim("(zamknij to okno albo wciśnij Ctrl+C, aby zatrzymać program)") + "\n")
  const server = spawn(process.execPath, ["api/server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["inherit", "pipe", "inherit"],
  })
  let opened = false
  server.stdout.on("data", (b) => {
    process.stdout.write(b)
    if (!opened && String(b).includes("OSINT-IG READY")) {
      opened = true
      openBrowser(url)
    }
  })
  server.on("exit", (code) => process.exit(code ?? 0))
  const stop = () => server.kill()
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
}

main().catch((e) => fail("Nieoczekiwany błąd uruchamiania.", String(e?.stack || e)))
