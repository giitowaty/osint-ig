import * as React from "react"

import type { GraphModel } from "@/lib/graph"
import { cn } from "@/lib/utils"

interface Bubble {
  id: string
  value: number
  shared: boolean
  sources: number
  kind: string
  r: number
  x: number
  y: number
}

function pack(items: Bubble[], w: number, h: number) {
  items.forEach((n, i) => {
    const a = i * 2.39996
    const d = Math.sqrt(i) * 14
    n.x = w / 2 + Math.cos(a) * d
    n.y = h / 2 + Math.sin(a) * d
  })
  for (let it = 0; it < 260; it++) {
    for (const n of items) {
      n.x += (w / 2 - n.x) * 0.015
      n.y += (h / 2 - n.y) * 0.015
    }
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]
        const b = items[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        const d = Math.hypot(dx, dy) || 0.01
        const min = a.r + b.r + 2
        if (d < min) {
          const p = (min - d) / d / 2
          dx *= p
          dy *= p
          a.x -= dx
          a.y -= dy
          b.x += dx
          b.y += dy
        }
      }
  }
}

/** Pakowane koła powiązanych kont: wielkość = liczba wystąpień, kolor = wspólne (≥2 profile). */
export function BubbleChart({
  model,
  selected,
  onSelect,
  className,
}: {
  model: GraphModel
  selected: string | null
  onSelect: (id: string | null) => void
  className?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [size, setSize] = React.useState({ w: 800, h: 500 })
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const bubbles = React.useMemo(() => {
    const list = model.nodes
      .filter((n) => n.kind !== "analyzed")
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 120)
    const max = list[0]?.weight || 1
    const scale = Math.min(size.w, size.h) / 12
    const items: Bubble[] = list.map((n) => ({
      id: n.id,
      value: n.weight,
      shared: n.shared,
      sources: n.sources.length,
      kind: n.kind,
      r: 6 + Math.sqrt(n.weight / max) * scale,
      x: 0,
      y: 0,
    }))
    pack(items, size.w, size.h)
    return items
  }, [model, size])

  return (
    <div ref={ref} className={cn("relative", className)}>
      {bubbles.length === 0 ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Brak powiązanych kont do pokazania.
        </p>
      ) : (
        <svg width={size.w} height={size.h} className="block" role="img" aria-label="Bąbelki powiązanych kont">
          {bubbles.map((b) => (
            <g key={b.id} onClick={() => onSelect(b.id)} className="cursor-pointer">
              <circle
                cx={b.x}
                cy={b.y}
                r={b.r}
                fill={b.kind === "hashtag" ? "var(--series-other)" : b.shared ? "var(--series-2)" : "var(--node-account)"}
                fillOpacity={selected && selected !== b.id ? 0.35 : 0.9}
                stroke={selected === b.id ? "var(--ring)" : "var(--card)"}
                strokeWidth={selected === b.id ? 2.5 : 2}
              >
                <title>{`${b.kind === "hashtag" ? b.id : "@" + b.id}: ${b.value} wystąpień, u ${b.sources} profili`}</title>
              </circle>
              {b.r >= 22 && (
                <text
                  x={b.x}
                  y={b.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none fill-foreground text-[11px] font-semibold"
                >
                  {(b.kind === "hashtag" ? b.id : "@" + b.id).slice(0, Math.floor(b.r / 4))}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
    </div>
  )
}
