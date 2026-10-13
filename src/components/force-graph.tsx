/* ----------------------------------------------------------------------------
 * Graf siłowy na canvasie: symulacja na żywo (Barnes-Hut), zoom kółkiem wokół
 * kursora, przesuwanie tła, przeciąganie węzłów, podświetlanie sąsiedztwa.
 * Pozycje węzłów przeżywają zmiany modelu, więc dodanie profilu „dorasta”
 * do istniejącej mapy zamiast ją przetasować.
 * -------------------------------------------------------------------------- */

import * as React from "react"

import type { GEdge, GNode, GraphModel } from "@/lib/graph"

// Paleta społeczności (kolorowanie węzłów). Brand-neutralna, czytelna w obu motywach.
const COMMUNITY_COLORS = [
  "#4f9cf2", "#3fb950", "#e3a008", "#d2698f", "#9a7bf2",
  "#56c7c0", "#e06c4f", "#8b93f0", "#6fbf73", "#c99a3f",
]

interface SimNode extends GNode {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  fixed: boolean
  degree: number
}

export interface ForceGraphHandle {
  fit: () => void
  reheat: () => void
  /** Zrzut grafu (z tłem) jako data URL PNG. */
  toPng: () => string | null
}

interface Palette {
  bg: string
  fg: string
  muted: string
  account: string
  shared: string
  following: string
  follower: string
  ref: string
  tag: string
  ring: string
  font: string
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  return {
    bg: v("--card") || "#fff",
    fg: v("--node-analyzed") || v("--foreground"),
    muted: v("--muted-foreground"),
    account: v("--node-account"),
    shared: v("--series-2"),
    following: v("--series-1"),
    follower: v("--series-3"),
    ref: v("--muted-foreground"),
    tag: v("--series-other"),
    ring: v("--ring"),
    font: getComputedStyle(document.body).fontFamily,
  }
}

/* --------------------------- Barnes-Hut quadtree ---------------------------- */

interface Quad {
  x0: number
  y0: number
  size: number
  mass: number
  cx: number
  cy: number
  node: SimNode | null
  kids: (Quad | null)[] | null
}

function buildQuad(nodes: SimNode[]): Quad | null {
  if (!nodes.length) return null
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const n of nodes) {
    x0 = Math.min(x0, n.x)
    y0 = Math.min(y0, n.y)
    x1 = Math.max(x1, n.x)
    y1 = Math.max(y1, n.y)
  }
  const size = Math.max(x1 - x0, y1 - y0, 1) + 1
  const root: Quad = { x0, y0, size, mass: 0, cx: 0, cy: 0, node: null, kids: null }
  const insert = (q: Quad, n: SimNode, depth: number) => {
    q.cx = (q.cx * q.mass + n.x) / (q.mass + 1)
    q.cy = (q.cy * q.mass + n.y) / (q.mass + 1)
    q.mass++
    if (!q.kids && !q.node) {
      q.node = n
      return
    }
    if (depth > 24) return
    if (!q.kids) {
      q.kids = [null, null, null, null]
      const old = q.node!
      q.node = null
      place(q, old, depth)
    }
    place(q, n, depth)
  }
  const place = (q: Quad, n: SimNode, depth: number) => {
    const h = q.size / 2
    const i = (n.x >= q.x0 + h ? 1 : 0) + (n.y >= q.y0 + h ? 2 : 0)
    if (!q.kids![i]) {
      q.kids![i] = {
        x0: q.x0 + (i & 1 ? h : 0),
        y0: q.y0 + (i & 2 ? h : 0),
        size: h,
        mass: 0,
        cx: 0,
        cy: 0,
        node: null,
        kids: null,
      }
    }
    insert(q.kids![i]!, n, depth + 1)
  }
  for (const n of nodes) insert(root, n, 0)
  return root
}

function repel(q: Quad, n: SimNode, strength: number, theta2: number) {
  if (!q.mass || q.node === n) return
  const dx = q.cx - n.x
  const dy = q.cy - n.y
  const d2 = dx * dx + dy * dy || 0.01
  if (!q.kids || (q.size * q.size) / d2 < theta2) {
    const f = (strength * q.mass) / d2
    n.vx -= dx * f
    n.vy -= dy * f
    return
  }
  for (const k of q.kids) if (k) repel(k, n, strength, theta2)
}

/* ------------------------------ Komponent ----------------------------------- */

export const ForceGraph = React.forwardRef<
  ForceGraphHandle,
  {
    model: GraphModel
    selected: string | null
    onSelect: (id: string | null) => void
    focusShared?: boolean
    /** Mapa {węzeł -> indeks społeczności}; gdy podana, węzły kont kolorowane wg grupy. */
    communities?: Map<string, number>
    className?: string
  }
>(function ForceGraph({ model, selected, onSelect, focusShared, communities, className }, ref) {
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const sim = React.useRef({
    nodes: [] as SimNode[],
    byId: new Map<string, SimNode>(),
    edges: [] as (GEdge & { s: SimNode; t: SimNode })[],
    neighbors: new Map<string, Set<string>>(),
    alpha: 1,
    view: { x: 0, y: 0, k: 1 },
    size: { w: 800, h: 600, dpr: 1 },
    hover: null as SimNode | null,
    drag: null as null | { node: SimNode | null; sx: number; sy: number; vx: number; vy: number; moved: boolean },
    palette: null as Palette | null,
    raf: 0,
    needsFit: true,
  })
  const selectedRef = React.useRef(selected)
  selectedRef.current = selected
  const focusRef = React.useRef(focusShared)
  focusRef.current = focusShared
  const commRef = React.useRef(communities)
  commRef.current = communities
  const onSelectRef = React.useRef(onSelect)
  onSelectRef.current = onSelect

  const kick = React.useCallback((alpha = 0.6) => {
    const s = sim.current
    s.alpha = Math.max(s.alpha, alpha)
    if (!s.raf) s.raf = requestAnimationFrame(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fit = React.useCallback(() => {
    const s = sim.current
    if (!s.nodes.length) return
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity
    for (const n of s.nodes) {
      x0 = Math.min(x0, n.x - n.r)
      y0 = Math.min(y0, n.y - n.r)
      x1 = Math.max(x1, n.x + n.r)
      y1 = Math.max(y1, n.y + n.r)
    }
    const pad = 48
    const k = Math.min(2.5, Math.max(0.05, Math.min((s.size.w - pad * 2) / (x1 - x0 || 1), (s.size.h - pad * 2) / (y1 - y0 || 1))))
    s.view = { k, x: s.size.w / 2 - ((x0 + x1) / 2) * k, y: s.size.h / 2 - ((y0 + y1) / 2) * k }
    kick(0)
  }, [kick])

  React.useImperativeHandle(
    ref,
    () => ({
      fit,
      reheat: () => kick(0.8),
      toPng: () => {
        const c = canvasRef.current
        if (!c) return null
        draw()
        const out = document.createElement("canvas")
        out.width = c.width
        out.height = c.height
        const ctx = out.getContext("2d")
        if (!ctx) return null
        ctx.fillStyle = (sim.current.palette ??= readPalette(c)).bg
        ctx.fillRect(0, 0, out.width, out.height)
        ctx.drawImage(c, 0, 0)
        return out.toDataURL("image/png")
      },
    }),
     
    [fit, kick]
  )

  /* --- synchronizacja modelu z symulacją (zachowuje pozycje) --- */
  React.useEffect(() => {
    const s = sim.current
    const prev = s.byId
    const byId = new Map<string, SimNode>()
    const degree = new Map<string, number>()
    for (const e of model.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
    }
    const anchors = model.nodes.filter((n) => n.kind === "analyzed" && prev.has(n.id))
    const nodes = model.nodes.map((n, i) => {
      const old = prev.get(n.id)
      const deg = degree.get(n.id) ?? 0
      const r =
        n.kind === "analyzed" ? 9 + Math.min(10, Math.sqrt(deg)) : n.kind === "hashtag" ? 3.5 : Math.min(11, 3 + Math.sqrt(n.weight) * 1.6)
      if (old) return Object.assign(old, n, { r, degree: deg })
      // nowy węzeł: przy którymś z profili źródłowych, inaczej na okręgu
      const src =
        n.sources.map((id) => prev.get(id)).find(Boolean) ?? (anchors[0] ? prev.get(anchors[0].id) : undefined)
      const a = (i / Math.max(1, model.nodes.length)) * Math.PI * 2
      const base = src ?? { x: Math.cos(a) * 200, y: Math.sin(a) * 200 }
      return {
        ...n,
        x: base.x + (Math.random() - 0.5) * 60,
        y: base.y + (Math.random() - 0.5) * 60,
        vx: 0,
        vy: 0,
        r,
        fixed: false,
        degree: deg,
      } as SimNode
    })
    for (const n of nodes) byId.set(n.id, n)
    const neighbors = new Map<string, Set<string>>()
    const edges = model.edges
      .map((e) => ({ ...e, s: byId.get(e.source)!, t: byId.get(e.target)! }))
      .filter((e) => e.s && e.t)
    for (const e of edges) {
      if (!neighbors.has(e.source)) neighbors.set(e.source, new Set())
      if (!neighbors.has(e.target)) neighbors.set(e.target, new Set())
      neighbors.get(e.source)!.add(e.target)
      neighbors.get(e.target)!.add(e.source)
    }
    const wasEmpty = s.nodes.length === 0
    s.nodes = nodes
    s.byId = byId
    s.edges = edges
    s.neighbors = neighbors
    if (wasEmpty) s.needsFit = true
    kick(wasEmpty ? 1 : 0.5)
  }, [model, kick])

  /* --- pętla symulacji i rysowania --- */
  function step() {
    const s = sim.current
    const { nodes, edges } = s
    const alpha = s.alpha
    const root = buildQuad(nodes)
    const strength = 900 * alpha
    if (root) for (const n of nodes) repel(root, n, strength, 0.81)
    for (const e of edges) {
      const dx = e.t.x - e.s.x
      const dy = e.t.y - e.s.y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const len = e.kind === "uses" ? 50 : e.s.kind === "analyzed" && e.t.kind === "analyzed" ? 220 : 80
      const deg = Math.min(e.s.degree, e.t.degree) || 1
      const f = ((d - len) / d) * alpha * (0.6 / deg)
      const fx = dx * f
      const fy = dy * f
      e.t.vx -= fx
      e.t.vy -= fy
      e.s.vx += fx
      e.s.vy += fy
    }
    for (const n of nodes) {
      n.vx -= n.x * 0.015 * alpha
      n.vy -= n.y * 0.015 * alpha
      if (n.fixed) {
        n.vx = n.vy = 0
        continue
      }
      n.vx *= 0.55
      n.vy *= 0.55
      n.x += n.vx
      n.y += n.vy
    }
    s.alpha *= 0.985
  }

  function draw() {
    const s = sim.current
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext("2d")
    if (!ctx) return
    const pal = (s.palette ??= readPalette(c))
    const { w, h, dpr } = s.size
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const { x: tx, y: ty, k } = s.view
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty)

    const sel = selectedRef.current ? s.byId.get(selectedRef.current) : null
    const focus = s.hover ?? sel
    const hood = focus ? s.neighbors.get(focus.id) : null
    const sharedOnly = focusRef.current
    const dim = (n: SimNode) =>
      (focus && n !== focus && !hood?.has(n.id)) || (sharedOnly && n.kind === "account" && !n.shared)

    const edgeColor: Record<string, string> = {
      ref: pal.ref,
      following: pal.following,
      follower: pal.follower,
      uses: pal.tag,
    }
    ctx.lineCap = "round"
    for (const e of s.edges) {
      const active = focus && (e.s === focus || e.t === focus)
      const faded = (focus && !active) || dim(e.s) || dim(e.t)
      ctx.globalAlpha = faded ? 0.06 : active ? 0.9 : e.kind === "ref" ? 0.45 : 0.28
      ctx.strokeStyle = edgeColor[e.kind]
      ctx.lineWidth = (active ? 1.8 : Math.min(3, 0.7 + Math.log2(1 + e.weight) * 0.6)) / Math.sqrt(k)
      ctx.beginPath()
      ctx.moveTo(e.s.x, e.s.y)
      ctx.lineTo(e.t.x, e.t.y)
      ctx.stroke()
      if (active && e.kind !== "uses") {
        // grot kierunku
        const ang = Math.atan2(e.t.y - e.s.y, e.t.x - e.s.x)
        const ax = e.t.x - Math.cos(ang) * (e.t.r + 2)
        const ay = e.t.y - Math.sin(ang) * (e.t.r + 2)
        const sz = 6 / Math.sqrt(k)
        ctx.fillStyle = edgeColor[e.kind]
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(ax - Math.cos(ang - 0.4) * sz, ay - Math.sin(ang - 0.4) * sz)
        ctx.lineTo(ax - Math.cos(ang + 0.4) * sz, ay - Math.sin(ang + 0.4) * sz)
        ctx.fill()
      }
    }

    for (const n of s.nodes) {
      ctx.globalAlpha = dim(n) ? 0.15 : 1
      ctx.beginPath()
      if (n.kind === "hashtag") {
        ctx.rect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2)
        ctx.fillStyle = pal.tag
      } else {
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        const comm = commRef.current?.get(n.id)
        ctx.fillStyle =
          comm != null
            ? COMMUNITY_COLORS[comm % COMMUNITY_COLORS.length]
            : n.kind === "analyzed" ? pal.fg : n.shared ? pal.shared : pal.account
      }
      ctx.fill()
      // pierścień 2px w kolorze tła: oddziela nakładające się znaczniki
      ctx.lineWidth = 2 / k
      ctx.strokeStyle = pal.bg
      ctx.stroke()
      if (n === sel || n === s.hover) {
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r + 4 / k, 0, Math.PI * 2)
        ctx.lineWidth = 1.5 / k
        ctx.strokeStyle = pal.ring
        ctx.stroke()
      }
    }

    // etykiety: profile analizowane, wspólne, zaznaczone/hover i sąsiedztwo; resztę przy przybliżeniu
    ctx.textAlign = "center"
    ctx.textBaseline = "top"
    for (const n of s.nodes) {
      const show =
        n.kind === "analyzed" ||
        n === sel ||
        n === s.hover ||
        (focus && hood?.has(n.id)) ||
        (n.shared && k > 0.7) ||
        k > 1.8
      if (!show || dim(n)) continue
      const size = (n.kind === "analyzed" ? 12.5 : 11) / k
      ctx.font = `${n.kind === "analyzed" ? 600 : 400} ${size}px ${pal.font}`
      const label = n.kind === "hashtag" ? n.id : `@${n.id}`
      const y = n.y + n.r + 3 / k
      ctx.globalAlpha = 1
      ctx.lineWidth = 3 / k
      ctx.strokeStyle = pal.bg
      ctx.strokeText(label, n.x, y)
      ctx.fillStyle = n.kind === "analyzed" ? pal.fg : pal.muted
      ctx.fillText(label, n.x, y)
    }
    ctx.globalAlpha = 1
  }

  function tick() {
    const s = sim.current
    s.raf = 0
    if (s.alpha > 0.004) {
      const iters = s.nodes.length > 1500 ? 1 : 2
      for (let i = 0; i < iters; i++) step()
      if (s.needsFit && s.alpha < 0.35) {
        s.needsFit = false
        fit()
      }
    }
    draw()
    if (s.alpha > 0.004 || s.drag) s.raf = requestAnimationFrame(tick)
  }

  /* --- rozmiar, motyw --- */
  React.useEffect(() => {
    const wrap = wrapRef.current
    const c = canvasRef.current
    if (!wrap || !c) return
    const ro = new ResizeObserver(() => {
      const s = sim.current
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const first = s.size.w === 800 && s.size.h === 600 && s.view.x === 0
      s.size = { w: rect.width, h: rect.height, dpr }
      c.width = Math.max(1, Math.round(rect.width * dpr))
      c.height = Math.max(1, Math.round(rect.height * dpr))
      c.style.width = `${rect.width}px`
      c.style.height = `${rect.height}px`
      if (first) s.view = { x: rect.width / 2, y: rect.height / 2, k: 1 }
      kick(0)
    })
    ro.observe(wrap)
    const mo = new MutationObserver(() => {
      sim.current.palette = null
      kick(0)
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    const s = sim.current
    return () => {
      ro.disconnect()
      mo.disconnect()
      cancelAnimationFrame(s.raf)
      s.raf = 0
    }
  }, [kick])

  React.useEffect(() => {
    kick(0)
  }, [selected, focusShared, communities, kick])

  /* --- interakcje --- */
  const toWorld = (cx: number, cy: number) => {
    const { x, y, k } = sim.current.view
    return { x: (cx - x) / k, y: (cy - y) / k }
  }
  const pick = (cx: number, cy: number): SimNode | null => {
    const p = toWorld(cx, cy)
    const s = sim.current
    const tol = 4 / s.view.k
    let best: SimNode | null = null
    let bestD = Infinity
    for (const n of s.nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y) - n.r
      if (d < tol && d < bestD) {
        best = n
        bestD = d
      }
    }
    return best
  }
  const local = (e: React.PointerEvent | React.WheelEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { cx: e.clientX - r.left, cy: e.clientY - r.top }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const { cx, cy } = local(e)
    const node = pick(cx, cy)
    const s = sim.current
    s.drag = { node, sx: cx, sy: cy, vx: s.view.x, vy: s.view.y, moved: false }
    if (node) node.fixed = true
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const { cx, cy } = local(e)
    const s = sim.current
    const d = s.drag
    if (d) {
      if (Math.hypot(cx - d.sx, cy - d.sy) > 3) d.moved = true
      if (d.node) {
        const p = toWorld(cx, cy)
        d.node.x = p.x
        d.node.y = p.y
        kick(0.3)
      } else {
        s.view.x = d.vx + (cx - d.sx)
        s.view.y = d.vy + (cy - d.sy)
        kick(0)
      }
      return
    }
    const h = pick(cx, cy)
    if (h !== s.hover) {
      s.hover = h
      canvasRef.current!.style.cursor = h ? "pointer" : "grab"
      kick(0)
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const s = sim.current
    const d = s.drag
    s.drag = null
    if (!d) return
    if (d.node) d.node.fixed = e.shiftKey // Shift = przypnij węzeł
    if (!d.moved) onSelectRef.current(d.node ? d.node.id : null)
    kick(0)
  }
  React.useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = c.getBoundingClientRect()
      const cx = e.clientX - r.left
      const cy = e.clientY - r.top
      const s = sim.current
      const k = Math.min(6, Math.max(0.05, s.view.k * Math.exp(-e.deltaY * 0.0015)))
      s.view.x = cx - ((cx - s.view.x) * k) / s.view.k
      s.view.y = cy - ((cy - s.view.y) * k) / s.view.k
      s.view.k = k
      kick(0)
    }
    c.addEventListener("wheel", onWheel, { passive: false })
    return () => c.removeEventListener("wheel", onWheel)
  }, [kick])

  return (
    <div ref={wrapRef} className={className}>
      <canvas
        ref={canvasRef}
        className="block cursor-grab touch-none active:cursor-grabbing"
        role="img"
        aria-label={`Graf powiązań: ${model.nodes.length} kont, ${model.edges.length} relacji`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          if (sim.current.hover) {
            sim.current.hover = null
            kick(0)
          }
        }}
        onDoubleClick={() => fit()}
      />
    </div>
  )
})
