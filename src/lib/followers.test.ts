import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProfilePayload } from "./types"

const mocks = vi.hoisted(() => ({ streamJob: vi.fn() }))
vi.mock("./api", () => ({
  streamJob: mocks.streamJob, getHealth: vi.fn(),
  AppError: class extends Error {
    body: { code: string; message: string; retryAfterMs?: number }
    constructor(body: { code: string; message: string; retryAfterMs?: number }) { super(body.message); this.body = body }
  },
}))

const payload = (username: string, id = "123") => ({ ok: true, profile: { username, id, private: false, followers: 4 }, posts: [] }) as unknown as ProfilePayload

describe("automatic follower analysis", () => {
  beforeEach(() => { vi.resetModules(); mocks.streamJob.mockReset(); vi.useFakeTimers() })
  afterEach(async () => { const actions = await import("./actions"); actions.clearQueue(); await vi.runAllTimersAsync(); vi.useRealTimers() })

  async function setup() {
    const store = await import("./store")
    store.setSession({ cookie: "sessionid=synthetic" })
    store.patchProfile("source", { status: "ready", data: payload("source", "100") })
    store.patchQueue({ delayMs: 0 })
    return { store, actions: await import("./actions"), api: await import("./api") }
  }

  it("processes all pages sequentially, skips existing results, handles duplicate names and uses follower IDs without recursive lists", async () => {
    const { store, actions } = await setup()
    store.patchProfile("ready", { status: "ready", data: payload("ready") })
    store.setState({ autoLists: true })
    const calls: string[] = []
    mocks.streamJob.mockImplementation(async (path: string) => {
      const url = new URL(path, "http://local")
      if (url.pathname === "/api/followers/page") {
        const cursor = url.searchParams.get("cursor")
        calls.push(cursor ? "page2" : "page1")
        return { ok: true, username: "source", userId: "100", nextCursor: cursor ? null : "next", limited: !!cursor,
          users: cursor ? [{ username: "alpha", id: "1" }, { username: "beta", id: "2" }]
            : [{ username: "ready", id: "9" }, { username: "alpha", id: "1" }, { username: "alpha", id: "1" }, { username: "constructor", id: "3" }] }
      }
      expect(url.pathname).toBe("/api/profile")
      const username = url.searchParams.get("username")!
      expect(url.searchParams.get("userId")).toBe({ alpha: "1", beta: "2", constructor: "3" }[username as "alpha"])
      calls.push(username)
      return payload(username)
    })
    expect(actions.analyzeFollowers("source")).toBe(true)
    await vi.runAllTimersAsync()
    expect(calls).toEqual(["page1", "alpha", "constructor", "page2", "beta"])
    const state = store.getState()
    expect(state.queue.done).toBe(3)
    expect(state.queue.followersSource).toMatchObject({ discovered: 4, skipped: 1, complete: true, limited: true })
    expect(state.queue.running).toBe(false)
    expect(state.profiles.source.followers).toEqual(["ready", "alpha", "constructor", "beta"])
    expect(state.profiles["constructor" as string].username).toBe("constructor")
  })

  it("waits on 429 from either pagination or profiling and retries without losing accounts", async () => {
    const { store, actions, api } = await setup()
    let pages = 0, profiles = 0
    mocks.streamJob.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/followers/page")) {
        if (++pages === 1) throw new api.AppError({ code: "IG_RATE_LIMITED", message: "Rate limit", retryAfterMs: 5000 })
        return { username: "source", userId: "100", users: [{ username: "alpha", id: "1" }], nextCursor: null, limited: false }
      }
      if (++profiles === 1) throw new api.AppError({ code: "IG_RATE_LIMITED", message: "Rate limit", retryAfterMs: 5000 })
      return payload("alpha")
    })
    actions.analyzeFollowers("source")
    await vi.runAllTimersAsync()
    expect(pages).toBe(2)
    expect(profiles).toBe(2)
    expect(store.getState().queue).toMatchObject({ done: 1, items: [], failed: [], running: false })
  })

  it("pause cancels a page, preserves its checkpoint and resumes from that page", async () => {
    const { store, actions } = await setup()
    let release!: (value: unknown) => void
    const page = { username: "source", userId: "100", users: [{ username: "alpha", id: "1" }], nextCursor: null, limited: false }
    mocks.streamJob.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    actions.analyzeFollowers("source")
    actions.pauseQueue()
    release(page)
    await vi.runAllTimersAsync()
    expect(store.getState().queue).toMatchObject({ paused: true, items: [], followersSource: { discovered: 0, complete: false } })
    mocks.streamJob.mockImplementation(async (path: string) => path.startsWith("/api/followers/page") ? page : payload("alpha"))
    actions.resumeQueue()
    await vi.runAllTimersAsync()
    expect(store.getState().queue).toMatchObject({ done: 1, running: false, paused: false })
  })

  it("a chosen count limits analysis even when Instagram returns an oversized page; clearing cancels outstanding discovery", async () => {
    const { store, actions } = await setup()
    mocks.streamJob.mockImplementation(async (path: string) => path.startsWith("/api/followers/page")
      ? { username: "source", userId: "100", users: [{ username: "alpha", id: "1" }, { username: "beta", id: "2" }], nextCursor: null, limited: true }
      : payload("alpha"))
    actions.analyzeFollowers("source", 1)
    await vi.runAllTimersAsync()
    expect(store.getState().queue).toMatchObject({ done: 1, followersSource: { discovered: 1, complete: true } })
    actions.clearQueue()
    let release!: (value: unknown) => void
    mocks.streamJob.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    actions.analyzeFollowers("source")
    actions.clearQueue()
    release({ username: "source", userId: "100", users: [{ username: "beta", id: "2" }], nextCursor: null, limited: false })
    await vi.runAllTimersAsync()
    expect(store.getState().queue).toMatchObject({ done: 0, items: [], running: false })
    expect(store.getState().queue.followersSource).toBeUndefined()
  })
  it("deduplicates a 100,000-account import and skips ready results without starting recursive requests", async () => {
    const { store, actions } = await setup()
    store.patchProfile("bulk_0", { status: "ready", data: payload("bulk_0") })
    store.patchQueue({ paused: true, running: true })
    const names = Array.from({ length: 100_000 }, (_, i) => `bulk_${i}`)
    const started = performance.now()
    expect(actions.enqueue([...names, ...names])).toBe(99_999)
    expect(store.getState().queue.items).toHaveLength(99_999)
    expect(actions.enqueue(names)).toBe(0)
    expect(mocks.streamJob).not.toHaveBeenCalled()
    expect(performance.now() - started).toBeLessThan(5000)
  })

  it("retries temporary connection loss then pauses without discarding any account", async () => {
    const { store, actions, api } = await setup()
    mocks.streamJob.mockRejectedValue(new api.AppError({ code: "SERVER_UNREACHABLE", message: "Offline" }))
    actions.enqueue(["alpha", "beta"])
    await vi.runAllTimersAsync()
    expect(mocks.streamJob).toHaveBeenCalledTimes(4)
    expect(store.getState().queue).toMatchObject({ items: ["alpha", "beta"], done: 0, failed: [], paused: true, running: false })
    mocks.streamJob.mockImplementation(async (path: string) => payload(new URL(path, "http://local").searchParams.get("username")!))
    actions.resumeQueue()
    await vi.runAllTimersAsync()
    expect(store.getState().queue).toMatchObject({ items: [], done: 2, failed: [], paused: false })
  })

  it("retrying failed accounts corrects totals and keeps one result per account", async () => {
    const { store, actions, api } = await setup()
    mocks.streamJob.mockRejectedValueOnce(new api.AppError({ code: "IG_NOT_FOUND", message: "Missing" }))
    actions.enqueue(["alpha"])
    await vi.runAllTimersAsync()
    expect(store.getState().queue).toMatchObject({ done: 1, failed: ["alpha"] })
    mocks.streamJob.mockResolvedValue(payload("alpha"))
    actions.retryFailed()
    await vi.runAllTimersAsync()
    expect(store.getState().queue).toMatchObject({ done: 1, failed: [], items: [] })
  })

})
