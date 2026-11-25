import * as React from "react"

import type { GraphModel } from "@/lib/graph"
import { canvasToPng, exportLayout, type PngExport } from "@/lib/png"
import { cn } from "@/lib/utils"

export interface Bubble {
  id: string
  value: number
  shared: boolean
  sources: number
  kind: string
  r: number
  x: number
  y: number
}

/** Rozsuwa nachodzące na siebie koła (bez przyciągania do środka). Zwraca największe nałożenie. */
function separate(items: Bubble[]): number {
  let worst = 0
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]
      const b = items[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 0.01
      const min = a.r + b.r + 2
      if (d < min) {
        worst = Math.max(worst, min - d)
        const p = (min - d) / d / 2
        dx *= p
        dy *= p
        a.x -= dx
        a.y -= dy
        b.x += dx
        b.y += dy
      }
    }
  return worst
}

export function pack(items: Bubble[], w: number, h: number) {
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
    separate(items)
  }
  // Przyciąganie do środka w ostatnim kroku zostawia część kół wciśniętych
  // w sąsiadów — na koniec samo rozsuwanie, aż nałożenia znikną.
  for (let it = 0; it < 80 && separate(items) > 0.5; it++);
}

/** Najdłuższy początek tekstu mieszczący się w `max` (z „…”, gdy obcięty); "" gdy nic się nie mieści. */
export function fitLabel(text: string, max: number, measure: (s: string) => number): string {
  if (measure(text) <= max) return text
  for (let n = text.length - 1; n >= 2; n--) {
    const s = text.slice(0, n) + "…"
    if (measure(s) <= max) return s
  }
  return ""
}

/**
 * Rozmiar czcionki podpisu: najpierw zmniejszamy czcionkę, aż cała nazwa zmieści
 * się w kole; dopiero poniżej `min` tekst będzie skracany. `widthAt1` = szerokość
 * tekstu przy czcionce 1 px (szerokość rośnie liniowo z rozmiarem).
 */
export function labelFontSize(r: number, widthAt1: number, min = 5.5, max = 14): number {
  const preferred = Math.min(max, Math.max(min, r * 0.42))
  const fits = widthAt1 > 0 ? (r * 2 - 6) / widthAt1 : preferred
  return Math.max(min, Math.min(preferred, fits))
}

/** Bąbelek dostaje podpis w eksporcie od tego promienia (px układu). */
const EXPORT_LABEL_MIN_R = 10

export interface BubbleChartHandle {
  /** Wszystkie bąbelki w wysokiej rozdzielczości, z podpisami i opisem na dole. */
  toPng: (caption?: string) => Promise<PngExport | null>
}

const bubbleLabel = (b: Bubble) => (b.kind === "hashtag" ? b.id : "@" + b.id)

/** Pakowane koła powiązanych kont: wielkość = liczba wystąpień, kolor = wspólne (≥2 profile). */
export const BubbleChart = React.forwardRef<
  BubbleChartHandle,
  {
    model: GraphModel
    selected: string | null
    onSelect: (id: string | null) => void
    className?: string
  }
>(function BubbleChart({ model, selected, onSelect, className }, handleRef) {
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

  React.useImperativeHandle(
    handleRef,
    () => ({
      toPng: async (caption?: string) => {
        const el = ref.current
        if (!el || !bubbles.length) return null
        const cs = getComputedStyle(el)
        const v = (n: string) => cs.getPropertyValue(n).trim()
        const pal = {
          bg: v("--card") || "#fff",
          fg: v("--foreground") || "#000",
          muted: v("--muted-foreground") || "#777",
          tag: v("--series-other"),
          shared: v("--series-2"),
          account: v("--node-account"),
          font: cs.fontFamily || "sans-serif",
        }
        const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
        for (const b of bubbles) {
          bounds.x0 = Math.min(bounds.x0, b.x - b.r)
          bounds.y0 = Math.min(bounds.y0, b.y - b.r)
          bounds.x1 = Math.max(bounds.x1, b.x + b.r)
          bounds.y1 = Math.max(bounds.y1, b.y + b.r)
        }
        const lay = exportLayout(bounds)
        const out = document.createElement("canvas")
        out.width = Math.round(lay.w * lay.dpr)
        out.height = Math.round(lay.h * lay.dpr)
        const ctx = out.getContext("2d")
        if (!ctx) return null
        const { dpr } = lay
        const { k, x: tx, y: ty } = lay.view
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = pal.bg
        ctx.fillRect(0, 0, lay.w, lay.h)
        ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty)
        for (const b of bubbles) {
          ctx.beginPath()
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
          ctx.globalAlpha = 0.9
          ctx.fillStyle = b.kind === "hashtag" ? pal.tag : b.shared ? pal.shared : pal.account
          ctx.fill()
          ctx.globalAlpha = 1
          ctx.lineWidth = 2
          ctx.strokeStyle = pal.bg
          ctx.stroke()
        }
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillStyle = pal.fg
        for (const b of bubbles) {
          if (b.r < EXPORT_LABEL_MIN_R) continue
          const text = bubbleLabel(b)
          ctx.font = `600 100px ${pal.font}`
          // Minimum ≈ 9 px w gotowym obrazie (niezależnie od powiększenia eksportu).
          const size = labelFontSize(b.r, ctx.measureText(text).width / 100, 9 / k)
          ctx.font = `600 ${size}px ${pal.font}`
          const label = fitLabel(text, b.r * 2 - 6, (s) => ctx.measureText(s).width)
          if (label) ctx.fillText(label, b.x, b.y)
        }
        if (caption) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.font = `400 12px ${pal.font}`
          ctx.textAlign = "left"
          ctx.textBaseline = "bottom"
          ctx.fillStyle = pal.muted
          ctx.fillText(caption, 16, lay.h - 12)
        }
        return canvasToPng(out)
      },
    }),
    [bubbles]
  )

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
                  {bubbleLabel(b).slice(0, Math.floor(b.r / 4))}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
    </div>
  )
})
