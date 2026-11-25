import { describe, expect, it } from "vitest"

import { exportLayout as fullExportLayout } from "./png"

const px = (l: ReturnType<typeof fullExportLayout>) => ({ w: l.w * l.dpr, h: l.h * l.dpr })

describe("eksport całego grafu do PNG — rozmiar obrazu", () => {
  it("mały graf jest powiększany, żeby obraz nie był miniaturką", () => {
    const l = fullExportLayout({ x0: -100, y0: -80, x1: 100, y1: 80 })
    expect(l.view.k).toBe(2.5)
    expect(l.dpr).toBe(2)
    expect(px(l).w).toBeGreaterThanOrEqual(1000)
  })

  it("średni graf: skala 1:1 i podwójna gęstość pikseli", () => {
    const l = fullExportLayout({ x0: 0, y0: 0, x1: 2000, y1: 1200 })
    expect(l.view.k).toBe(1)
    expect(l.dpr).toBe(2)
  })

  it("cały graf mieści się w obrazie z marginesem", () => {
    const b = { x0: -731, y0: -402, x1: 958, y1: 611 }
    const l = fullExportLayout(b)
    const left = l.view.x + b.x0 * l.view.k
    const right = l.view.x + b.x1 * l.view.k
    const top = l.view.y + b.y0 * l.view.k
    const bottom = l.view.y + b.y1 * l.view.k
    expect(left).toBeGreaterThan(0)
    expect(top).toBeGreaterThan(0)
    expect(right).toBeLessThan(l.w)
    expect(bottom).toBeLessThan(l.h)
  })

  it("ogromny graf nie przekracza limitów płótna przeglądarki", () => {
    for (const b of [
      { x0: 0, y0: 0, x1: 40_000, y1: 30_000 },
      { x0: 0, y0: 0, x1: 100_000, y1: 500 },
      { x0: 0, y0: 0, x1: 9_000, y1: 9_000 },
    ]) {
      const { w, h } = px(fullExportLayout(b))
      expect(w).toBeLessThanOrEqual(8192)
      expect(h).toBeLessThanOrEqual(8192)
      expect(w * h).toBeLessThanOrEqual(32_000_000)
    }
  })

  it("przy przekroczeniu limitu najpierw obniża gęstość pikseli, a dopiero potem zmniejsza graf", () => {
    const l = fullExportLayout({ x0: 0, y0: 0, x1: 5000, y1: 3000 })
    expect(l.dpr).toBeLessThan(2)
    expect(l.view.k).toBe(1)
  })
})
