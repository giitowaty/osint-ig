import { describe, expect, it } from "vitest"

import { fitLabel, labelFontSize, pack, type Bubble } from "./bubble-chart"

const mono = (s: string) => s.length * 10 // każdy znak = 10 px

describe("podpisy bąbelków w eksporcie PNG", () => {
  it("krótki podpis zostaje bez zmian", () => {
    expect(fitLabel("@ola", 60, mono)).toBe("@ola")
  })

  it("za długi podpis jest skracany z wielokropkiem i mieści się w szerokości", () => {
    const out = fitLabel("@bardzo_dlugie_konto", 80, mono)
    expect(out.endsWith("…")).toBe(true)
    expect(mono(out)).toBeLessThanOrEqual(80)
    expect("@bardzo_dlugie_konto".startsWith(out.slice(0, -1))).toBe(true)
  })

  it("gdy nie mieszczą się nawet dwa znaki, podpisu nie ma", () => {
    expect(fitLabel("@konto", 20, mono)).toBe("")
  })
})

describe("rozmiar czcionki podpisu bąbelka", () => {
  it("krótka nazwa w dużym kole: preferowany rozmiar (bez powiększania ponad limit)", () => {
    expect(labelFontSize(60, 3)).toBe(14)
  })

  it("długa nazwa: czcionka maleje, aż cały tekst mieści się w kole", () => {
    const widthAt1 = 7 // np. „@studio_nova” ≈ 7 px przy czcionce 1 px
    const size = labelFontSize(40, widthAt1)
    expect(size).toBeLessThan(14)
    expect(size * widthAt1).toBeLessThanOrEqual(40 * 2 - 6 + 1e-9)
  })

  it("nie schodzi poniżej minimum czytelności (wtedy tekst zostanie skrócony)", () => {
    expect(labelFontSize(12, 20)).toBe(5.5)
  })
})

describe("układanie bąbelków", () => {
  it("po spakowaniu koła na siebie nie nachodzą", () => {
    let seed = 3
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const items: Bubble[] = Array.from({ length: 120 }, (_, i) => ({
      id: `k${i}`, value: 1, shared: false, sources: 1, kind: "account",
      r: 6 + Math.sqrt(rnd()) * 40, x: 0, y: 0,
    }))
    pack(items, 1100, 500)
    let worst = 0
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j]
        worst = Math.max(worst, a.r + b.r - Math.hypot(b.x - a.x, b.y - a.y))
      }
    expect(worst).toBeLessThan(1)
  })
})
