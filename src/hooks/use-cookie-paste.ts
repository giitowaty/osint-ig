import * as React from "react"
import { toast } from "sonner"

import { connectCookies } from "@/lib/actions"
import { CookieParseError, looksLikeIgCookies, parseCookieInput } from "@/lib/cookies"
import { navigate } from "@/lib/store"

/**
 * Ctrl+V w dowolnym miejscu aplikacji: jeśli schowek zawiera ciasteczka IG
 * (paczkę z rozszerzenia, JSON, cookies.txt, nagłówek), proponujemy połączenie.
 * Pola tekstowe działają normalnie (wklejenie tam nie jest przechwytywane).
 */
export function useCookiePaste() {
  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.closest("input, textarea, [contenteditable=true]") || t.isContentEditable)) return
      const text = e.clipboardData?.getData("text") ?? ""
      if (!looksLikeIgCookies(text)) return
      e.preventDefault()
      try {
        const b = parseCookieInput(text)
        const n = Object.keys(b.cookies).length
        toast("Wykryto ciasteczka Instagrama", {
          description: `${n} ciasteczek${b.account ? ` konta @${b.account}` : ""}. Połączyć z aplikacją?`,
          duration: 15000,
          action: {
            label: "Połącz",
            onClick: () => {
              navigate("session")
              void connectCookies(b)
            },
          },
        })
      } catch (err) {
        toast.error("Nie udało się odczytać ciasteczek", {
          description: err instanceof CookieParseError ? err.message : String(err),
        })
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [])
}
