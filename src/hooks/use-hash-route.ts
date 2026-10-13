import * as React from "react"

import { analyze } from "@/lib/actions"
import { getState, navigate, useStore, type View } from "@/lib/store"

const VIEWS: View[] = ["overview", "content", "audience", "network", "influence", "activity", "session", "tools", "compare"]

function parse(hash: string): { view: View; user: string | null } {
  const [, v, u] = hash.replace(/^#/, "").split("/")
  const view = (VIEWS as string[]).includes(v) ? (v as View) : "overview"
  return { view, user: u ? decodeURIComponent(u).toLowerCase() : null }
}

/** Synchronizuje widok i aktywny profil z adresem (#/widok/profil): działa wstecz/dalej i linkowanie. */
export function useHashRoute() {
  const view = useStore((s) => s.view)
  const active = useStore((s) => s.active)
  const hydrated = useStore((s) => s.hydrated)

  // Czekamy na przywrócenie sesji z IndexedDB: inaczej profil z adresu byłby pobierany ponownie.
  React.useEffect(() => {
    if (!hydrated) return
    const apply = () => {
      const { view, user } = parse(window.location.hash)
      if (user && !getState().profiles[user]) void analyze(user, { focus: false })
      navigate(view, user ?? getState().active)
    }
    apply()
    window.addEventListener("hashchange", apply)
    return () => window.removeEventListener("hashchange", apply)
  }, [hydrated])

  React.useEffect(() => {
    if (!hydrated) return
    const profileView = view === "overview" || view === "content" || view === "audience"
    const next = `#/${view}${profileView && active ? `/${encodeURIComponent(active)}` : ""}`
    if (window.location.hash !== next) window.history.pushState(null, "", next)
    document.title = profileView && active ? `@${active} · OSINT-IG` : "OSINT-IG"
  }, [view, active, hydrated])
}
