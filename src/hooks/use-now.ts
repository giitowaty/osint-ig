import * as React from "react"

/** Bieżący czas odświeżany co `ms`, tylko gdy `active` (odliczania, czasy zadań). */
export function useNow(active: boolean, ms = 250) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [active, ms])
  return now
}
