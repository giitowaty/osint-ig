import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IDBFactory, IDBObjectStore } from "fake-indexeddb"

describe("incremental durable checkpoints", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal("indexedDB", new IDBFactory())
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })
  afterEach(async () => { vi.restoreAllMocks(); const p = await import("./persist"); await p.flushSaved(); vi.useRealTimers(); vi.unstubAllGlobals() })

  async function read() {
    const db = await new Promise<IDBDatabase>((resolve) => { const req = indexedDB.open("osint-ig", 2); req.onsuccess = () => resolve(req.result) })
    const tx = db.transaction(["profiles", "kv"], "readonly")
    const profiles = tx.objectStore("profiles").getAll()
    const meta = tx.objectStore("kv").get("session-v2")
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve() })
    db.close()
    return { profiles: profiles.result, meta: meta.result }
  }

  it("migrates old sessions and preserves a paused follower checkpoint without cookies", async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("osint-ig", 1)
      req.onupgradeneeded = () => req.result.createObjectStore("kv")
      req.onsuccess = () => resolve(req.result)
    })
    const tx = db.transaction("kv", "readwrite")
    tx.objectStore("kv").put({ savedAt: 1, order: ["alpha"], active: "alpha", profiles: { alpha: { username: "alpha", status: "ready", inNetwork: true, updatedAt: 1 } },
      queue: { items: ["beta"], running: true, current: "beta", paused: false, delayMs: 5000, done: 1, failed: [], followersSource: { username: "alpha", userId: "1", cursor: "next", discovered: 2, skipped: 0, ids: { beta: "2" }, complete: false, limited: false } } }, "session-v1")
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve() }); db.close()
    const persistence = await import("./persist")
    const store = await import("./store")
    store.setSession({ cookie: "sessionid=synthetic-secret" })
    await persistence.hydrate()
    expect(store.getState().queue).toMatchObject({ items: ["beta"], paused: true, running: false, followersSource: { cursor: "next", ids: { beta: "2" } } })
    expect(await persistence.flushSaved()).toBe(true)
    const saved = await read()
    expect(saved.profiles).toHaveLength(1)
    expect(JSON.stringify(saved)).not.toContain("synthetic-secret")
    expect(saved.meta.queue.current).toBeUndefined()
  })

  it("writes only a changed profile in a 10,000-profile session and restores a 100,000-account queue", async () => {
    const persistence = await import("./persist")
    const store = await import("./store")
    await persistence.hydrate()
    persistence.importSession({ profiles: Array.from({ length: 10_000 }, (_, i) => ({ username: `profile_${i}`, notes: "synthetic research note" })) })
    store.patchQueue({ items: Array.from({ length: 100_000 }, (_, i) => `pending_${i}`), paused: true })
    expect(await persistence.flushSaved()).toBe(true)
    const put = vi.spyOn(IDBObjectStore.prototype, "put")
    store.patchProfile("profile_9999", { notes: "changed" })
    expect(await persistence.flushSaved()).toBe(true)
    expect(put.mock.calls).toHaveLength(2) // one profile + metadata, not 10,000 profiles
    expect(put.mock.calls[0][1]).toBe("profile_9999")
    store.removeProfile("profile_42")
    expect(await persistence.flushSaved()).toBe(true)
    store.setState({ profiles: {}, order: [], active: null, queue: { items: [], running: false, paused: false, delayMs: 5000, done: 0, failed: [] } })
    await persistence.hydrate()
    expect(store.getState().order).toHaveLength(9999)
    expect(store.getState().profiles.profile_9999.notes).toBe("changed")
    expect(store.getState().profiles.profile_42).toBeUndefined()
    expect(store.getState().queue.items).toHaveLength(100_000)
    expect(store.getState().queue).toMatchObject({ paused: true, running: false })
  }, 20_000)

  it("does not report a save before commit, retries an aborted transaction and preserves concurrent changes", async () => {
    const persistence = await import("./persist")
    const store = await import("./store")
    await persistence.hydrate()
    store.patchProfile("alpha", { notes: "first" })
    const realPut = IDBObjectStore.prototype.put
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      const req = realPut.call(this, value, key)
      if (key === "session-v2") this.transaction.abort()
      return req
    })
    expect(await persistence.flushSaved()).toBe(false)
    expect(store.getState().storage.status).toBe("error")
    put.mockRestore()
    const first = persistence.flushSaved()
    store.patchProfile("alpha", { notes: "latest" })
    const second = persistence.flushSaved()
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect((await read()).profiles[0].notes).toBe("latest")
    expect(store.getState().storage.status).toBe("saved")
  })
})
