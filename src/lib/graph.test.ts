import { describe, expect, it } from "vitest"

import { betweenness, buildGraph, centralities, degreeCentrality, pagerank, rankInfluential, type GraphModel } from "./graph"
import type { ProfileEntry } from "./store"

const g = (edges: [string, string][]): GraphModel => {
  const ids = [...new Set(edges.flat())]
  return {
    nodes: ids.map((id) => ({ id, kind: "account" as const, sources: [], weight: 1, shared: false })),
    edges: edges.map(([source, target]) => ({ source, target, kind: "ref" as const, weight: 1 })),
  }
}

describe("centralności (zgodne z networkx)", () => {
  it("pagerank sumuje się do 1 i premiuje wskazywany węzeł", () => {
    const pr = pagerank(g([["a", "c"], ["b", "c"], ["c", "a"]]))
    const sum = [...pr.values()].reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 5)
    expect(pr.get("c")!).toBeGreaterThan(pr.get("b")!)
  })

  it("betweenness: środek ścieżki a→b→c ma 0,5", () => {
    const bw = betweenness(g([["a", "b"], ["b", "c"]]))
    expect(bw.get("b")).toBeCloseTo(0.5, 6) // 1 / ((3-1)(3-2))
    expect(bw.get("a")).toBe(0)
  })

  it("degree liczy parę kierunkową raz, mimo kilku rodzajów relacji", () => {
    const model = g([["a", "b"]])
    model.edges.push({ source: "a", target: "b", kind: "following", weight: 1 })
    expect(degreeCentrality(model).get("a")).toBe(1)
  })

  it("ranking: hub na szczycie gwiazdy", () => {
    const star = g([["x", "hub"], ["y", "hub"], ["z", "hub"], ["hub", "x"]])
    const r = rankInfluential(star, centralities(star))
    expect(r[0].node).toBe("hub")
    expect(r[0].influence).toBe("hub")
  })
})

describe("buildGraph", () => {
  const entry = (username: string, connections: string[], following: string[] = []): ProfileEntry => ({
    username,
    status: "ready",
    inNetwork: true,
    updatedAt: 0,
    following,
    data: {
      ok: true,
      profile: { username } as never,
      posts: [],
      connections: connections.map((u) => ({ username: u, count: 1 })),
      audience: null,
      content: null,
    },
  })

  it("oznacza konto wskazywane przez ≥2 profile jako wspólne", () => {
    const m = buildGraph([entry("a", ["brand"]), entry("b", ["brand", "solo"])], { hashtags: false, lists: true, minSources: 1 })
    expect(m.nodes.find((n) => n.id === "brand")?.shared).toBe(true)
    expect(m.nodes.find((n) => n.id === "solo")?.shared).toBe(false)
  })

  it("listy obserwowanych dają krawędzie following i można je wyłączyć", () => {
    const on = buildGraph([entry("a", [], ["x"])], { hashtags: false, lists: true, minSources: 1 })
    const off = buildGraph([entry("a", [], ["x"])], { hashtags: false, lists: false, minSources: 1 })
    expect(on.edges.some((e) => e.kind === "following")).toBe(true)
    expect(off.edges.length).toBe(0)
  })
})
