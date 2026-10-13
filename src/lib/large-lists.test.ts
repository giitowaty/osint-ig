import { describe, expect, it } from "vitest"
import { pageSlice } from "./large-lists"
import { graphPreview, type GraphModel } from "./graph"

describe("large collection boundaries", () => {
  it("keeps every one of 100,001 items reachable and clamps shrinking pages", () => {
    const items = Array.from({ length: 100_001 }, (_, i) => i)
    const seen: number[] = []
    for (let page = 0; page < 2001; page++) seen.push(...pageSlice(items, page).items)
    expect(seen).toEqual(items)
    expect(pageSlice(items.slice(0, 3), 2000)).toMatchObject({ items: [0, 1, 2], page: 0, pages: 1 })
    expect(pageSlice([], 99).items).toEqual([])
  })
  it("bounds rendering, retains a searched node and never truncates the export model", () => {
    const model: GraphModel = {
      nodes: Array.from({ length: 10_000 }, (_, i) => ({ id: `n${i}`, kind: "analyzed", weight: i, shared: false, sources: [] })),
      edges: Array.from({ length: 9999 }, (_, i) => ({ source: "n0", target: `n${i + 1}`, kind: "follower", weight: 1 })),
    }
    const preview = graphPreview(model, "n1")
    expect(preview.nodes).toHaveLength(400)
    expect(preview.nodes[0].id).toBe("n1")
    expect(preview.nodes.some((n) => n.id === "n0")).toBe(true)
    const ids = new Set(preview.nodes.map((n) => n.id))
    expect(preview.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true)
    expect(model.nodes).toHaveLength(10_000)
    expect(model.edges).toHaveLength(9999)
  })
})
