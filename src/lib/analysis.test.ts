import { describe, expect, it } from "vitest"

import { FOLLOWER_SAMPLE_MIN, followerGender } from "./analysis"
import type { FollowerPerson } from "./types"

const people = (f: number, m: number, u: number): Record<string, FollowerPerson> => {
  const out: Record<string, FollowerPerson> = {}
  let i = 0
  for (const [n, gender] of [[f, "female"], [m, "male"], [u, "unknown"]] as const) {
    for (let k = 0; k < n; k++) out[`konto_${i++}`] = { fullName: gender === "unknown" ? "" : `Imię ${k}`, gender, confidence: gender === "unknown" ? 0 : 0.9 }
  }
  return out
}

describe("płeć obserwujących z pobranej listy", () => {
  it("liczy rozkład z całej listy", () => {
    const a = followerGender(people(30, 20, 50))!
    expect(a).toMatchObject({ available: true, sampleSize: 100, female: 30, male: 20, unknown: 50 })
  })

  it("za mała lista: brak szacunku (zamiast mylącego wyniku z kilku osób)", () => {
    expect(followerGender(people(5, 5, 5))).toBeNull()
    expect(followerGender(undefined)).toBeNull()
    expect(followerGender(people(FOLLOWER_SAMPLE_MIN, 0, 0))).not.toBeNull()
  })

  it("próbka do weryfikacji: najpierw osoby z rozpoznaną płcią, najwyżej 80", () => {
    const a = followerGender(people(10, 10, 200))!
    expect(a.sample).toHaveLength(80)
    expect(a.sample!.slice(0, 20).every((s) => s.gender !== "unknown")).toBe(true)
  })
})

describe("odmiana liczebników", () => {
  it("1 link, 2–4 linki, 5+ linków, 12–14 linków, 22 linki", async () => {
    const { plural } = await import("./analysis")
    const f = (n: number) => `${n} ${plural(n, "link", "linki", "linków")}`
    expect([1, 2, 4, 5, 11, 12, 14, 22, 25, 102].map(f)).toEqual(
      ["1 link", "2 linki", "4 linki", "5 linków", "11 linków", "12 linków", "14 linków", "22 linki", "25 linków", "102 linki"])
  })
})
