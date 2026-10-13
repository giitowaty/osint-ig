#!/usr/bin/env node
// ---------------------------------------------------------------------------
// OSINT-IG: kompilacja do aplikacji desktop (Tauri → .exe) + test end-to-end.
//
//   npm run build:exe                 pełny proces
//   npm run build:exe -- --skip-tests pomija testy jednostkowe
//   npm run build:exe -- --skip-build tylko test już zbudowanej aplikacji
//   npm run build:exe -- --offline    bez zapytania do Instagrama w teście SSE
//   npm run build:exe -- --no-ui      bez testu interfejsu (WebView2 przez CDP)
//
// Kroki: wymagania → testy i typecheck → sidecar (Node SEA) → tauri build →
// test zbudowanego .exe (silnik, API, CORS, SSE, interfejs, zamykanie) →
// release/ (instalatory, wersja przenośna, SHA256SUMS.txt, raport).
// ---------------------------------------------------------------------------
import { execFileSync, spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const args = new Set(process.argv.slice(2))
const opt = {
  skipTests: args.has("--skip-tests"),
  skipBuild: args.has("--skip-build"),
  offline: args.has("--offline"),
  noUi: args.has("--no-ui"),
}
const isWin = process.platform === "win32"
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const releaseDir = path.join(root, "release")
const results = []
const t0 = Date.now()

/* ------------------------------- Wyjście ---------------------------------- */

const c = (n) => (s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : s)
const cyan = c(36), green = c(32), red = c(31), yellow = c(33), dim = c(2), bold = c(1)
let stepNo = 0
function section(title) {
  stepNo++
  console.log(`\n${bold(cyan(`[${stepNo}] ${title}`))}`)
}
function pass(name, detail = "") {
  results.push({ ok: true, name, detail })
  console.log(`  ${green("✓")} ${name}${detail ? dim(` · ${detail}`) : ""}`)
}
function warn(name, detail = "") {
  results.push({ ok: true, warn: true, name, detail })
  console.log(`  ${yellow("!")} ${name}${detail ? dim(` · ${detail}`) : ""}`)
}
class Fail extends Error {}
function fail(name, detail = "") {
  results.push({ ok: false, name, detail })
  console.log(`  ${red("✗")} ${name}${detail ? `\n    ${red(detail)}` : ""}`)
  throw new Fail(name)
}
async function check(name, fn) {
  try {
    const detail = await fn()
    pass(name, typeof detail === "string" ? detail : "")
  } catch (e) {
    if (e instanceof Fail) throw e
    fail(name, e instanceof Error ? e.message : String(e))
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/* ------------------------------- Narzędzia -------------------------------- */

function run(cmd, cmdArgs, { env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { cwd: root, stdio: "inherit", shell: isWin, env: { ...process.env, ...env } })
    p.on("error", reject)
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${cmdArgs.join(" ")} → kod ${code}`))))
  })
}
const npm = (...a) => run(isWin ? "npm.cmd" : "npm", a)

function version(cmd, a = ["--version"]) {
  try {
    return execFileSync(cmd, a, { encoding: "utf8", shell: isWin, stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return null
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
    s.on("error", reject)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, timeoutMs, everyMs = 250) {
  const end = Date.now() + timeoutMs
  let last
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    await sleep(everyMs)
  }
  throw new Error(`przekroczono ${timeoutMs / 1000} s${last ? ` (${last.message})` : ""}`)
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
const mb = (file) => `${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`

/* --------------------------------- Kroki ---------------------------------- */

async function prerequisites() {
  section("Wymagania")
  await check("Node ≥ 20", () => {
    const major = Number(process.versions.node.split(".")[0])
    assert(major >= 20, `masz ${process.version}; zainstaluj Node LTS z https://nodejs.org`)
    return process.version
  })
  await check("Rust (cargo, rustc)", () => {
    const cargo = version("cargo")
    const rustc = version("rustc")
    assert(cargo && rustc, "brak Rust; zainstaluj przez https://rustup.rs i otwórz nowy terminal")
    return rustc
  })
  if (!fs.existsSync(path.join(root, "node_modules"))) {
    console.log(dim("  instaluję zależności npm (bez skryptów instalacyjnych)…"))
    await npm("install", "--ignore-scripts", "--no-audit", "--no-fund")
  }
  await check("Tauri CLI", () => {
    const v = version(isWin ? "npx.cmd" : "npx", ["tauri", "--version"])
    assert(v, "brak @tauri-apps/cli; uruchom npm install")
    return v
  })
  if (isWin) {
    await check("WebView2 Runtime", () => {
      const keys = [
        "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
      ]
      for (const k of keys) {
        const out = version("reg", ["query", k, "/v", "pv"])
        const m = out && out.match(/pv\s+REG_SZ\s+(\S+)/)
        if (m) return m[1]
      }
      throw new Error("nie znaleziono WebView2 (jest w Windows 11; na Windows 10: https://go.microsoft.com/fwlink/p/?LinkId=2124703)")
    })
  }
}

async function unitTests() {
  section("Testy i typecheck")
  await check("typecheck (tsc)", async () => {
    await npm("run", "typecheck")
  })
  await check("lint (eslint)", async () => {
    await npm("run", "lint")
  })
  await check("testy (backend + vitest)", async () => {
    await npm("test")
  })
}

async function build() {
  section("Budowanie: sidecar (Node SEA) + front + Tauri")
  await check("sidecar silnika", async () => {
    await npm("run", "build:sidecar")
  })
  await check("tauri build (release + instalatory)", async () => {
    await run(isWin ? "npx.cmd" : "npx", ["tauri", "build"])
  })
}

function locateArtifacts() {
  const rel = process.env.OSINT_ARTIFACT_DIR || path.join(root, "src-tauri", "target", "release")
  const exe = path.join(rel, isWin ? "osint-ig.exe" : "osint-ig")
  const sidecar = path.join(rel, isWin ? "osint-server.exe" : "osint-server")
  const bundleDir = path.join(rel, "bundle")
  const bundles = []
  if (fs.existsSync(bundleDir)) {
    for (const sub of fs.readdirSync(bundleDir)) {
      const d = path.join(bundleDir, sub)
      if (!fs.statSync(d).isDirectory()) continue
      for (const f of fs.readdirSync(d)) {
        if (f.includes(pkg.version) && /\.(exe|msi|dmg|deb|rpm|AppImage)$/.test(f)) bundles.push(path.join(d, f))
      }
    }
  }
  return { exe, sidecar, bundles }
}

async function smokeTest({ exe, sidecar }) {
  section("Test zbudowanej aplikacji")
  await check("pliki wykonywalne", () => {
    assert(fs.existsSync(exe), `brak ${path.relative(root, exe)}; zbuduj bez --skip-build`)
    assert(fs.existsSync(sidecar), `brak silnika ${path.relative(root, sidecar)} obok aplikacji`)
    return `${path.basename(exe)} ${mb(exe)} · ${path.basename(sidecar)} ${mb(sidecar)}`
  })

  const port = await freePort()
  const cdpPort = await freePort()
  const extensionPort = await freePort()
  const base = `http://127.0.0.1:${port}`
  const env = {
    ...process.env,
    OSINT_PORT: String(port),
    OSINT_EXTENSION_PORT: String(extensionPort),
    // Test sessions must never overwrite the user's desktop session.
    WEBVIEW2_USER_DATA_FOLDER: fs.mkdtempSync(path.join(root, "build", "test-webview-")),
    // WebView2: włącza protokół debugowania, żeby test mógł zajrzeć do UI.
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
  }
  const app = spawn(exe, [], { env, stdio: "ignore" })
  let appExited = false
  app.on("exit", () => (appExited = true))

  try {
    await check("silnik startuje razem z aplikacją", async () => {
      const t = Date.now()
      const h = await waitFor(async () => {
        assert(!appExited, "aplikacja zakończyła się przed startem silnika")
        const r = await fetch(`${base}/api/health`)
        return r.ok && (await r.json())
      }, 25000)
      assert(h.version === pkg.version, `silnik w wersji ${h.version}, oczekiwano ${pkg.version} (stary sidecar?)`)
      assert(h.sea === true, "silnik nie działa jako pojedynczy plik (SEA)")
      assert(h.host === "127.0.0.1", `silnik słucha na ${h.host}, a powinien tylko na 127.0.0.1`)
      return `v${h.version} · ${h.platform} · gotowy po ${Date.now() - t} ms`
    })

    await check("API: walidacja nazwy konta (400 BAD_REQUEST)", async () => {
      const r = await fetch(`${base}/api/profile?username=${encodeURIComponent("zła nazwa")}`)
      const j = await r.json()
      assert(r.status === 400 && j.error?.code === "BAD_REQUEST", `HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`)
      assert(j.error.hint, "błąd bez podpowiedzi")
    })
    await check("API: proxy obrazków blokuje obce hosty", async () => {
      const r = await fetch(`${base}/api/img?url=${encodeURIComponent("https://example.com/x.png")}`)
      const j = await r.json()
      assert(r.status === 400 && j.error?.code === "IMAGE_BLOCKED", `HTTP ${r.status}`)
    })
    await check("API: nieznany endpoint (404 z opisem)", async () => {
      const r = await fetch(`${base}/api/nie-ma-takiego`)
      const j = await r.json()
      assert(r.status === 404 && j.error?.hint, `HTTP ${r.status}`)
    })
    await check("CORS: wpuszcza okno Tauri, odrzuca obce strony", async () => {
      const ok = await fetch(`${base}/api/health`, { headers: { Origin: "http://tauri.localhost" } })
      assert(ok.headers.get("access-control-allow-origin") === "http://tauri.localhost", "brak CORS dla http://tauri.localhost")
      const bad = await fetch(`${base}/api/health`, { headers: { Origin: "https://evil.example" } })
      assert(!bad.headers.get("access-control-allow-origin"), "obca strona dostała nagłówek CORS")
    })

    if (opt.offline) {
      warn("SSE z Instagramem pominięte (--offline)")
    } else {
      await check("SSE: strumień kroków na żywo (prawdziwe zapytanie do IG)", async () => {
        const r = await fetch(`${base}/api/profile?username=instagram&stream=1`, { signal: AbortSignal.timeout(30000) })
        assert((r.headers.get("content-type") || "").includes("text/event-stream"), "odpowiedź nie jest strumieniem SSE")
        const text = await r.text()
        const events = [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1])
        assert(events[0] === "start", "brak zdarzenia start")
        assert(events.includes("trace"), "brak kroków (trace)")
        const end = events.find((e) => e === "result" || e === "error")
        assert(end, "strumień bez wyniku i bez błędu")
        if (end === "error") {
          const err = JSON.parse(text.split("event: error\ndata: ")[1].split("\n")[0])
          return `strumień OK, ${events.length} zdarzeń; IG odpowiedział błędem ${err.code} (to stan Instagrama, nie aplikacji)`
        }
        return `strumień OK, ${events.length} zdarzeń, profil pobrany`
      })
    }

    if (opt.noUi) warn("test interfejsu pominięty (--no-ui)")
    else if (!isWin) warn("test interfejsu przez CDP działa tylko z WebView2 (Windows)")
    else await uiTest(cdpPort, port, extensionPort)
  } finally {
    section("Zamykanie")
    await check("aplikacja się zamyka", async () => {
      if (!appExited) app.kill()
      await waitFor(() => appExited, 8000)
    })
    await check("silnik kończy się razem z aplikacją (brak procesów-sierot)", async () => {
      await waitFor(async () => {
        try {
          await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })
          return false
        } catch {
          return true
        }
      }, 8000)
    })
  }
}

async function uiTest(cdpPort, port, extensionPort) {
  let chromium
  try {
    ;({ chromium } = await import("playwright-core"))
  } catch {
    warn("test interfejsu pominięty", "brak playwright-core (npm install)")
    return
  }
  const browser = await check("WebView2: połączenie przez CDP", async () => {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok, 20000)
  }).then(() => chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`))

  try {
    const page = await waitFor(() => browser.contexts().flatMap((c) => c.pages()).find((p) => /tauri\.localhost|^tauri:/.test(p.url())), 15000)
    const errors = []
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
    page.on("pageerror", (e) => errors.push(e.message))

    await check("interfejs się renderuje", async () => {
      await page.getByText("Który profil prześwietlamy?").waitFor({ timeout: 15000 })
      return page.url()
    })
    await check("UI rozmawia z silnikiem (api_base + health)", async () => {
      const apiBase = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("api_base"))
      assert(apiBase === `http://127.0.0.1:${port}`, `api_base = ${apiBase}`)
      await page.getByText(/Silnik · \d+ ms/).waitFor({ timeout: 15000 })
      return apiBase
    })
    await check("walidacja w formularzu", async () => {
      const input = page.getByLabel("Profil do analizy").first()
      await input.fill("zła nazwa!")
      await input.press("Enter")
      await page.getByText(/Nazwa konta może zawierać tylko/).first().waitFor({ timeout: 5000 })
    })
    await check("nawigacja: graf powiązań", async () => {
      await page.getByRole("button", { name: "Graf powiązań" }).first().click()
      await page.getByText("Graf jest pusty").waitFor({ timeout: 5000 })
    })
    await check("nawigacja: aktywność i log silnika", async () => {
      await page.getByRole("button", { name: "Aktywność" }).first().click()
      await page.getByText("Silnik działa").waitFor({ timeout: 5000 })
      await page.getByText(/Uruchamiam silnik na 127\.0\.0\.1/).first().waitFor({ timeout: 5000 })
      return "log silnika (sidecar) dociera do UI"
    })
    await check("paleta poleceń (Ctrl K)", async () => {
      await page.keyboard.press("Control+k")
      await page.getByPlaceholder(/Wpisz @nazwę/).waitFor({ timeout: 5000 })
      await page.keyboard.press("Escape")
    })
    await check("rozszerzenie → silnik → UI → potwierdzenie (sesja testowa)", async () => {
      const cookie = "123%3Asynthetic";
      const whoPath = `http://127.0.0.1:${port}/api/whoami*`;
      let receivedCookie = false;
      await page.route(whoPath, async (route) => {
        receivedCookie = route.request().headers()["x-ig-cookies"]?.includes(cookie);
        await route.fulfill({ status: 200, contentType: "text/event-stream",
          headers: { "Access-Control-Allow-Origin": route.request().headers().origin || "http://tauri.localhost" },
          body: `event: result\ndata: ${JSON.stringify({ username: "osint_test", userId: "123", cookies: ["sessionid"] })}\n\n` });
      });
      try {
        const headers = { "x-osint-bridge": "1", "x-osint-extension": "a".repeat(32) };
        const text = "OSINTIG1:" + Buffer.from(JSON.stringify({ cookies: [
          { name: "sessionid", value: cookie, domain: ".instagram.com" },
        ] })).toString("base64url");
        const transfer = await waitFor(async () => {
          const r = await fetch(`http://127.0.0.1:${extensionPort}/api/extension/connect`, { method: "POST", headers, body: text });
          return r.ok ? r.json() : null;
        }, 10000);
        await page.getByText("@osint_test", { exact: true }).first().waitFor({ timeout: 15000 });
        await waitFor(async () => {
          const r = await fetch(`http://127.0.0.1:${extensionPort}/api/extension/status`, {
            headers: { ...headers, "x-osint-transfer": transfer.id },
          });
          return (await r.json()).state === "connected";
        }, 10000);
        assert(receivedCookie, "UI nie przekazało sesji do weryfikacji");
        await page.getByRole("button", { name: "Odłącz i usuń", exact: true }).click();
        return "automatyczny odbiór i weryfikacja w UI; odpowiedź Instagrama symulowana";
      } finally {
        await page.unroute(whoPath);
      }
    });
    fs.mkdirSync(releaseDir, { recursive: true })
    const shot = path.join(releaseDir, "test-ui.png")
    await page.screenshot({ path: shot })
    pass("zrzut ekranu interfejsu", path.relative(root, shot))
    await check("brak błędów w konsoli", () => {
      assert(!errors.length, errors.slice(0, 3).join(" | "))
    })
  } finally {
    await browser.close().catch(() => {})
  }
}

function collect({ exe, sidecar, bundles }) {
  section("Pakowanie do release/")
  fs.mkdirSync(releaseDir, { recursive: true })
  const sums = []
  for (const b of bundles) {
    const dst = path.join(releaseDir, path.basename(b))
    fs.copyFileSync(b, dst)
    sums.push(`${sha256(dst)}  ${path.basename(dst)}`)
    pass(`instalator ${path.basename(dst)}`, mb(dst))
  }
  // Wersja przenośna: aplikacja + silnik obok siebie (bez instalacji).
  // Never delete a previous release: the user may still be running its engine.
  const portable = path.join(releaseDir, `OSINT-IG-${pkg.version}-portable-${new Date().toISOString().replace(/[:.]/g, "-")}`)
  fs.mkdirSync(portable, { recursive: true })
  for (const f of [exe, sidecar]) {
    const dst = path.join(portable, path.basename(f))
    fs.copyFileSync(f, dst)
    sums.push(`${sha256(dst)}  ${path.basename(portable)}/${path.basename(dst)}`)
  }
  pass("wersja przenośna", path.relative(root, portable))
  fs.writeFileSync(path.join(releaseDir, "SHA256SUMS.txt"), sums.join("\n") + "\n")
  pass("sumy kontrolne", "release/SHA256SUMS.txt")
}

function report(ok) {
  const lines = [
    `# OSINT-IG ${pkg.version}: raport budowania`,
    "",
    `- data: ${new Date().toISOString()}`,
    `- platforma: ${process.platform}-${process.arch}, node ${process.version}`,
    `- czas: ${((Date.now() - t0) / 1000).toFixed(0)} s`,
    `- wynik: ${ok ? "OK" : "BŁĄD"}`,
    "",
    "| | Krok | Szczegóły |",
    "|---|---|---|",
    ...results.map((r) => `| ${r.ok ? (r.warn ? "!" : "✓") : "✗"} | ${r.name} | ${(r.detail || "").replace(/\|/g, "/").replace(/\n/g, " ")} |`),
  ]
  fs.mkdirSync(releaseDir, { recursive: true })
  fs.writeFileSync(path.join(releaseDir, "RAPORT.md"), lines.join("\n") + "\n")
}

/* --------------------------------- Start ---------------------------------- */

let ok = false
try {
  console.log(bold(`OSINT-IG ${pkg.version} → aplikacja desktop`))
  await prerequisites()
  if (!opt.skipTests && !opt.skipBuild) await unitTests()
  if (!opt.skipBuild) await build()
  const art = locateArtifacts()
  await smokeTest(art)
  if (!opt.skipBuild) collect(art)
  ok = true
} catch (e) {
  if (!(e instanceof Fail)) {
    results.push({ ok: false, name: "nieoczekiwany błąd", detail: e instanceof Error ? e.stack : String(e) })
    console.error(red(e instanceof Error ? e.stack : String(e)))
  }
} finally {
  report(ok)
  const failed = results.filter((r) => !r.ok).length
  const warned = results.filter((r) => r.warn).length
  console.log(
    `\n${ok ? green(bold("✓ GOTOWE")) : red(bold("✗ BŁĄD"))} · ${results.length - failed} ok, ${failed} błędów, ${warned} ostrzeżeń · ${((Date.now() - t0) / 1000).toFixed(0)} s`
  )
  console.log(dim(`raport: ${path.relative(root, path.join(releaseDir, "RAPORT.md"))}`))
  process.exit(ok ? 0 : 1)
}
