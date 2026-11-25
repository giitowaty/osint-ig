/*
 * Testy kolejki kont (runQueue): kolejność, błędy, limit 429, ponawianie przy
 * problemach z połączeniem, wstrzymanie/wznowienie/anulowanie oraz automatyczna
 * analiza obserwujących. Prawdziwe są store i actions; mockujemy tylko klienta
 * API (streamJob) i zapis na dysk. Zegar jest sztuczny, więc pauzy mijają od razu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ApiErrorBody, FollowersPage, ProfilePayload } from "./types"

/** Zaplanowana odpowiedź API dla jednego wywołania. */
type Reply =
  | { ok: true }
  | { error: Partial<ApiErrorBody> & { code: string } }
  | { hang: true } // czeka, aż zadanie zostanie anulowane
  | { page: Omit<FollowersPage, "ok"> }

const plan = new Map<string, Reply[]>() // klucz: nazwa konta albo "page:<cursor>"
const calls: string[] = []
/** Ciasteczka konta użyte przy kolejnych zapytaniach ("anon" = bez sesji). */
const cookies: string[] = []

vi.mock("./persist", () => ({ flushSaved: vi.fn(async () => true) }))
vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>()
  const cancelled = () => new real.AppError({ code: "CANCELLED", origin: "client", message: "Anulowano." })
  return {
    ...real,
    streamJob: vi.fn(async (path: string, opts: { signal?: AbortSignal; session?: string }) => {
      const url = new URL(path, "http://test")
      const isPage = url.pathname === "/api/followers/page"
      const key = isPage ? `page:${url.searchParams.get("cursor") ?? ""}` : url.searchParams.get("username")!
      calls.push(isPage ? key : `${key}${url.searchParams.get("userId") ? `#${url.searchParams.get("userId")}` : ""}`)
      cookies.push(opts.session ?? "anon")
      const reply = plan.get(key)?.shift() ?? { ok: true }
      if (opts.signal?.aborted) throw cancelled()
      if ("hang" in reply) {
        return new Promise((_, reject) => opts.signal?.addEventListener("abort", () => reject(cancelled())))
      }
      if ("error" in reply) throw new real.AppError({ origin: "server", message: reply.error.code, ...reply.error })
      if ("page" in reply) return { ok: true, ...reply.page }
      return { profile: { username: key }, posts: [] } as unknown as ProfilePayload
    }),
  }
})

let actions: typeof import("./actions")
let store: typeof import("./store")

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })
  vi.resetModules()
  plan.clear()
  calls.length = 0
  cookies.length = 0
  store = await import("./store")
  actions = await import("./actions")
  store.patchQueue({ delayMs: 1000 }) // pauza między kontami: 0,7–1,3 s
})

afterEach(() => {
  actions.clearQueue()
  vi.useRealTimers()
})

const q = () => store.getState().queue
const profile = (u: string) => store.getState().profiles[u]
/** Przesuwa sztuczny zegar (i obsługuje oczekujące obietnice). */
const run = (ms: number) => vi.advanceTimersByTimeAsync(ms)

describe("kolejka kont", () => {
  it("analizuje konta po kolei, z pauzą między nimi, i kończy pracę", async () => {
    expect(actions.enqueue("alpha, @beta https://instagram.com/gamma/")).toBe(3)
    await run(0)
    expect(calls).toEqual(["alpha"]) // drugie konto czeka na pauzę
    await run(10_000)
    expect(calls).toEqual(["alpha", "beta", "gamma"])
    expect(q()).toMatchObject({ items: [], done: 3, failed: [], running: false, paused: false })
    expect(["alpha", "beta", "gamma"].map((u) => profile(u).status)).toEqual(["ready", "ready", "ready"])
  })

  it("pomija duplikaty i konta już przeanalizowane, chyba że fresh", async () => {
    expect(actions.enqueue(["alpha", "ALPHA", "@alpha"])).toBe(1)
    expect(actions.enqueue(["alpha"])).toBe(0) // już czeka w kolejce
    expect(q().items).toEqual(["alpha"])
    await run(5_000)
    expect(actions.enqueue(["alpha", "alpha"])).toBe(0)
    expect(actions.enqueue(["alpha"], { fresh: true })).toBe(1)
    await run(5_000)
    expect(calls).toEqual(["alpha", "alpha"])
  })

  it("trwały błąd konta trafia do nieudanych, a kolejka idzie dalej; retryFailed go ponawia", async () => {
    plan.set("alpha", [{ error: { code: "IG_NOT_FOUND", status: 404 } }])
    actions.enqueue(["alpha", "beta"])
    await run(10_000)
    expect(q()).toMatchObject({ items: [], done: 2, failed: ["alpha"], running: false })
    expect(profile("alpha").error?.code).toBe("IG_NOT_FOUND")

    expect(actions.retryFailed()).toBe(1)
    await run(10_000)
    expect(q()).toMatchObject({ done: 2, failed: [] }) // ponowienie zastępuje wynik, nie zwiększa sumy
    expect(profile("alpha").status).toBe("ready")
  })

  it("przy limicie 429 konto zostaje na początku i jest ponawiane dopiero po blokadzie", async () => {
    plan.set("alpha", [{ error: { code: "IG_RATE_LIMITED", status: 429, retryAfterMs: 20_000 } }])
    actions.enqueue(["alpha", "beta"])
    await run(0)
    expect(q()).toMatchObject({ items: ["alpha", "beta"], waitReason: "limit Instagrama" })
    await run(19_000)
    expect(calls).toEqual(["alpha"]) // w trakcie blokady żadnych zapytań
    await run(10_000)
    expect(calls).toEqual(["alpha", "alpha", "beta"])
    expect(q()).toMatchObject({ items: [], done: 2, failed: [] })
  })

  it("problem z połączeniem: 3 ponowienia z rosnącą pauzą, potem wstrzymanie bez utraty konta", async () => {
    const down = { error: { code: "SERVER_UNREACHABLE" } }
    plan.set("alpha", [down, down, down, down])
    actions.enqueue(["alpha"])
    await run(0)
    expect(calls).toHaveLength(1)
    await run(5_000) // 1. ponowienie po 5 s
    expect(calls).toHaveLength(2)
    await run(10_000) // 2. po 10 s
    expect(calls).toHaveLength(3)
    await run(20_000) // 3. po 20 s
    expect(calls).toHaveLength(4)
    await run(60_000)
    expect(calls).toHaveLength(4)
    expect(q()).toMatchObject({ items: ["alpha"], paused: true, running: false, done: 0 })

    plan.set("alpha", [{ ok: true }])
    actions.resumeQueue()
    await run(1_000)
    expect(q()).toMatchObject({ items: [], done: 1, paused: false })
  })

  it("odrzucona sesja wstrzymuje kolejkę i nie liczy konta jako zrobionego", async () => {
    plan.set("alpha", [{ error: { code: "IG_SESSION_INVALID", status: 401 } }])
    actions.enqueue(["alpha", "beta"])
    await run(10_000)
    expect(calls).toEqual(["alpha"])
    expect(q()).toMatchObject({ items: ["alpha", "beta"], paused: true, done: 0, failed: [] })
  })

  it("wstrzymanie przerywa trwające zapytanie; wznowienie analizuje konto od nowa", async () => {
    plan.set("alpha", [{ hang: true }])
    actions.enqueue(["alpha", "beta"])
    await run(0)
    expect(profile("alpha").status).toBe("loading")

    actions.pauseQueue()
    await run(1_000)
    expect(q()).toMatchObject({ items: ["alpha", "beta"], paused: true, running: false, done: 0 })
    expect(profile("alpha")).toMatchObject({ status: "error", error: { code: "CANCELLED" } })

    actions.resumeQueue()
    await run(10_000)
    expect(calls).toEqual(["alpha", "alpha", "beta"])
    expect(q()).toMatchObject({ items: [], done: 2, failed: [] })
  })

  it("anulowanie zadania w panelu aktywności wstrzymuje kolejkę zamiast liczyć konto jako zrobione", async () => {
    plan.set("alpha", [{ hang: true }])
    actions.enqueue(["alpha", "beta"])
    await run(0)
    store.cancelJob(profile("alpha").jobId!)
    await run(5_000)
    expect(calls).toEqual(["alpha"])
    expect(q()).toMatchObject({ items: ["alpha", "beta"], paused: true, done: 0, failed: [] })
    expect(profile("alpha").error?.code).toBe("CANCELLED")
  })

  it("anulowanie ponownej analizy przywraca wcześniejszy wynik profilu", async () => {
    actions.enqueue(["alpha"])
    await run(5_000)
    plan.set("alpha", [{ hang: true }])
    actions.enqueue(["alpha"], { fresh: true })
    await run(0)
    actions.pauseQueue()
    await run(1_000)
    expect(profile("alpha")).toMatchObject({ status: "ready", error: undefined })
  })

  it("wyczyszczenie kolejki przerywa pracę i nie wysyła kolejnych zapytań", async () => {
    plan.set("alpha", [{ hang: true }])
    actions.enqueue(["alpha", "beta", "gamma"])
    await run(0)
    actions.clearQueue()
    await run(30_000)
    expect(calls).toEqual(["alpha"])
    expect(q()).toMatchObject({ items: [], done: 0, running: false, paused: false })
  })

  it("gdy zapis postępu nie działa, kolejka nie wysyła kolejnych zapytań", async () => {
    const persist = await import("./persist")
    vi.mocked(persist.flushSaved).mockResolvedValueOnce(false)
    store.setState({ hydrated: true })
    actions.enqueue(["alpha", "beta"])
    await run(10_000)
    expect(calls).toEqual(["alpha"])
    expect(q()).toMatchObject({ items: ["beta"], done: 1, running: false })
  })
})

describe("analiza obserwujących", () => {
  async function openSource() {
    store.setSession({ cookie: "sessionid=1%3Atest", account: "me" })
    store.patchProfile("src", {
      status: "ready",
      data: { profile: { username: "src", id: "100", private: false, followers: 3 }, posts: [] } as unknown as ProfilePayload,
    })
  }

  it("pobiera strony listy, analizuje obserwujących z ich ID i kończy na ostatniej stronie", async () => {
    await openSource()
    plan.set("page:", [{ page: { username: "src", userId: "100", users: [{ username: "a1", id: "11" }, { username: "a2", id: "12" }], nextCursor: "c2", limited: false } }])
    plan.set("page:c2", [{ page: { username: "src", userId: "100", users: [{ username: "a3", id: "13" }], nextCursor: null, limited: false } }])

    expect(actions.analyzeFollowers("src")).toBe(true)
    await run(30_000)
    expect(calls).toEqual(["page:", "a1#11", "a2#12", "page:c2", "a3#13"])
    expect(q()).toMatchObject({ items: [], done: 3, running: false, followersSource: { discovered: 3, complete: true } })
    expect(profile("src").followers).toEqual(["a1", "a2", "a3"])
  })

  it("respektuje limit kont", async () => {
    await openSource()
    plan.set("page:", [{ page: { username: "src", userId: "100", users: [{ username: "a1", id: "11" }, { username: "a2", id: "12" }], nextCursor: "c2", limited: false } }])
    actions.analyzeFollowers("src", 1)
    await run(30_000)
    expect(calls).toEqual(["page:", "a1#11"])
    expect(q().followersSource).toMatchObject({ discovered: 1, complete: true })
  })

  it("wstrzymuje się, gdy Instagram nie przesuwa kursora listy", async () => {
    await openSource()
    plan.set("page:", [{ page: { username: "src", userId: "100", users: [], nextCursor: "c1", limited: false } }])
    actions.analyzeFollowers("src")
    await run(30_000)
    expect(q()).toMatchObject({ paused: true, followersSource: { complete: false, error: { code: "BAD_RESPONSE" } } })
  })

  it("bez połączonej sesji nie startuje", async () => {
    store.patchProfile("src", {
      status: "ready",
      data: { profile: { username: "src", id: "100", private: false }, posts: [] } as unknown as ProfilePayload,
    })
    expect(actions.analyzeFollowers("src")).toBe(false)
    expect(calls).toEqual([])
  })

  it("działa z kontem, które nie jest pierwsze w puli (pusty pierwszy slot)", async () => {
    store.addSessionSlot() // pusty slot na pozycji 0
    const id = store.addSessionSlot()
    store.patchSessionEntry(id, { cookie: "sessionid=2%3Atest", account: "second" })
    store.patchProfile("src", {
      status: "ready",
      data: { profile: { username: "src", id: "100", private: false }, posts: [] } as unknown as ProfilePayload,
    })
    plan.set("page:", [{ page: { username: "src", userId: "100", users: [{ username: "a1", id: "11" }], nextCursor: null, limited: false } }])
    expect(actions.analyzeFollowers("src")).toBe(true)
    await run(10_000)
    expect(calls).toEqual(["page:", "a1#11"])
  })
})

describe("dzienny limit operacji na konto", () => {
  const addAccount = (cookie: string, account: string) => {
    const id = store.addSessionSlot()
    store.patchSessionEntry(id, { cookie, account })
    return id
  }

  it("po wyczerpaniu limitu kolejka się wstrzymuje, a nieprzetworzone konta zostają w kolejce", async () => {
    addAccount("sessionid=1%3Aa", "pomocnicze")
    store.setDailyLimit(2)
    actions.enqueue(["a", "b", "c", "d"])
    await run(60_000)
    expect(calls).toEqual(["a", "b"]) // trzecia operacja nie wychodzi do Instagrama
    expect(q()).toMatchObject({ items: ["c", "d"], done: 2, paused: true, running: false })
    expect(profile("c")).toMatchObject({ status: "error", error: { code: "DAILY_LIMIT" } })
    expect(profile("c").error?.hint).toMatch(/północy/)
  })

  it("limit liczy się osobno na konto: praca przechodzi na drugie konto, a gdy oba są wyczerpane — staje", async () => {
    addAccount("sessionid=1%3Aa", "pierwsze")
    addAccount("sessionid=2%3Ab", "drugie")
    store.setDailyLimit(2)
    actions.enqueue(["a", "b", "c", "d", "e"])
    await run(120_000)
    expect(calls).toEqual(["a", "b", "c", "d"])
    const used = (c: string) => cookies.filter((x) => x === c).length
    expect(used("sessionid=1%3Aa")).toBe(2)
    expect(used("sessionid=2%3Ab")).toBe(2)
    expect(q()).toMatchObject({ items: ["e"], done: 4, paused: true })
  })

  it("konto, które wyczerpało limit, jest pomijane, dopóki drugie ma zapas", async () => {
    const first = addAccount("sessionid=1%3Aa", "pierwsze")
    addAccount("sessionid=2%3Ab", "drugie")
    store.setDailyLimit(3)
    // pierwsze konto ma już wykorzystany cały dzisiejszy limit
    const today = (() => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })()
    store.setState({ usage: { [first]: { day: today, count: 3 } } })
    actions.enqueue(["a", "b"])
    await run(60_000)
    expect(cookies).toEqual(["sessionid=2%3Ab", "sessionid=2%3Ab"])
    expect(q()).toMatchObject({ items: [], done: 2, paused: false })
  })

  it("limit 0 = bez limitu", async () => {
    addAccount("sessionid=1%3Aa", "pomocnicze")
    store.setDailyLimit(0)
    actions.enqueue(["a", "b", "c", "d", "e"])
    await run(120_000)
    expect(calls).toHaveLength(5)
    expect(q()).toMatchObject({ items: [], done: 5, paused: false })
  })

  it("praca anonimowa (pusta pula) nie podlega limitowi — nic nie jest zliczane", async () => {
    store.setDailyLimit(1)
    actions.enqueue(["a", "b", "c"])
    await run(60_000)
    expect(calls).toEqual(["a", "b", "c"])
    expect(cookies).toEqual(["anon", "anon", "anon"])
    expect(store.getState().usage).toEqual({})
  })

  it("pojedyncza analiza z pola wyszukiwania też respektuje limit i nie przechodzi po cichu na tryb anonimowy", async () => {
    addAccount("sessionid=1%3Aa", "pomocnicze")
    store.setDailyLimit(1)
    await actions.analyze("jeden")
    await actions.analyze("dwa")
    expect(calls).toEqual(["jeden"])
    expect(profile("dwa")).toMatchObject({ status: "error", error: { code: "DAILY_LIMIT" } })
    expect(cookies).toEqual(["sessionid=1%3Aa"]) // żadnego zapytania bez sesji
  })

  it("po północy licznik się zeruje i wznowiona kolejka kończy pracę", async () => {
    vi.setSystemTime(new Date(2026, 10, 25, 23, 59, 30))
    addAccount("sessionid=1%3Aa", "pomocnicze")
    store.setDailyLimit(1)
    actions.enqueue(["a", "b"])
    await run(5_000)
    expect(calls).toEqual(["a"])
    expect(q()).toMatchObject({ items: ["b"], paused: true })

    vi.setSystemTime(new Date(2026, 10, 26, 0, 0, 30))
    actions.resumeQueue()
    await run(5_000)
    expect(calls).toEqual(["a", "b"])
    expect(q()).toMatchObject({ items: [], done: 2, paused: false })
  })

  it("zwiększenie limitu w trakcie pozwala wznowić pracę tego samego dnia", async () => {
    addAccount("sessionid=1%3Aa", "pomocnicze")
    store.setDailyLimit(1)
    actions.enqueue(["a", "b"])
    await run(5_000)
    expect(q()).toMatchObject({ items: ["b"], paused: true })
    store.setDailyLimit(10)
    actions.resumeQueue()
    await run(5_000)
    expect(q()).toMatchObject({ items: [], done: 2, paused: false })
  })

  it("analiza obserwujących: strona listy liczy się jako operacja, a wyczerpany limit wstrzymuje analizę z jasnym błędem", async () => {
    addAccount("sessionid=1%3Aa", "pomocnicze")
    store.setDailyLimit(1)
    store.patchProfile("src", {
      status: "ready",
      data: { profile: { username: "src", id: "100", private: false, followers: 3 }, posts: [] } as unknown as ProfilePayload,
    })
    plan.set("page:", [{ page: { username: "src", userId: "100", users: [{ username: "a1", id: "11" }], nextCursor: null, limited: false } }])
    expect(actions.analyzeFollowers("src")).toBe(true)
    await run(30_000)
    expect(calls).toEqual(["page:"]) // a1 nie został wysłany: limit (1) poszedł na pobranie strony
    expect(q()).toMatchObject({ items: ["a1"], paused: true, followersSource: { error: { code: "DAILY_LIMIT" } } })
  })

  it("analiza obserwujących: gdy limit jest już wyczerpany, nawet pobranie strony listy nie wychodzi do Instagrama", async () => {
    addAccount("sessionid=1%3Aa", "pomocnicze")
    store.setDailyLimit(1)
    await actions.analyze("zuzyte") // jedyna dozwolona operacja
    store.patchProfile("src", {
      status: "ready",
      data: { profile: { username: "src", id: "100", private: false, followers: 3 }, posts: [] } as unknown as ProfilePayload,
    })
    expect(actions.analyzeFollowers("src")).toBe(true)
    await run(30_000)
    expect(calls).toEqual(["zuzyte"]) // ani strony listy, ani kont
    expect(cookies).toEqual(["sessionid=1%3Aa"])
    expect(q()).toMatchObject({ paused: true, followersSource: { complete: false, error: { code: "DAILY_LIMIT" } } })
  })

  it("licznik przenosi się, gdy konto zmienia identyfikator po weryfikacji (tymczasowy → ID z Instagrama)", async () => {
    const id = addAccount("sessionid=1%3Aa", "pomocnicze")
    await actions.analyze("a")
    await actions.analyze("b")
    expect(store.usageToday(id)).toBe(2)
    store.patchSessionEntry(id, { meta: { names: ["sessionid"], userId: "424242" } })
    expect(store.usageToday("424242")).toBe(2)
    expect(store.usageToday(id)).toBe(0)
  })
})

describe("tempo kolejki", () => {
  it("pauza między kontami wynika z ustawionego tempa (z rozrzutem ±30%)", async () => {
    store.patchQueue({ delayMs: 20_000 })
    actions.enqueue(["a", "b"])
    await run(13_000) // poniżej minimum (14 s)
    expect(calls).toEqual(["a"])
    await run(14_000) // razem 27 s: powyżej maksimum (26 s)
    expect(calls).toEqual(["a", "b"])
  })

  it("rozrzut ±30%: najkrótsza pauza to 70%, a najdłuższa 130% ustawionego tempa", async () => {
    const rnd = vi.spyOn(Math, "random")
    try {
      rnd.mockReturnValue(0) // najkrótsza: 14 s
      store.patchQueue({ delayMs: 20_000 })
      actions.enqueue(["a", "b"])
      await run(13_500)
      expect(calls).toEqual(["a"])
      await run(1_000)
      expect(calls).toEqual(["a", "b"])

      actions.clearQueue()
      calls.length = 0
      store.patchProfile("a", { status: "error" }) // pozwól przeanalizować od nowa
      store.patchProfile("b", { status: "error" })
      rnd.mockReturnValue(1) // najdłuższa: 26 s
      store.patchQueue({ delayMs: 20_000 })
      actions.enqueue(["a", "b"])
      await run(25_000)
      expect(calls).toEqual(["a"])
      await run(1_500)
      expect(calls).toEqual(["a", "b"])
    } finally {
      rnd.mockRestore()
    }
  })

  it("szybkie tempo faktycznie przyspiesza kolejkę", async () => {
    store.patchQueue({ delayMs: 2_000 })
    actions.enqueue(["a", "b", "c", "d"])
    await run(10_000) // 3 pauzy po max 2,6 s
    expect(calls).toEqual(["a", "b", "c", "d"])
  })
})

describe("zapis ustawień tempa i limitu", () => {
  const memory = () => {
    const m = new Map<string, string>()
    return { m, ls: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } }
  }
  afterEach(() => { vi.unstubAllGlobals() })

  it("limit i tempo wracają po restarcie aplikacji", async () => {
    const { ls } = memory()
    vi.stubGlobal("localStorage", ls)
    vi.resetModules()
    const s1 = await import("./store")
    s1.setDailyLimit(42)
    s1.patchQueue({ delayMs: 12_000 })
    vi.resetModules()
    const s2 = await import("./store")
    expect(s2.getState().dailyLimit).toBe(42)
    expect(s2.getState().queue.delayMs).toBe(12_000)
  })

  it("brak lub uszkodzony zapis limitu = wartość domyślna, a nie „bez limitu”", async () => {
    for (const stored of [undefined, "abc", "", "-3"]) {
      const { m, ls } = memory()
      if (stored !== undefined) m.set("osint-ig-daily-limit", stored)
      vi.stubGlobal("localStorage", ls)
      vi.resetModules()
      const s = await import("./store")
      expect(s.getState().dailyLimit).toBe(300)
    }
  })

  it("zapisany 0 oznacza świadomy wybór „bez limitu”", async () => {
    const { m, ls } = memory()
    m.set("osint-ig-daily-limit", "0")
    vi.stubGlobal("localStorage", ls)
    vi.resetModules()
    expect((await import("./store")).getState().dailyLimit).toBe(0)
  })

  it("zapisane tempo spoza zakresu jest przycinane (np. po zmianie wersji)", async () => {
    const { m, ls } = memory()
    m.set("osint-ig-queue-delay", "999999999")
    vi.stubGlobal("localStorage", ls)
    vi.resetModules()
    expect((await import("./store")).getState().queue.delayMs).toBe(120_000)
  })

  it("liczniki z dzisiaj przeżywają restart, a z wczoraj są odrzucane", async () => {
    const { m, ls } = memory()
    vi.stubGlobal("localStorage", ls)
    vi.resetModules()
    const s1 = await import("./store")
    const id = s1.addSessionSlot()
    s1.patchSessionEntry(id, { cookie: "sessionid=1%3Aa", account: "x" })
    s1.acquireSession("p1")
    s1.acquireSession("p2")
    vi.resetModules()
    const s2 = await import("./store")
    expect(s2.usageToday(id)).toBe(2)

    m.set("osint-ig-usage", JSON.stringify({ [id]: { day: "2001-01-01", count: 999 } }))
    vi.resetModules()
    expect((await import("./store")).usageToday(id)).toBe(0)
  })
})
