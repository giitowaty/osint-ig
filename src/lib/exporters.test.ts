import { describe, expect, it } from "vitest"

import { cypher, edgesCsv, gexf, nodeLink, nodesCsv } from "./exporters"
import type { GraphModel } from "./graph"

const model: GraphModel = {
  nodes: [
    { id: "a", kind: "analyzed", sources: [], weight: 0, shared: false },
    { id: "o'brien", kind: "account", sources: ["a"], weight: 2, shared: false },
    { id: "#góry", kind: "hashtag", sources: ["a"], weight: 3, shared: false },
  ],
  edges: [
    { source: "a", target: "o'brien", kind: "ref", weight: 2 },
    { source: "a", target: "#góry", kind: "uses", weight: 3 },
  ],
}

describe("eksport sieci", () => {
  it("CSV ma BOM, nagłówki i wiersz na węzeł", () => {
    const csv = nodesCsv(model)
    expect(csv.startsWith("﻿id,kind")).toBe(true)
    expect(csv.split("\r\n")).toHaveLength(4)
    expect(edgesCsv(model)).toContain("a,o'brien,ref,2")
  })

  it("GEXF ma węzły, krawędzie i escapuje znaki XML", () => {
    const x = gexf(model)
    expect(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(x.match(/<node /g)).toHaveLength(3)
    expect(x.match(/<edge /g)).toHaveLength(2)
    expect(x).toContain('label="@o&apos;brien"')
    expect(x).not.toMatch(/label="[^"]*'[^"]*"/)
  })

  it("Cypher escapuje apostrofy i mapuje relacje", () => {
    const c = cypher(model)
    expect(c).toContain(String.raw`username: 'o\'brien'`)
    expect(c).toContain("[r:MENTIONS]")
    expect(c).toContain("(t:Hashtag {tag: 'góry'})")
  })

  it("node-link zgodny z networkx", () => {
    const j = nodeLink(model)
    expect(j.directed).toBe(true)
    expect(j.links[0]).toMatchObject({ source: "a", target: "o'brien" })
  })
})
