/* ----------------------------------------------------------------------------
 * Środowisko uruchomienia: przeglądarka (web) albo powłoka Tauri (desktop).
 *
 * W web front i API są pod tym samym adresem (Vite proxy w dev, serwer Node w
 * produkcji), więc baza API to "". W Tauri API to lokalny sidecar Node na
 * losowym porcie; adres podaje komenda Rust `api_base`.
 * -------------------------------------------------------------------------- */

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

let basePromise: Promise<string> | null = null

export function apiBase(): Promise<string> {
  if (!basePromise) {
    basePromise = (async () => {
      if (!isTauri) return ""
      const { invoke } = await import("@tauri-apps/api/core")
      return invoke<string>("api_base")
    })()
    // Błąd nie może zostać zapamiętany na zawsze — pozwól ponowić.
    basePromise.catch(() => {
      basePromise = null
    })
  }
  return basePromise
}

/** URL miniatury przez proxy backendu (CDN IG blokuje osadzanie przez CORP). */
export function imageUrl(base: string, src: string): string {
  if (!src) return ""
  return `${base}/api/img?url=${encodeURIComponent(src)}`
}

/** Otwiera link zewnętrzny: w Tauri w przeglądarce systemowej. */
export async function openExternal(url: string) {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("open_external", { url })
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}
