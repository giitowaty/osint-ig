/* Incremental local checkpoints: changed profiles and queue metadata commit together.
 * Cookies, logs and running jobs never enter this database. */
import { cancelJob, getState, log, setState, subscribeStore, type ProfileEntry, type QueueState, type State } from "./store"

const DB = "osint-ig"
const STORE = "kv"
const PROFILES = "profiles"
const KEY = "session-v2"
const LEGACY = "session-v1"

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      if (!req.result.objectStoreNames.contains(PROFILES)) req.result.createObjectStore(PROFILES)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error("Zamknij inne okno aplikacji, aby zaktualizować zapis sesji."))
  })
}

function committed(tx: IDBTransaction): Promise<void> {
  const completion = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error("Zapis sesji został przerwany."))
    tx.onerror = () => { /* abort reports failure; request success is not a commit */ }
  })
  // A synchronous request failure may leave the transaction promise unawaited.
  void completion.catch(() => {})
  return completion
}
function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
}
interface Checkpoint { savedAt: number; order: string[]; active: string | null; queue?: QueueState; bytes?: number }
interface Legacy extends Checkpoint { profiles: Record<string, ProfileEntry> }

export function savedQueue(q: QueueState): QueueState {
  const source = q.followersSource
  return { ...q, running: false, current: undefined,
    paused: !!q.items.length || !!(source && !source.complete), waitingUntil: undefined, waitReason: undefined,
    followersSource: source ? { ...source, error: undefined } : undefined }
}
function savedProfile(p: ProfileEntry): ProfileEntry {
  return { ...p, status: p.data ? "ready" : "error", jobId: undefined }
}
let persisted: State["profiles"] = {}
let profileBytes = new Map<string, number>()
let bytes = 0
let writing: Promise<boolean> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let unsubscribe: (() => void) | undefined
let observed: State | undefined

function changed(a: State | undefined, b: State) {
  return !a || a.profiles !== b.profiles || a.order !== b.order || a.active !== b.active || a.queue !== b.queue
}
function schedule() {
  // Throttle rather than debounce: continuous work must still checkpoint.
  if (!timer) timer = setTimeout(() => { timer = undefined; void flushSaved() }, 800)
}

export async function hydrate() {
  let db: IDBDatabase | undefined
  try {
    db = await database()
    const tx = db.transaction([STORE, PROFILES], "readonly")
    const complete = committed(tx)
    const metaReq = tx.objectStore(STORE).get(KEY)
    const oldReq = tx.objectStore(STORE).get(LEGACY)
    const profilesReq = tx.objectStore(PROFILES).getAll()
    const [meta, legacy, entries] = await Promise.all([
      result<Checkpoint | undefined>(metaReq), result<Legacy | undefined>(oldReq), result<ProfileEntry[]>(profilesReq),
    ])
    await complete
    const snap = meta ?? legacy
    if (snap) {
      const profiles: State["profiles"] = Object.create(null)
      for (const p of meta ? entries : Object.values(legacy?.profiles ?? {})) profiles[p.username] = p
      persisted = meta ? profiles : {}
      profileBytes = new Map(Object.entries(persisted).map(([u, p]) => [u, new Blob([JSON.stringify(p)]).size]))
      bytes = [...profileBytes.values()].reduce((sum, n) => sum + n, 0)
      setState((s) => ({ profiles: { ...profiles, ...s.profiles }, order: [...new Set([...snap.order, ...s.order])],
        active: s.active ?? snap.active,
        queue: s.queue.items.length || s.queue.running ? s.queue : snap.queue ? savedQueue(snap.queue) : s.queue,
        storage: { status: "saved", savedAt: snap.savedAt } }))
      log("info", "app", `Przywrócono sesję: ${snap.order.length} profili.`)
    }
  } catch (e) {
    setState({ storage: { status: "error", message: e instanceof Error ? e.message : String(e) } })
    log("warn", "app", "Nie udało się odczytać zapisanej sesji.")
  } finally { db?.close(); setState({ hydrated: true }) }
  unsubscribe?.()
  observed = getState()
  unsubscribe = subscribeStore(() => {
    const s = getState()
    if (s.hydrated && changed(observed, s)) { observed = s; schedule() }
  })
  if (getState().storage.status !== "error") schedule() // also migrates v1 atomically
}

/** Resolves only after every record and the queue checkpoint have committed. */
export async function flushSaved(): Promise<boolean> {
  clearTimeout(timer); timer = undefined
  if (writing) {
    await writing
    return flushSaved()
  }
  const state = getState()
  writing = (async () => {
    let db: IDBDatabase | undefined
    let transaction: IDBTransaction | undefined
    setState({ storage: { status: "saving", savedAt: getState().storage.savedAt } })
    try {
      db = await database()
      const tx = db.transaction([STORE, PROFILES], "readwrite")
      transaction = tx
      const complete = committed(tx)
      const st = tx.objectStore(PROFILES)
      const nextSizes = new Map(profileBytes)
      let nextBytes = bytes
      if (state.profiles !== persisted) {
        for (const [u, p] of Object.entries(state.profiles)) {
          if (persisted[u] === p) continue
          const entry = savedProfile(p)
          const size = new Blob([JSON.stringify(entry)]).size
          nextBytes += size - (nextSizes.get(u) ?? 0); nextSizes.set(u, size)
          st.put(entry, u)
        }
        for (const u of Object.keys(persisted)) if (!Object.hasOwn(state.profiles, u)) {
          st.delete(u); nextBytes -= nextSizes.get(u) ?? 0; nextSizes.delete(u)
        }
      }
      const checkpoint: Checkpoint = { savedAt: Date.now(), order: state.order, active: state.active, queue: savedQueue(state.queue), bytes: nextBytes }
      tx.objectStore(STORE).put(checkpoint, KEY)
      tx.objectStore(STORE).delete(LEGACY)
      await complete
      persisted = state.profiles; profileBytes = nextSizes; bytes = nextBytes
      setState({ storage: { status: "saved", savedAt: checkpoint.savedAt } })
      if (changed(state, getState())) schedule()
      return true
    } catch (e) {
      try { transaction?.abort() } catch { /* already completed/aborted */ }
      const q = getState().queue
      if (q.running) { setState({ queue: { ...q, paused: true } }); if (q.current) { const id = getState().profiles[q.current]?.jobId; if (id) cancelJob(id) } }
      setState({ storage: { status: "error", savedAt: getState().storage.savedAt,
        message: e instanceof Error ? e.message : String(e) } })
      log("warn", "app", "Nie zapisano postępu. Kolejka wstrzymana; sprawdź wolne miejsce i ponów zapis.")
      return false
    } finally { db?.close() }
  })()
  try { return await writing } finally { writing = undefined }
}

export async function clearSaved() {
  if (writing) await writing
  const db = await database()
  try {
    const tx = db.transaction([STORE, PROFILES], "readwrite")
    const done = committed(tx)
    tx.objectStore(PROFILES).clear(); tx.objectStore(STORE).delete(KEY); tx.objectStore(STORE).delete(LEGACY)
    await done
    persisted = {}; profileBytes.clear(); bytes = 0
  } finally { db.close() }
}
export async function savedSize(): Promise<number> {
  const db = await database()
  try {
    const tx = db.transaction(STORE, "readonly")
    const done = committed(tx)
    const snap = await result<Checkpoint | undefined>(tx.objectStore(STORE).get(KEY))
    await done
    return snap ? (snap.bytes ?? 0) + new Blob([JSON.stringify(snap)]).size : 0
  } finally { db.close() }
}

/** Import sesji z pliku eksportu (Narzędzia → Eksport całej sesji). */
export function importSession(json: unknown): number {
  const j = json as { profiles?: { username: string; data?: ProfileEntry["data"]; followers?: string[]; following?: string[]; manual?: ProfileEntry["manual"]; notes?: string; tags?: string[] }[] }
  if (!j || !Array.isArray(j.profiles)) throw new Error("Plik nie wygląda na eksport sesji OSINT-IG (brak listy profiles).")
  let n = 0
  setState((s) => {
    const profiles: State["profiles"] = Object.assign(Object.create(null), s.profiles)
    const order = [...s.order]
    const known = new Set(order)
    for (const p of j.profiles!) {
      if (!p?.username) continue
      const u = String(p.username).toLowerCase()
      if (!/^[a-z0-9._]{1,30}$/.test(u)) continue
      profiles[u] = {
        username: u,
        status: p.data ? "ready" : "error",
        data: p.data,
        followers: p.followers,
        following: p.following,
        manual: p.manual,
        notes: p.notes,
        tags: p.tags,
        inNetwork: true,
        updatedAt: Date.now(),
      }
      if (!known.has(u)) { known.add(u); order.push(u) }
      n++
    }
    return { profiles, order, active: s.active ?? order[0] ?? null }
  })
  return n
}
