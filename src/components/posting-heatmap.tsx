import * as React from "react"

import type { Post } from "@/lib/types"

const DAYS = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"]

/**
 * Mapa publikacji: dzień tygodnia × godzina (czas lokalny przeglądarki).
 * Rytm publikacji pomaga ustalić strefę czasową i nawyki właściciela konta.
 */
export function PostingHeatmap({ posts }: { posts: Post[] }) {
  const { grid, max, n, peakHour, peakDay } = React.useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0) as number[])
    const hours = Array(24).fill(0) as number[]
    const days = Array(7).fill(0) as number[]
    let count = 0
    for (const p of posts) {
      if (!p.takenAt) continue
      const d = new Date(p.takenAt)
      const day = (d.getDay() + 6) % 7
      g[day][d.getHours()]++
      hours[d.getHours()]++
      days[day]++
      count++
    }
    return {
      grid: g,
      max: Math.max(1, ...g.flat()),
      n: count,
      peakHour: hours.indexOf(Math.max(...hours)),
      peakDay: days.indexOf(Math.max(...days)),
    }
  }, [posts])

  if (!n) return <p className="text-sm text-muted-foreground">Instagram nie podał dat publikacji.</p>

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] grid-cols-[2rem_repeat(24,minmax(0,1fr))] gap-0.5 text-[10px] text-muted-foreground">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="tnum text-center">
              {h % 3 === 0 ? h : ""}
            </span>
          ))}
          {grid.map((row, d) => (
            <React.Fragment key={d}>
              <span className="flex items-center">{DAYS[d]}</span>
              {row.map((v, h) => (
                <span
                  key={h}
                  title={`${DAYS[d]} ${String(h).padStart(2, "0")}:00 · ${v} ${v === 1 ? "post" : "postów"}`}
                  className="aspect-square"
                  style={{
                    background: v ? `color-mix(in oklch, var(--series-1) ${25 + Math.round((v / max) * 75)}%, var(--muted))` : "var(--muted)",
                    opacity: v ? 1 : 0.5,
                  }}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {n} postów z datą. Najczęściej: <span className="text-foreground">{DAYS[peakDay]}</span>, około{" "}
        <span className="tnum text-foreground">{String(peakHour).padStart(2, "0")}:00</span> (czas tego komputera,{" "}
        {Intl.DateTimeFormat().resolvedOptions().timeZone}).
      </p>
    </div>
  )
}
