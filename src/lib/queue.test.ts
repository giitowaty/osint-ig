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

vi.mock("./persist", () => ({ flushSaved: vi.fn(async () => true) }))
vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>()
  const cancelled = () => new real.AppError({ code: "CANCELLED", origin: "client", message: "Anulowano." })
  return {
    ...real,
    streamJob: vi.fn(async (path: string, opts: { signal?: AbortSignal }) => {
      const url = new URL(path, "http://test")
      const isPage = url.pathname === "/api/followers/page"
      const key = isPage ? `page:${url.searchParams.get("cursor") ?? ""}` : url.searchParams.get("username")!
      calls.push(isPage ? key : `${key}${url.searchParams.get("userId") ? `#${url.searchParams.get("userId")}` : ""}`)
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
