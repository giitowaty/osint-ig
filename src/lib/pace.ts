/*
 * Tempo pracy i dzienny limit operacji na konto.
 *
 * Instagram odpowiada limitem (429) na zbyt gęste zapytania z jednego konta.
 * Dwa pokrętła zmniejszają ryzyko bez żadnych sztuczek: wolniejsze tempo
 * (suwak) i górny pułap operacji na konto na dobę (limit). Liczone lokalnie,
 * na urządzeniu użytkownika.
 *
 * „Operacja” = jedna analiza profilu albo jedna strona listy obserwujących.
 * Pojedyncza operacja to 1–4 zapytań HTTP do Instagrama (np. fallback GraphQL).
 */

/** Zakres pauzy między kontami (ms). */
export const TEMPO_MIN_MS = 2_000
export const TEMPO_MAX_MS = 120_000
export const TEMPO_DEFAULT_MS = 5_000

/** Domyślny limit operacji na konto na dobę; 0 = bez limitu. */
export const DAILY_LIMIT_DEFAULT = 300
export const DAILY_LIMIT_MAX = 100_000

/** Pozycja suwaka 0–100 → pauza w ms. Skala logarytmiczna: gęsto przy krótkich pauzach, gdzie różnica liczy się najbardziej. */
export function tempoFromPosition(position: number): number {
  const p = Math.min(100, Math.max(0, position)) / 100
  const ms = TEMPO_MIN_MS * (TEMPO_MAX_MS / TEMPO_MIN_MS) ** p
  return roundTempo(ms)
}

/** Odwrotność tempoFromPosition (pozycja suwaka dla zapisanej pauzy). */
export function positionFromTempo(ms: number): number {
  const clamped = Math.min(TEMPO_MAX_MS, Math.max(TEMPO_MIN_MS, ms))
  return Math.round((Math.log(clamped / TEMPO_MIN_MS) / Math.log(TEMPO_MAX_MS / TEMPO_MIN_MS)) * 100)
}

/** Zaokrągla do „ładnych” wartości: 0,5 s do 10 s, potem 1 s, od 30 s co 5 s. */
export function roundTempo(ms: number): number {
  const step = ms < 10_000 ? 500 : ms < 30_000 ? 1_000 : 5_000
  return Math.min(TEMPO_MAX_MS, Math.max(TEMPO_MIN_MS, Math.round(ms / step) * step))
}

/** Pauza z losowym rozrzutem ±spread (domyślnie 30%): równe odstępy wyglądają na automat. */
export function jitter(ms: number, spread = 0.3, random: () => number = Math.random): number {
  return Math.round(ms * (1 - spread + random() * spread * 2))
}

export type TempoLevel = "fast" | "normal" | "careful"

export interface TempoInfo {
  level: TempoLevel
  /** „5 s”, „1 min 30 s”… */
  label: string
  /** Ile kont na minutę przy średniej pauzie (czas samego pobierania nie wlicza się). */
  perMinute: number
  advice: string
}

/** Pauza w czytelnej postaci: „5 s”, „1,5 s”, „1 min 30 s”. */
export function formatPause(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${Number.isInteger(s) ? s : s.toLocaleString("pl-PL")} s`
  const min = Math.floor(s / 60)
  const rest = Math.round(s - min * 60)
  return rest ? `${min} min ${rest} s` : `${min} min`
}

export function describeTempo(ms: number): TempoInfo {
  const perMinute = Math.round((60_000 / ms) * 10) / 10
  const level: TempoLevel = ms < 4_000 ? "fast" : ms < 10_000 ? "normal" : "careful"
  const advice =
    level === "fast"
      ? "Szybko: Instagram częściej odpowiada limitem, a po kilku limitach z rzędu konto zwykle trzeba odłożyć."
      : level === "normal"
        ? "Zrównoważone tempo dla jednego konta."
        : "Ostrożnie: najmniejsze ryzyko limitu, ale kolejka idzie wolno."
  return { level, label: formatPause(ms), perMinute, advice }
}

/* ------------------------------ Dzienny limit ------------------------------ */

export interface DayUsage {
  /** Doba lokalna, np. „2026-11-25”. */
  day: string
  count: number
}
export type UsageMap = Record<string, DayUsage>

/** Klucz doby w czasie lokalnym użytkownika (licznik zeruje się o północy lokalnej). */
export function dayKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

/** Ile operacji konto wykonało dziś (wpis z poprzedniej doby = 0). */
export function usedToday(usage: UsageMap, id: string, today: string): number {
  const u = usage[id]
  return u && u.day === today ? u.count : 0
}

/** Czy konto osiągnęło limit (0 = bez limitu). */
export function atLimit(count: number, limit: number): boolean {
  return limit > 0 && count >= limit
}

/** Nowa mapa z doliczoną jedną operacją; wpisy z poprzednich dób są wymiatane. */
export function withUse(usage: UsageMap, id: string, today: string): UsageMap {
  const next: UsageMap = {}
  for (const [k, v] of Object.entries(usage)) if (v.day === today) next[k] = v
  next[id] = { day: today, count: usedToday(usage, id, today) + 1 }
  return next
}

/** Przenosi licznik, gdy konto zmienia identyfikator (tymczasowy → ID z Instagrama). */
export function renameUsage(usage: UsageMap, from: string, to: string): UsageMap {
  if (from === to || !usage[from]) return usage
  const { [from]: moved, ...rest } = usage
  const existing = rest[to]
  return { ...rest, [to]: existing && existing.day === moved.day ? { day: moved.day, count: existing.count + moved.count } : moved }
}

/** Ile ms do północy lokalnej, kiedy liczniki się zerują. */
export function msToMidnight(now: Date): number {
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  return next.getTime() - now.getTime()
}

/**
 * Wartość pola „limit” → liczba całkowita 0…DAILY_LIMIT_MAX albo null, gdy to nie liczba.
 * Puste pole jest niepoprawne (null), a nie „0 = bez limitu”: wyczyszczenie pola przed
 * wpisaniem nowej wartości nie może po cichu wyłączać zabezpieczenia.
 */
export function parseLimit(raw: string | number): number | null {
  if (typeof raw === "string" && raw.trim() === "") return null
  const n = typeof raw === "number" ? raw : Number(raw.trim().replace(",", "."))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(DAILY_LIMIT_MAX, Math.floor(n))
}

/** „za 3 godz. 20 min”, „za 25 min” — do komunikatu o wznowieniu po północy. */
export function formatWait(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h ? `${h} godz.${m ? ` ${m} min` : ""}` : `${m} min`
}
