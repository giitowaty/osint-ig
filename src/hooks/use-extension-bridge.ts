import { useEffect } from "react"

import { connectCookies } from "@/lib/actions"
import { apiBase } from "@/lib/runtime"
import { getState, navigate } from "@/lib/store"

/** Receive a session only after the user clicks Connect in the extension. */
export function useExtensionBridge() {
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const base = await apiBase()
        if (stopped) return
        const res = await fetch(`${base}/api/extension/pending`, {
          headers: { "x-osint-bridge": "1" }, signal: AbortSignal.timeout(5000),
        })
        if (!res.ok || stopped) return
        const { pending } = await res.json() as { pending: { id: string; text: string } | null }
        if (!pending || stopped) return
        navigate("session")
        let connected = false
        try {
          await connectCookies(pending.text)
          const session = getState().session
          connected = !!session.account && !!session.verifiedAt && !session.error
        } finally {
          await fetch(`${base}/api/extension/ack`, {
            method: "POST", signal: AbortSignal.timeout(5000),
            headers: { "x-osint-bridge": "1", "x-osint-transfer": pending.id,
              "x-osint-result": connected ? "connected" : "failed" },
          })
        }
      } catch {
        // Engine startup and restarts are retried without interrupting the UI.
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 1000)
      }
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [])
}
