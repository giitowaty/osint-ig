import { describe, expect, it } from "vitest"

import { buildQuad, integrate, MAX_STEP, repel, type SimNode } from "./force-graph"

/** Węzły ciasno wokół jednego punktu — jak nowe konta stawiane przy profilu źródłowym. */
function cluster(count: number, spread: number): SimNode[] {
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`, kind: "account", weight: 1, shared: false, sources: [],
    x: (rnd() - 0.5) * spread, y: (rnd() - 0.5) * spread, vx: 0, vy: 0, r: 5, fixed: false, degree: 1,
  }) as unknown as SimNode)
}

function simulate(nodes: SimNode[], steps: number) {
  let alpha = 1
  for (let s = 0; s < steps; s++) {
    const root = buildQuad(nodes)!
    for (const n of nodes) repel(root, n, 900 * alpha, 0.81)
    for (const n of nodes) {
      n.vx -= n.x * 0.015 * alpha
      n.vy -= n.y * 0.015 * alpha
      n.vx *= 0.55
      n.vy *= 0.55
      integrate(n)
    }
    alpha *= 0.985
  }
}

describe("symulacja grafu — stabilność", () => {
  it("ciasno upakowane węzły rozsuwają się bez wybuchu (graf nie znika z ekranu)", () => {
    const nodes = cluster(150, 1) // 150 węzłów w kwadracie 1×1 px
    simulate(nodes, 300)
    for (const n of nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true)
      expect(Math.hypot(n.x, n.y)).toBeLessThan(3000)
    }
    // i faktycznie się rozsunęły
    const xs = nodes.map((n) => n.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(100)
  })

  it("pojedyncze odepchnięcie bliskich węzłów jest ograniczone", () => {
    const [a, b] = cluster(2, 0)
    a.x = 0; a.y = 0; b.x = 0.1; b.y = 0
    repel(buildQuad([a, b])!, a, 900, 0.81)
    integrate(a)
    expect(Math.hypot(a.x, a.y)).toBeLessThanOrEqual(MAX_STEP + 1e-9)
  })

  it("węzły w dokładnie tym samym punkcie też się rozdzielają", () => {
    const nodes = cluster(5, 0)
    simulate(nodes, 50)
    const distinct = new Set(nodes.map((n) => `${Math.round(n.x)}:${Math.round(n.y)}`))
    expect(distinct.size).toBe(5)
  })

  it("węzeł z niepoprawną pozycją wraca w pobliże środka", () => {
    const n = { x: Infinity, y: NaN, vx: 5, vy: 5 }
    integrate(n)
    expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true)
    expect(Math.hypot(n.x, n.y)).toBeLessThan(100)
  })
})
