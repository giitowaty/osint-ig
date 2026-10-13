// Buduje sidecar dla Tauri: serwer Node (api/) jako jeden plik wykonywalny.
//
//  1. esbuild łączy api/*.js + słownik imion w jeden CommonJS,
//  2. Node SEA (Single Executable Application) wkleja go do kopii node(.exe),
//  3. wynik trafia do src-tauri/binaries/osint-server-<target-triple>[.exe],
//     czyli tam, gdzie Tauri szuka `externalBin`.
//
// Wymaga tylko Node ≥ 20 i devDependencies (esbuild, postject).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { build } from "esbuild"

const root = path.resolve(import.meta.dirname, "..")
const out = path.join(root, "build", "sidecar")
const binDir = path.join(root, "src-tauri", "binaries")
fs.mkdirSync(out, { recursive: true })
fs.mkdirSync(binDir, { recursive: true })

const step = (msg) => console.log(`\x1b[36m›\x1b[0m ${msg}`)

function targetTriple() {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE
  try {
    const v = execFileSync("rustc", ["-vV"], { encoding: "utf8" })
    const m = v.match(/^host:\s*(\S+)/m)
    if (m) return m[1]
  } catch {
    /* brak rustc — zgadujemy niżej */
  }
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64"
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`
  if (process.platform === "darwin") return `${arch}-apple-darwin`
  return `${arch}-unknown-linux-gnu`
}

const triple = targetTriple()
const exe = process.platform === "win32" ? ".exe" : ""
const bundle = path.join(out, "server.cjs")
const blob = path.join(out, "sea-prep.blob")
const target = path.join(binDir, `osint-server-${triple}${exe}`)

step(`bundle api/ → ${path.relative(root, bundle)}`)
await build({
  entryPoints: [path.join(root, "scripts", "sidecar-entry.cjs")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: bundle,
  loader: { ".json": "json" },
  legalComments: "none",
  logLevel: "warning",
})

step("Node SEA: przygotowanie blobu")
const seaConfig = path.join(out, "sea-config.json")
fs.writeFileSync(
  seaConfig,
  JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false }, null, 2)
)
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" })

step(`kopiuję ${process.execPath} → ${path.relative(root, target)}`)
fs.rmSync(target, { force: true })
fs.copyFileSync(process.execPath, target)

if (process.platform === "darwin") {
  execFileSync("codesign", ["--remove-signature", target], { stdio: "inherit" })
}

step("postject: wstrzykuję blob")
const postject = path.join(root, "node_modules", "postject", "dist", "cli.js")
const args = [postject, target, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2", "--overwrite"]
if (process.platform === "darwin") args.push("--macho-segment-name", "NODE_SEA")
execFileSync(process.execPath, args, { stdio: "inherit" })

if (process.platform === "darwin") {
  execFileSync("codesign", ["--sign", "-", target], { stdio: "inherit" })
}

step("test: uruchamiam sidecar i pytam /api/health")
await smokeTest(target)
const mb = (fs.statSync(target).size / 1024 / 1024).toFixed(1)
console.log(`\x1b[32m✓\x1b[0m sidecar gotowy: ${path.relative(root, target)} (${mb} MB)`)

async function smokeTest(bin) {
  const { spawn } = await import("node:child_process")
  const port = 18000 + Math.floor(Math.random() * 1000)
  const child = spawn(bin, [], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] })
  let stderr = ""
  child.stderr.on("data", (b) => (stderr += b))
  try {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150))
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`)
        const j = await res.json()
        if (j.ok && j.sea) return
        throw new Error(`health bez flagi sea: ${JSON.stringify(j)}`)
      } catch (e) {
        if (i === 39) throw new Error(`sidecar nie odpowiedział: ${e.message}\n${stderr}`)
      }
    }
  } finally {
    child.kill()
  }
}
