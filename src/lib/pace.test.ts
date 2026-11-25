import { describe, expect, it } from "vitest"

import {
  atLimit, dayKey, describeTempo, formatPause, formatWait, jitter, msToMidnight, parseLimit, positionFromTempo,
  renameUsage, roundTempo, tempoFromPosition, TEMPO_MAX_MS, TEMPO_MIN_MS, usedToday, withUse, type UsageMap,
} from "./pace"

describe("suwak tempa", () => {
  it("końce suwaka to dokładnie minimum i maksimum", () => {
    expect(tempoFromPosition(0)).toBe(TEMPO_MIN_MS)
    expect(tempoFromPosition(100)).toBe(TEMPO_MAX_MS)
  })

  it("wartości spoza zakresu są przycinane, a skala rośnie monotonicznie", () => {
    expect(tempoFromPosition(-50)).toBe(TEMPO_MIN_MS)
    expect(tempoFromPosition(500)).toBe(TEMPO_MAX_MS)
    let prev = 0
    for (let p = 0; p <= 100; p++) {
      const ms = tempoFromPosition(p)
      expect(ms).toBeGreaterThanOrEqual(prev)
      prev = ms
    }
  })

  it("skala jest logarytmiczna: pierwsza połowa suwaka to krótkie pauzy (do ok. 15 s)", () => {
    expect(tempoFromPosition(50)).toBeLessThan(20_000)
    expect(tempoFromPosition(50)).toBeGreaterThan(10_000)
  })

  it("zapisana pauza wraca na to samo (±1) miejsce suwaka", () => {
    for (const ms of [2000, 5000, 10_000, 20_000, 45_000, 120_000]) {
      const back = tempoFromPosition(positionFromTempo(ms))
      expect(Math.abs(back - ms) / ms).toBeLessThan(0.1)
    }
    expect(positionFromTempo(1)).toBe(0) // poniżej zakresu
    expect(positionFromTempo(9_999_999)).toBe(100)
  })

  it("zaokrągla do ładnych wartości", () => {
    expect(roundTempo(5_230)).toBe(5_000)
    expect(roundTempo(5_300)).toBe(5_500)
    expect(roundTempo(12_400)).toBe(12_000)
    expect(roundTempo(47_000)).toBe(45_000)
    expect(roundTempo(100)).toBe(TEMPO_MIN_MS)
  })

  it("opis tempa: poziom ryzyka, kont na minutę i czytelna etykieta", () => {
    expect(describeTempo(2000)).toMatchObject({ level: "fast", perMinute: 30, label: "2 s" })
    expect(describeTempo(5000)).toMatchObject({ level: "normal", perMinute: 12 })
    expect(describeTempo(20_000)).toMatchObject({ level: "careful", perMinute: 3 })
    expect(describeTempo(2000).advice).toMatch(/limitem/)
    expect(formatPause(1500)).toBe("1,5 s")
    expect(formatPause(90_000)).toBe("1 min 30 s")
    expect(formatPause(120_000)).toBe("2 min")
  })

  it("rozrzut ±30% nigdy nie wychodzi poza zakres i faktycznie się zmienia", () => {
    expect(jitter(10_000, 0.3, () => 0)).toBe(7_000)
    expect(jitter(10_000, 0.3, () => 1)).toBe(13_000)
    expect(jitter(10_000, 0.3, () => 0.5)).toBe(10_000)
    const seen = new Set(Array.from({ length: 50 }, () => jitter(10_000)))
    expect(seen.size).toBeGreaterThan(10)
    for (const v of seen) { expect(v).toBeGreaterThanOrEqual(7_000); expect(v).toBeLessThanOrEqual(13_000) }
  })
})

describe("dzienny limit operacji", () => {
  const today = "2026-11-25"

  it("licznik rośnie o 1 na konto, a konta liczą się osobno", () => {
    let u: UsageMap = {}
    u = withUse(u, "a", today)
    u = withUse(u, "a", today)
    u = withUse(u, "b", today)
    expect(usedToday(u, "a", today)).toBe(2)
    expect(usedToday(u, "b", today)).toBe(1)
    expect(usedToday(u, "c", today)).toBe(0)
  })

  it("po północy licznik jest zerowany, a stare wpisy wymiatane", () => {
    const u = withUse(withUse({}, "a", "2026-11-24"), "b", "2026-11-24")
    expect(usedToday(u, "a", today)).toBe(0)
    const next = withUse(u, "a", today)
    expect(next).toEqual({ a: { day: today, count: 1 } })
  })

  it("limit: 0 = bez limitu; inaczej blokuje dokładnie przy osiągnięciu", () => {
    expect(atLimit(10_000, 0)).toBe(false)
    expect(atLimit(299, 300)).toBe(false)
    expect(atLimit(300, 300)).toBe(true)
    expect(atLimit(301, 300)).toBe(true)
  })

  it("zmiana identyfikatora konta zachowuje licznik (tymczasowy → ID z Instagrama)", () => {
    const u = withUse(withUse({}, "tmp-1", today), "tmp-1", today)
    const moved = renameUsage(u, "tmp-1", "12345")
    expect(moved).toEqual({ "12345": { day: today, count: 2 } })
    expect(renameUsage(moved, "x", "y")).toBe(moved) // nic do przeniesienia
    expect(renameUsage(moved, "12345", "12345")).toBe(moved)
  })

  it("zmiana identyfikatora na już liczone konto sumuje, ale nie miesza dób", () => {
    const sum = renameUsage({ a: { day: today, count: 3 }, b: { day: today, count: 4 } }, "a", "b")
    expect(sum).toEqual({ b: { day: today, count: 7 } })
    const stale = renameUsage({ a: { day: today, count: 3 }, b: { day: "2026-11-24", count: 9 } }, "a", "b")
    expect(stale).toEqual({ b: { day: today, count: 3 } })
  })

  it("klucz doby jest w czasie lokalnym i ma stałą długość", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05")
    expect(dayKey(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31")
  })

  it("czas do północy: po 23:00 zostaje godzina, o północy pełna doba", () => {
    expect(msToMidnight(new Date(2026, 10, 25, 23, 0, 0))).toBe(3_600_000)
    expect(msToMidnight(new Date(2026, 10, 25, 0, 0, 0))).toBe(86_400_000)
    expect(formatWait(3_600_000 + 20 * 60_000)).toBe("1 godz. 20 min")
    expect(formatWait(25 * 60_000)).toBe("25 min")
    expect(formatWait(1000)).toBe("1 min")
  })

  it("pole limitu: liczby całkowite od 0, przecinek dziesiętny i śmieci", () => {
    expect(parseLimit("300")).toBe(300)
    expect(parseLimit(" 0 ")).toBe(0)
    expect(parseLimit("12,9")).toBe(12)
    expect(parseLimit("")).toBeNull() // puste pole nie wyłącza limitu
    expect(parseLimit("   ")).toBeNull()
    expect(parseLimit("abc")).toBeNull()
    expect(parseLimit("-5")).toBeNull()
    expect(parseLimit("99999999999")).toBe(100_000)
  })
})
