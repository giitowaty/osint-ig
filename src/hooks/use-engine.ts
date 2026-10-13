import * as React from "react"

import { checkHealth } from "@/lib/actions"
import { isTauri } from "@/lib/runtime"
import { getState, log } from "@/lib/store"

/**
 * Łączy UI z silnikiem: cykliczny health-check serwera, a w Tauri także
 * strumień linii logu sidecara (stdout/stderr) do panelu Aktywność.
 */
let announced = false

export function useEngineBridge() {
  React.useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const loop = async () => {
      await checkHealth(getState().health.status === "ok")
      if (!alive) return
      // Szybciej, dopóki serwer nie wstanie (sidecar potrzebuje chwili na start).
      timer = setTimeout(loop, getState().health.status === "ok" ? 15000 : 1500)
    }
    if (!announced) {
      announced = true
      log("info", "app", `Start aplikacji (${isTauri ? "desktop / Tauri" : "web"})`)
    }
    void loop()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  React.useEffect(() => {
    if (!isTauri) return
    let unlisten: (() => void) | undefined
    let cancelled = false
    type EngineLog = { seq: number; stream: "stdout" | "stderr" | "status"; line: string }
    let lastSeq = 0
    const take = ({ seq, stream, line }: EngineLog) => {
      if (seq <= lastSeq || !line.trim()) return
      lastSeq = seq
      const level = stream === "stderr" ? "error" : stream === "status" ? "info" : "debug"
      log(level, "engine", line.replace(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/, ""))
    }
    void (async () => {
      const [{ listen }, { invoke }] = await Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core")])
      // Najpierw nasłuch, potem historia: nic nie zginie między jednym a drugim (seq odsiewa duplikaty).
      const pending: EngineLog[] = []
      let ready = false
      const fn = await listen<EngineLog>("engine-log", (ev) => (ready ? take(ev.payload) : pending.push(ev.payload)))
      if (cancelled) return fn()
      unlisten = fn
      for (const e of await invoke<EngineLog[]>("engine_logs")) take(e)
      ready = true
      for (const e of pending) take(e)
    })()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
}
