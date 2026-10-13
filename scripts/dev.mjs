// Tryb deweloperski: serwer API (Node, :8000) + Vite (:5173, proxy /api → :8000).
// Jeden Ctrl+C zatrzymuje oba procesy.
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, "..")
const viteBin = path.join(path.dirname(require.resolve("vite/package.json", { paths: [root] })), "bin", "vite.js")

const procs = []
function run(name, args, env = {}) {
  const p = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["inherit", "pipe", "pipe"],
  })
  const tag = name === "api" ? "\x1b[36m[api]\x1b[0m " : "\x1b[35m[web]\x1b[0m "
  const pipe = (stream, out) =>
    stream.on("data", (b) => {
      for (const line of String(b).split(/\r?\n/)) if (line) out.write(tag + line + "\n")
    })
  pipe(p.stdout, process.stdout)
  pipe(p.stderr, process.stderr)
  p.on("exit", (code) => {
    console.log(`${tag}zakończony (kod ${code})`)
    shutdown(code ?? 0)
  })
  procs.push(p)
}

let stopping = false
function shutdown(code) {
  if (stopping) return
  stopping = true
  for (const p of procs) if (!p.killed) p.kill()
  setTimeout(() => process.exit(code), 200)
}
process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))

run("api", ["api/server.js"], { PORT: process.env.PORT || "8000" })
run("web", [viteBin, "--host", "127.0.0.1"])
