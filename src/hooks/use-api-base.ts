import * as React from "react"

import { apiBase } from "@/lib/runtime"

/** Baza URL API (""/web, http://127.0.0.1:PORT w Tauri); null do czasu ustalenia. */
export function useApiBase(): string | null {
  const [base, setBase] = React.useState<string | null>(null)
  React.useEffect(() => {
    let alive = true
    apiBase()
      .then((b) => alive && setBase(b))
      .catch(() => alive && setBase(""))
    return () => {
      alive = false
    }
  }, [])
  return base
}
