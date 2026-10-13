/* ----------------------------------------------------------------------------
 * Eksport sieci powiązań do formatów narzędzi analitycznych:
 *  • CSV (węzły + krawędzie) — arkusze, pandas, R,
 *  • GEXF 1.3 — Gephi,
 *  • Cypher (idempotentne MERGE) — Neo4j (jak social_analytics/neo4j_export.py),
 *  • JSON node-link — d3 / networkx.node_link_graph.
 * -------------------------------------------------------------------------- */

import type { GraphModel, NodeInfluence } from "./graph"

const REL: Record<string, string> = {
  ref: "MENTIONS",
  following: "FOLLOWS",
  follower: "FOLLOWS",
  uses: "USES_HASHTAG",
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csv(rows: unknown[][]): string {
  // BOM: Excel poprawnie rozpozna UTF-8 (polskie znaki).
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")
}

export function nodesCsv(g: GraphModel, rank?: NodeInfluence[]): string {
  const r = new Map(rank?.map((x) => [x.node, x]))
  return csv([
    ["id", "kind", "shared", "weight", "sources", "pagerank", "betweenness", "degree", "eigenvector", "score", "influence"],
    ...g.nodes.map((n) => {
      const x = r.get(n.id)
      return [n.id, n.kind, n.shared, n.weight, n.sources.join(" "), x?.pagerank, x?.betweenness, x?.degree, x?.eigenvector, x?.score, x?.influence]
    }),
  ])
}

export function edgesCsv(g: GraphModel): string {
  return csv([["source", "target", "kind", "weight"], ...g.edges.map((e) => [e.source, e.target, e.kind, e.weight])])
}

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!)

export function gexf(g: GraphModel, rank?: NodeInfluence[]): string {
  const r = new Map(rank?.map((x) => [x.node, x]))
  const ids = new Map(g.nodes.map((n, i) => [n.id, `n${i}`]))
  const nodes = g.nodes
    .map((n) => {
      const x = r.get(n.id)
      return `      <node id="${ids.get(n.id)}" label="${xml(n.kind === "hashtag" ? n.id : "@" + n.id)}">
        <attvalues>
          <attvalue for="kind" value="${n.kind}"/>
          <attvalue for="shared" value="${n.shared}"/>
          <attvalue for="weight" value="${n.weight}"/>
          <attvalue for="score" value="${x?.score ?? 0}"/>
          <attvalue for="influence" value="${x?.influence ?? ""}"/>
        </attvalues>
      </node>`
    })
    .join("\n")
  const edges = g.edges
    .map(
      (e, i) =>
        `      <edge id="e${i}" source="${ids.get(e.source)}" target="${ids.get(e.target)}" weight="${e.weight}" label="${e.kind}"/>`
    )
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<gexf xmlns="http://gexf.net/1.3" version="1.3">
  <meta lastmodifieddate="${new Date().toISOString().slice(0, 10)}">
    <creator>OSINT-IG</creator>
    <description>Sieć powiązań kont Instagram</description>
  </meta>
  <graph defaultedgetype="directed" mode="static">
    <attributes class="node">
      <attribute id="kind" title="kind" type="string"/>
      <attribute id="shared" title="shared" type="boolean"/>
      <attribute id="weight" title="weight" type="integer"/>
      <attribute id="score" title="score" type="double"/>
      <attribute id="influence" title="influence" type="string"/>
    </attributes>
    <nodes>
${nodes}
    </nodes>
    <edges>
${edges}
    </edges>
  </graph>
</gexf>
`
}

const cy = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`

export function cypher(g: GraphModel): string {
  const L = [
    "// OSINT-IG → Neo4j. Idempotentne: można uruchamiać wielokrotnie.",
    "CREATE CONSTRAINT account_username IF NOT EXISTS FOR (a:Account) REQUIRE a.username IS UNIQUE;",
    "CREATE CONSTRAINT hashtag_tag IF NOT EXISTS FOR (h:Hashtag) REQUIRE h.tag IS UNIQUE;",
  ]
  for (const n of g.nodes) {
    if (n.kind === "hashtag") L.push(`MERGE (:Hashtag {tag: ${cy(n.id.replace(/^#/, ""))}});`)
    else
      L.push(
        `MERGE (a:Account {username: ${cy(n.id)}}) SET a.analyzed = ${n.kind === "analyzed"}, a.shared = ${n.shared};`
      )
  }
  for (const e of g.edges) {
    const rel = REL[e.kind] ?? "RELATED"
    const tgt = e.kind === "uses" ? `(t:Hashtag {tag: ${cy(e.target.replace(/^#/, ""))}})` : `(t:Account {username: ${cy(e.target)}})`
    L.push(
      `MATCH (s:Account {username: ${cy(e.source)}}), ${tgt} MERGE (s)-[r:${rel}]->(t) SET r.weight = ${e.weight}, r.kind = ${cy(e.kind)};`
    )
  }
  return L.join("\n") + "\n"
}

export function nodeLink(g: GraphModel) {
  return {
    directed: true,
    multigraph: false,
    graph: { generator: "OSINT-IG", exportedAt: new Date().toISOString() },
    nodes: g.nodes.map((n) => ({ id: n.id, kind: n.kind, shared: n.shared, weight: n.weight, sources: n.sources })),
    links: g.edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind, weight: e.weight })),
  }
}

export function downloadText(name: string, text: string, type = "text/plain") {
  const blob = new Blob([text], { type: `${type};charset=utf-8` })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function downloadDataUrl(name: string, url: string) {
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
}
