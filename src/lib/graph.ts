/* ----------------------------------------------------------------------------
 * Model sieci powiązań + centralności i ranking wpływu.
 *
 * Port modułu Python social_analytics (graph_schema.py, centrality.py) do TS:
 * graf skierowany, ważony; PageRank, betweenness (Brandes), degree,
 * eigenvector; score = 0.5·PR + 0.3·Degree + 0.2·Eigenvector (znormalizowane);
 * rodzaj wpływu: hub / bridge / connector / peripheral.
 * -------------------------------------------------------------------------- */

import type { ProfileEntry } from "./store"

export type NodeKind = "analyzed" | "account" | "hashtag"
export type EdgeKind = "ref" | "following" | "follower" | "uses"

export interface GNode {
  id: string
  kind: NodeKind
  /** Profile analizowane, które wskazują na ten węzeł. */
  sources: string[]
  weight: number
  shared: boolean
}

export interface GEdge {
  source: string
  target: string
  kind: EdgeKind
  weight: number
}

export interface GraphModel {
  nodes: GNode[]
  edges: GEdge[]
}

export interface GraphOptions {
  hashtags: boolean
  lists: boolean
  /** Minimalna liczba profili wskazujących węzeł (1 = wszystkie, 2 = tylko wspólne). */
  minSources: number
}

/** Bound expensive layouts/rankings without changing the full exportable graph. */
export function graphPreview(g: GraphModel, focus?: string | null, maxNodes = 400, maxEdges = 4000): GraphModel {
  if (g.nodes.length <= maxNodes && g.edges.length <= maxEdges) return g
  const adjacent = new Set<string>()
  if (focus) for (const e of g.edges) {
    if (e.source === focus) adjacent.add(e.target)
    if (e.target === focus) adjacent.add(e.source)
  }
  const priority = (n: GNode) => n.id === focus ? 4 : adjacent.has(n.id) ? 3 : n.shared ? 2 : n.kind === "analyzed" ? 1 : 0
  const nodes = [...g.nodes].sort((a, b) => priority(b) - priority(a) || b.weight - a.weight || a.id.localeCompare(b.id)).slice(0, maxNodes)
  const keep = new Set(nodes.map((n) => n.id))
  const edges = g.edges.filter((e) => keep.has(e.source) && keep.has(e.target))
  edges.sort((a, b) => Number(b.source === focus || b.target === focus) - Number(a.source === focus || a.target === focus) || b.weight - a.weight)
  return { nodes, edges: edges.slice(0, maxEdges) }
}

export function buildGraph(profiles: ProfileEntry[], opts: GraphOptions): GraphModel {
  const nodes = new Map<string, { id: string; kind: NodeKind; sources: Set<string>; weight: number }>()
  const edges = new Map<string, GEdge>()
  const analyzed = new Set(profiles.map((p) => p.username))

  const node = (id: string, kind: NodeKind) => {
    let n = nodes.get(id)
    if (!n) {
      n = { id, kind, sources: new Set(), weight: 0 }
      nodes.set(id, n)
    }
    if (kind === "analyzed") n.kind = "analyzed"
    return n
  }
  const edge = (source: string, target: string, kind: EdgeKind, w: number) => {
    const key = `${source}\u0000${target}\u0000${kind}`
    const e = edges.get(key)
    if (e) e.weight += w
    else edges.set(key, { source, target, kind, weight: w })
  }

  for (const p of profiles) {
    const u = p.username
    node(u, "analyzed")
    const ref = (raw: string, w: number, kind: EdgeKind) => {
      const name = raw.toLowerCase()
      if (!name || name === u) return
      const isTag = kind === "uses"
      const id = isTag ? `#${name}` : name
      const n = node(id, isTag ? "hashtag" : analyzed.has(name) ? "analyzed" : "account")
      n.sources.add(u)
      n.weight += w
      if (kind === "follower") edge(id, u, kind, w)
      else edge(u, id, kind, w)
    }
    for (const c of p.data?.connections ?? []) ref(c.username, c.count || 1, "ref")
    if (opts.lists) {
      for (const f of p.following ?? []) ref(f, 1, "following")
      for (const f of p.followers ?? []) ref(f, 1, "follower")
    }
    if (opts.hashtags) for (const h of (p.data?.hashtags ?? []).slice(0, 25)) ref(h.tag, h.count, "uses")
  }

  const out: GNode[] = []
  for (const n of nodes.values()) {
    const shared = n.sources.size >= 2
    if (n.kind !== "analyzed" && n.sources.size < opts.minSources) continue
    out.push({ id: n.id, kind: n.kind, sources: [...n.sources], weight: n.weight, shared })
  }
  const keep = new Set(out.map((n) => n.id))
  return {
    nodes: out,
    edges: [...edges.values()].filter((e) => keep.has(e.source) && keep.has(e.target)),
  }
}

/* ------------------------------ Centralności ------------------------------ */

export interface Centralities {
  pagerank: Map<string, number>
  betweenness: Map<string, number>
  degree: Map<string, number>
  eigenvector: Map<string, number>
  /** Miary, które się nie zbiegły (wartości wyzerowane). */
  degenerate: string[]
}

function adjacency(g: GraphModel) {
  const out = new Map<string, { to: string; w: number }[]>()
  const inc = new Map<string, { from: string; w: number }[]>()
  for (const n of g.nodes) {
    out.set(n.id, [])
    inc.set(n.id, [])
  }
  for (const e of g.edges) {
    out.get(e.source)?.push({ to: e.target, w: e.weight })
    inc.get(e.target)?.push({ from: e.source, w: e.weight })
  }
  return { out, inc }
}

export function pagerank(g: GraphModel, alpha = 0.85, iters = 100, tol = 1e-6): Map<string, number> {
  const ids = g.nodes.map((n) => n.id)
  const N = ids.length
  const { out } = adjacency(g)
  const outW = new Map(ids.map((id) => [id, (out.get(id) ?? []).reduce((a, x) => a + x.w, 0)]))
  let x = new Map(ids.map((id) => [id, 1 / N]))
  for (let it = 0; it < iters; it++) {
    const next = new Map(ids.map((id) => [id, 0]))
    let dangling = 0
    for (const id of ids) if (!outW.get(id)) dangling += x.get(id)!
    for (const id of ids) {
      const w = outW.get(id)!
      if (!w) continue
      const share = (alpha * x.get(id)!) / w
      for (const { to, w: ew } of out.get(id)!) next.set(to, next.get(to)! + share * ew)
    }
    const base = (1 - alpha) / N + (alpha * dangling) / N
    let err = 0
    for (const id of ids) {
      const v = next.get(id)! + base
      err += Math.abs(v - x.get(id)!)
      next.set(id, v)
    }
    x = next
    if (err < N * tol) break
  }
  return x
}

/** Betweenness (Brandes) dla grafu skierowanego, nieważonego, znormalizowana. */
export function betweenness(g: GraphModel): Map<string, number> {
  const ids = g.nodes.map((n) => n.id)
  const N = ids.length
  const { out } = adjacency(g)
  const cb = new Map(ids.map((id) => [id, 0]))
  for (const s of ids) {
    const stack: string[] = []
    const pred = new Map<string, string[]>(ids.map((id) => [id, []]))
    const sigma = new Map(ids.map((id) => [id, 0]))
    const dist = new Map(ids.map((id) => [id, -1]))
    sigma.set(s, 1)
    dist.set(s, 0)
    const queue = [s]
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi]
      stack.push(v)
      for (const { to: w } of out.get(v)!) {
        if (dist.get(w)! < 0) {
          dist.set(w, dist.get(v)! + 1)
          queue.push(w)
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!)
          pred.get(w)!.push(v)
        }
      }
    }
    const delta = new Map(ids.map((id) => [id, 0]))
    while (stack.length) {
      const w = stack.pop()!
      for (const v of pred.get(w)!) {
        delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!))
      }
      if (w !== s) cb.set(w, cb.get(w)! + delta.get(w)!)
    }
  }
  const scale = N > 2 ? 1 / ((N - 1) * (N - 2)) : 0
  for (const id of ids) cb.set(id, cb.get(id)! * scale)
  return cb
}

export function degreeCentrality(g: GraphModel): Map<string, number> {
  const N = g.nodes.length
  const d = new Map(g.nodes.map((n) => [n.id, 0]))
  // Jak networkx (DiGraph): para kierunkowa liczona raz, niezależnie od rodzaju relacji.
  const seen = new Set<string>()
  for (const e of g.edges) {
    const key = `${e.source} ${e.target}`
    if (seen.has(key)) continue
    seen.add(key)
    d.set(e.source, d.get(e.source)! + 1)
    d.set(e.target, d.get(e.target)! + 1)
  }
  const s = N > 1 ? 1 / (N - 1) : 1
  for (const [k, v] of d) d.set(k, v * s)
  return d
}

/** Eigenvector (jak networkx: na krawędziach wchodzących, iteracja potęgowa). */
export function eigenvector(g: GraphModel, iters = 1000, tol = 1e-6): Map<string, number> | null {
  const ids = g.nodes.map((n) => n.id)
  const N = ids.length
  const { out } = adjacency(g)
  let x = new Map(ids.map((id) => [id, 1 / N]))
  for (let it = 0; it < iters; it++) {
    const next = new Map(x)
    for (const id of ids) for (const { to, w } of out.get(id)!) next.set(to, next.get(to)! + x.get(id)! * w)
    const norm = Math.sqrt([...next.values()].reduce((a, v) => a + v * v, 0)) || 1
    let err = 0
    for (const id of ids) {
      const v = next.get(id)! / norm
      err += Math.abs(v - x.get(id)!)
      next.set(id, v)
    }
    x = next
    if (err < N * tol) return x
  }
  return null
}

export function centralities(g: GraphModel): Centralities {
  const degenerate: string[] = []
  const ev = eigenvector(g)
  if (!ev) degenerate.push("eigenvector")
  return {
    pagerank: pagerank(g),
    betweenness: betweenness(g),
    degree: degreeCentrality(g),
    eigenvector: ev ?? new Map(g.nodes.map((n) => [n.id, 0])),
    degenerate,
  }
}

export type Influence = "hub" | "bridge" | "connector" | "peripheral"

export interface NodeInfluence {
  node: string
  kind: NodeKind
  pagerank: number
  betweenness: number
  degree: number
  eigenvector: number
  score: number
  influence: Influence
  sources: number
}

const normalize = (m: Map<string, number>) => {
  const top = Math.max(0, ...m.values())
  return (id: string) => (top > 0 ? (m.get(id) ?? 0) / top : 0)
}

function label(score: number, bwN: number, dgN: number): Influence {
  if (bwN >= 0.6 && bwN > dgN) return "bridge"
  if (score >= 0.6) return "hub"
  if (score <= 0.15) return "peripheral"
  return "connector"
}

export function rankInfluential(g: GraphModel, c = centralities(g)): NodeInfluence[] {
  const pr = normalize(c.pagerank)
  const bw = normalize(c.betweenness)
  const dg = normalize(c.degree)
  const ev = normalize(c.eigenvector)
  return g.nodes
    .map((n) => {
      const score = 0.5 * pr(n.id) + 0.3 * dg(n.id) + 0.2 * ev(n.id)
      return {
        node: n.id,
        kind: n.kind,
        pagerank: c.pagerank.get(n.id) ?? 0,
        betweenness: c.betweenness.get(n.id) ?? 0,
        degree: c.degree.get(n.id) ?? 0,
        eigenvector: c.eigenvector.get(n.id) ?? 0,
        score,
        influence: label(score, bw(n.id), dg(n.id)),
        sources: n.sources.length,
      }
    })
    .sort((a, b) => b.score - a.score)
}

export const INFLUENCE_LABEL: Record<Influence, string> = {
  hub: "Hub",
  bridge: "Most",
  connector: "Łącznik",
  peripheral: "Peryferia",
}

export const INFLUENCE_HINT: Record<Influence, string> = {
  hub: "duża waga i liczba połączeń, centrum skupiska",
  bridge: "wysoka pośredniość przy niskim stopniu: łączy oddzielne skupiska",
  connector: "średnio ważny węzeł w sieci",
  peripheral: "na obrzeżach sieci, mało powiązań",
}
