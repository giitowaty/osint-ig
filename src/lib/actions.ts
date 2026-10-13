/* Akcje aplikacji: łączą klienta API z magazynem stanu i logiem aktywności. */

import { AppError, getHealth, streamJob } from "./api"
import {
  finishJob,
  getState,
  jobEvent,
  log,
  navigate,
  patchProfile,
  pushHistory,
  setJobTrace,
  setSession,
  setState,
  startJob,
  PROFILE_VIEWS,
  patchQueue,
  cancelJob,
} from "./store"
import { parseCookieInput, toHeader, type CookieBundle } from "./cookies"
import { apiBase } from "./runtime"
import type { ApiErrorBody, FollowersPage, FriendList, ProfilePayload, Whoami } from "./types"
import { flushSaved } from "./persist"

export function normalizeUsername(raw: string): string {
  let v = (raw || "").trim()
  const m = v.match(/instagram\.com\/([^/?#]+)/i)
  if (m) v = m[1]
  return v.replace(/^@+/, "").trim().toLowerCase()
}

export function validateUsername(u: string): string | null {
  if (!u) return "Podaj nazwę konta."
  if (!/^[a-z0-9._]{1,30}$/i.test(u))
    return "Nazwa konta może zawierać tylko litery, cyfry, kropkę i podkreślenie (max 30 znaków)."
  return null
}

const asBody = (e: unknown): ApiErrorBody =>
  e instanceof AppError
    ? e.body
    : {
        code: "CLIENT_ERROR",
        origin: "client",
        message: e instanceof Error ? e.message : String(e),
        hint: "Nieoczekiwany błąd w aplikacji.",
        detail: e instanceof Error ? e.stack?.split("\n").slice(0, 5).join("\n") : null,
      }

/** Analizuje profil; wynik trafia do sesji badawczej i (opcjonalnie) do widoku. */
export async function analyze(raw: string, opts: { focus?: boolean; fresh?: boolean; userId?: string; skipAutoLists?: boolean } = {}) {
  const username = normalizeUsername(raw)
  const invalid = validateUsername(username)
  if (invalid) {
    log("warn", "app", invalid)
    return
  }
  const existing = getState().profiles[username]
  if (existing?.status === "loading") {
    if (opts.focus !== false) navigate(PROFILE_VIEWS.includes(getState().view) ? getState().view : "overview", username)
    return
  }

  const { id, signal } = startJob("profile", `Analiza @${username}`, username)
  patchProfile(username, { status: "loading", jobId: id, error: undefined })
  if (opts.focus !== false) {
    const view = getState().view
    navigate(PROFILE_VIEWS.includes(view) ? view : "overview", username)
  }
  const { session } = getState()

  try {
    const data = await streamJob<ProfilePayload>(
      `/api/profile?username=${encodeURIComponent(username)}${opts.fresh ? "&fresh=1" : ""}${opts.userId ? `&userId=${encodeURIComponent(opts.userId)}` : ""}`,
      {
        signal,
        session: session.cookie || undefined,
        onEvent: (ev) => jobEvent(id, ev),
        onStart: (s) => setJobTrace(id, s.traceId),
      }
    )
    const canonical = (data.profile.username || username).toLowerCase()
    patchProfile(username, { status: "ready", data, error: undefined })
    if (data.cached) log("info", "app", `@${username}: wynik z pamięci serwera (${Math.round((data.cacheAgeMs ?? 0) / 1000)} s). „Odśwież” pobiera na nowo.`, { jobId: id })
    finishJob(id, "ok")
    pushHistory(canonical)
    if (!opts.skipAutoLists && getState().autoLists && getState().session.cookie) {
      void fetchList(username, "followers").then(() => fetchList(username, "following"))
    }
  } catch (e) {
    const body = asBody(e)
    const cancelled = body.code === "CANCELLED"
    patchProfile(username, {
      status: cancelled && existing?.data ? "ready" : "error",
      error: cancelled ? existing?.error : body,
    })
    finishJob(id, cancelled ? "cancelled" : "error", cancelled ? undefined : body)
  }
}

export async function reanalyzeAll() {
  enqueue(getState().order, { fresh: true })
}

/* --------------------------------- Kolejka -------------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const freshSet = new Set<string>()
let queueWorker = false
let queueEpoch = 0
let queueJob: string | undefined
const retries = new Map<string, number>()
const temporary = (e: ApiErrorBody) => ["SERVER_UNREACHABLE", "STREAM_BROKEN", "STREAM_INCOMPLETE", "TIMEOUT", "NETWORK_ERROR", "IG_SERVER_ERROR", "HTTP_502", "HTTP_503", "HTTP_504"].includes(e.code) || (e.status != null && e.status >= 500 && e.status < 600)
async function retryTemporary(key: string, error: ApiErrorBody) {
  if (!temporary(error)) return false
  const attempt = (retries.get(key) ?? 0) + 1
  retries.set(key, attempt)
  if (attempt > 3) { patchQueue({ paused: true }); log("warn", "app", "Połączenie nadal nie działa. Kolejka wstrzymana bez utraty kont; kliknij Wznów po przywróceniu połączenia."); return true }
  await waitWhile(Date.now() + 5000 * 2 ** (attempt - 1), `problem z połączeniem · próba ${attempt}/3`)
  return true
}

/** A user-started, one-level scan: followers become profiles, never new scans. */
export function analyzeFollowers(raw: string, limit?: number) {
  const username = normalizeUsername(raw)
  const s = getState()
  const profile = s.profiles[username]?.data?.profile
  if (validateUsername(username) || !profile?.id || profile.private || !s.session.cookie) {
    log("warn", "app", "Najpierw otwórz publiczny profil i połącz sesję IG.")
    return false
  }
  if (s.queue.items.length || s.queue.running || (s.queue.followersSource && !s.queue.followersSource.complete)) {
    log("warn", "app", "W kolejce jest już praca. Dokończ ją albo wyczyść kolejkę przed uruchomieniem nowego profilu.")
    return false
  }
  if (limit != null && (!Number.isSafeInteger(limit) || limit < 1)) return false
  patchQueue({ items: [], done: 0, failed: [], paused: false,
    followersSource: { username, userId: profile.id, limit, total: profile.followers ?? undefined,
      discovered: 0, skipped: 0, complete: false, limited: false, ids: {} } })
  log("info", "app", `Analiza obserwujących @${username}: ${limit ? `do ${limit} kont` : "wszyscy dostępni"}.`)
  void runQueue()
  return true
}

async function loadFollowersPage(epoch: number) {
  const s = getState()
  const source = s.queue.followersSource!
  const { id, signal } = startJob("list", `Obserwujący @${source.username} · strona listy`, source.username)
  queueJob = id
  try {
    const remaining = source.limit ? source.limit - source.discovered : 50
    const path = `/api/followers/page?username=${encodeURIComponent(source.username)}&userId=${source.userId}&count=${Math.min(50, remaining)}${source.cursor ? `&cursor=${encodeURIComponent(source.cursor)}` : ""}`
    const page = await streamJob<FollowersPage>(path, { signal, session: s.session.cookie,
      onEvent: (ev) => jobEvent(id, ev), onStart: (info) => setJobTrace(id, info.traceId) })
    if (epoch !== queueEpoch || getState().queue.paused || signal.aborted) {
      finishJob(id, "cancelled")
      return
    }
    if (page.username !== source.username || page.userId !== source.userId || !Array.isArray(page.users)) {
      throw new AppError({ code: "BAD_RESPONSE", origin: "client", message: "Lista obserwujących nie pasuje do wybranego profilu." })
    }
    const current = getState()
    const ids: Record<string, string> = Object.assign(Object.create(null), source.ids)
    const names: string[] = []
    for (const user of page.users) {
      if (!user || validateUsername(user.username) || !/^\d+$/.test(user.id) || Object.hasOwn(ids, user.username)) continue
      if (source.limit && source.discovered + names.length >= source.limit) break
      ids[user.username] = user.id
      names.push(user.username)
    }
    if (page.nextCursor && (!names.length || page.nextCursor === source.cursor)) {
      throw new AppError({ code: "BAD_RESPONSE", origin: "client", message: "Instagram nie przesuwa listy obserwujących. Pobieranie wstrzymano." })
    }
    const ready = names.filter((u) => current.profiles[u]?.status === "ready")
    const pending = names.filter((u) => !ready.includes(u) && !current.queue.items.includes(u))
    const discovered = source.discovered + names.length
    const complete = !page.nextCursor || (!!source.limit && discovered >= source.limit)
    patchProfile(source.username, { followers: [...new Set([...(current.profiles[source.username]?.followers ?? []), ...names])] })
    patchQueue({ items: [...current.queue.items, ...pending], followersSource: { ...source, ids, discovered,
      skipped: source.skipped + ready.length, cursor: page.nextCursor ?? undefined, complete,
      limited: source.limited || page.limited, error: undefined } })
    log("ok", "app", `Obserwujący @${source.username}: ${discovered} kont pobranych, ${pending.length} dodanych do kolejki.`, { jobId: id })
    finishJob(id, "ok")
  } catch (e) {
    const body = asBody(e)
    finishJob(id, body.code === "CANCELLED" ? "cancelled" : "error", body.code === "CANCELLED" ? undefined : body)
    throw e
  } finally { if (queueJob === id) queueJob = undefined }
}

/** Dodaje konta do kolejki (pomija duplikaty i już analizowane, chyba że fresh). */
export function enqueue(raw: string[] | string, opts: { fresh?: boolean } = {}) {
  const list = (Array.isArray(raw) ? raw : parseList(raw)).map(normalizeUsername).filter((u) => !validateUsername(u))
  const s = getState()
  const seen = new Set(s.queue.items)
  const add = list.filter((u) => {
    if (seen.has(u) || (!opts.fresh && s.profiles[u]?.status === "ready")) return false
    seen.add(u)
    return true
  })
  if (opts.fresh) add.forEach((u) => freshSet.add(u))
  if (!add.length) {
    log("info", "app", "Kolejka: nic nowego do dodania (konta już są w sesji lub w kolejce).")
    return 0
  }
  patchQueue({ items: [...s.queue.items, ...add] })
  log("info", "app", `Kolejka: dodano ${add.length} kont (${getState().queue.items.length} czeka).`)
  if (!getState().queue.running && !getState().queue.paused) void runQueue()
  return add.length
}

async function waitWhile(until: number, reason: string) {
  const epoch = queueEpoch
  patchQueue({ waitingUntil: until, waitReason: reason })
  while (Date.now() < until) {
    const q = getState().queue
    if (q.paused || !q.running || epoch !== queueEpoch) break
    await sleep(250)
  }
  patchQueue({ waitingUntil: undefined, waitReason: undefined })
}

export async function runQueue() {
  if (queueWorker) return
  if (getState().storage.status === "error") { patchQueue({ paused: true }); return }
  queueWorker = true
  const epoch = queueEpoch
  patchQueue({ running: true, paused: false })
  try {
    for (;;) {
      const q = getState().queue
      if (q.paused || !q.running || epoch !== queueEpoch) break
      if (q.followersSource && !getState().session.cookie) {
        patchQueue({ paused: true, followersSource: { ...q.followersSource, error: {
          code: "SESSION_MISSING", origin: "client", message: "Połącz sesję IG, aby wznowić analizę obserwujących." } } })
        break
      }
      const u = q.items[0]
      if (!u) {
        if (!q.followersSource || q.followersSource.complete) break
        try {
          await loadFollowersPage(epoch)
          retries.delete("followers-page")
          const next = getState().queue
          if (epoch === queueEpoch && !next.paused && !next.items.length && next.followersSource && !next.followersSource.complete) {
            await waitWhile(Date.now() + next.delayMs, "pauza między stronami obserwujących")
          }
        } catch (e) {
          if (epoch !== queueEpoch || getState().queue.paused) break
          const error = asBody(e)
          if (error.code === "IG_RATE_LIMITED") {
            await waitWhile(Date.now() + Math.max(5000, error.retryAfterMs ?? 60_000), "limit przy pobieraniu obserwujących")
          } else if (!(await retryTemporary("followers-page", error))) {
            patchQueue({ paused: true, followersSource: { ...getState().queue.followersSource!, error } })
          }
        }
        continue
      }
      patchQueue({ current: u })
      const userId = q.followersSource && Object.hasOwn(q.followersSource.ids, u) ? q.followersSource.ids[u] : undefined
      const pending = analyze(u, { focus: false, fresh: freshSet.has(u), userId,
        skipAutoLists: true })
      queueJob = getState().profiles[u]?.jobId
      await pending
      queueJob = undefined
      if (epoch !== queueEpoch || getState().queue.paused || !getState().queue.running) break
      const entry = getState().profiles[u]
      const err = entry?.status === "error" ? entry.error : undefined
      if (err && await retryTemporary(u, err)) continue
      if (err?.code === "IG_RATE_LIMITED") {
        // Zostaje na początku kolejki: czekamy tyle, ile każe blokada, i próbujemy znowu.
        const wait = Math.max(5000, err.retryAfterMs ?? 60_000)
        log("warn", "app", `Kolejka: limit IG, wznowię za ${Math.round(wait / 1000)} s (@${u} czeka).`)
        await waitWhile(Date.now() + wait, "limit Instagrama")
        continue
      }
      if (err && ["IG_SESSION_INVALID", "IG_CHECKPOINT", "SESSION_MISSING", "CANCELLED"].includes(err.code)) {
        patchQueue({ paused: true, ...(q.followersSource ? { followersSource: { ...q.followersSource, error: err } } : {}) })
        break
      }
      freshSet.delete(u)
      retries.delete(u)
      setState((s) => ({
        queue: {
          ...s.queue,
          items: s.queue.items[0] === u ? s.queue.items.slice(1) : s.queue.items.filter((x) => x !== u),
          done: s.queue.done + 1,
          failed: err ? [...s.queue.failed, u] : s.queue.failed,
        },
      }))
      // A completed account and its queue checkpoint reach disk before the next request.
      if (getState().hydrated && !(await flushSaved())) break
      if (getState().queue.items.length || (getState().queue.followersSource && !getState().queue.followersSource!.complete)) {
        // Pauza z rozrzutem ±30%: równe odstępy wyglądają jak bot.
        const d = getState().queue.delayMs
        await waitWhile(Date.now() + Math.round(d * (0.7 + Math.random() * 0.6)), "pauza między kontami")
      }
    }
  } finally {
    queueWorker = false
    patchQueue({ running: false, current: undefined })
    const q = getState().queue
    if (epoch !== queueEpoch && !q.paused && (q.items.length || (q.followersSource && !q.followersSource.complete))) void runQueue()
    else if (!q.paused && !q.items.length && (!q.followersSource || q.followersSource.complete) && (q.done || q.followersSource)) {
      log("ok", "app", `Kolejka zakończona: ${q.done} kont, błędy: ${q.failed.length}${q.followersSource?.limited ? ". Instagram ograniczył widoczną listę obserwujących." : "."}`)
    }
  }
}

export function pauseQueue() {
  queueEpoch++
  patchQueue({ paused: true })
  if (queueJob) cancelJob(queueJob)
}

export function resumeQueue() {
  if (getState().storage.status === "error") { log("warn", "app", "Najpierw ponów zapis postępu."); return }
  retries.clear()
  const source = getState().queue.followersSource
  patchQueue({ paused: false, ...(source ? { followersSource: { ...source, error: undefined } } : {}) })
  void runQueue()
}

export function clearQueue() {
  queueEpoch++
  if (queueJob) cancelJob(queueJob)
  freshSet.clear()
  retries.clear()
  patchQueue({ items: [], paused: false, running: false, done: 0, failed: [], followersSource: undefined,
    current: undefined, waitingUntil: undefined, waitReason: undefined })
}

export function removeFromQueue(u: string) {
  setState((s) => ({ queue: { ...s.queue, items: s.queue.items.filter((x) => x !== u) } }))
}

/* --------------------------- Notatki i serwer ------------------------------ */

export function setNotes(username: string, notes: string) {
  patchProfile(username, { notes })
}

export function setTags(username: string, tags: string[]) {
  patchProfile(username, { tags: [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20) })
}

async function serverGet(path: string) {
  const base = await apiBase()
  const res = await fetch(`${base}${path}`)
  return res.json()
}

export async function resetCooldown() {
  try {
    await serverGet("/api/cooldown/reset")
    log("warn", "app", "Zdjęto blokadę zapytań do IG. Jeśli limit trwa, IG odpowie znowu 429.")
    void checkHealth(true)
  } catch (e) {
    log("error", "app", "Nie udało się zdjąć blokady.", { detail: String(e) })
  }
}

export async function clearServerCache() {
  try {
    const j = await serverGet("/api/cache/clear")
    log("info", "app", `Wyczyszczono pamięć podręczną serwera (${j.cleared} wpisów).`)
    void checkHealth(true)
  } catch (e) {
    log("error", "app", "Nie udało się wyczyścić pamięci serwera.", { detail: String(e) })
  }
}

/** Pobiera listę obserwujących/obserwowanych przez sesję IG. */
export async function fetchList(username: string, type: "followers" | "following", limit = 300) {
  const { session } = getState()
  const label = `${type === "followers" ? "Obserwujący" : "Obserwowani"} @${username}`
  const { id, signal } = startJob("list", label, username)
  try {
    const data = await streamJob<FriendList>(
      `/api/list?username=${encodeURIComponent(username)}&type=${type}&limit=${limit}`,
      {
        signal,
        session: session.cookie || undefined,
        onEvent: (ev) => jobEvent(id, ev),
        onStart: (s) => setJobTrace(id, s.traceId),
      }
    )
    patchProfile(username, { [type]: data.users })
    log("ok", "app", `${label}: ${data.count} kont (${data.stopReason ?? "koniec"})`, { jobId: id })
    finishJob(id, "ok")
    return data
  } catch (e) {
    const body = asBody(e)
    finishJob(id, body.code === "CANCELLED" ? "cancelled" : "error", body.code === "CANCELLED" ? undefined : body)
    return null
  }
}

export async function fetchListsForAll() {
  const users = getState().order.filter((u) => getState().profiles[u]?.inNetwork)
  for (const u of users) {
    await fetchList(u, "followers")
    await fetchList(u, "following")
  }
}

export function parseList(text: string): string[] {
  const out: string[] = []
  for (const tok of String(text || "").split(/[\s,;]+/)) {
    const u = normalizeUsername(tok).replace(/[/?#].*$/, "")
    if (!validateUsername(u)) out.push(u)
  }
  return [...new Set(out)]
}

/** Retry attempts replace failed results instead of increasing the total. */
export function retryFailed() {
  const q = getState().queue
  const failed = [...new Set(q.failed)]
  patchQueue({ failed: [], done: Math.max(0, q.done - failed.length) })
  return enqueue(failed, { fresh: true })
}

export function applyPastedList(username: string, type: "followers" | "following", text: string) {
  const users = parseList(text)
  patchProfile(username, { [type]: users })
  log("info", "app", `Wczytano ręcznie ${users.length} kont (${type === "followers" ? "obserwujący" : "obserwowani"}) dla @${username}.`)
  return users.length
}

/** Zapisuje cookie i weryfikuje, z jakiego konta korzysta sesja. */
/** Podłącza konto IG z dowolnego formatu ciasteczek i od razu je weryfikuje. */
export async function connectCookies(input: string | CookieBundle) {
  const b = typeof input === "string" ? parseCookieInput(input) : input
  setSession({
    cookie: toHeader(b),
    account: b.account ?? "",
    error: undefined,
    verifiedAt: undefined,
    meta: { names: Object.keys(b.cookies), expires: b.expires.sessionid, format: b.format, importedAt: Date.now() },
  })
  log("info", "app", `Zapisano ${Object.keys(b.cookies).length} ciasteczek IG (${b.format}). Sprawdzam konto…`)
  await verifySession()
}

export async function verifySession() {
  const { session } = getState()
  if (!session.cookie) return
  setSession({ verifying: true, error: undefined })
  const { id, signal } = startJob("whoami", "Weryfikacja sesji IG")
  try {
    const who = await streamJob<Whoami>("/api/whoami", {
      signal,
      session: session.cookie,
      onEvent: (ev) => jobEvent(id, ev),
    })
    setSession({
      account: who.username,
      verifying: false,
      verifiedAt: Date.now(),
      meta: { names: who.cookies ?? session.meta?.names ?? [], ...session.meta, avatar: who.avatar, userId: who.userId },
    })
    finishJob(id, "ok")
    log("ok", "app", `Sesja IG: zalogowano jako @${who.username}`)
  } catch (e) {
    const body = asBody(e)
    setSession({ verifying: false, account: "", error: body })
    finishJob(id, "error", body)
  }
}

export function clearSession() {
  if (getState().queue.followersSource) pauseQueue()
  setSession({ cookie: "", account: "", error: undefined, verifiedAt: undefined, meta: undefined })
  log("info", "app", "Usunięto ciasteczka sesji IG z tego urządzenia.")
}

/** Sprawdza stan lokalnego serwera; zapisuje opóźnienie. */
let healthLogged: "ok" | "down" | null = null

export async function checkHealth(quiet = false) {
  const prev = getState().health
  if (!quiet) setState({ health: { ...prev, status: "checking" } })
  const t0 = performance.now()
  try {
    const info = await getHealth(AbortSignal.timeout(4000))
    const latencyMs = Math.round(performance.now() - t0)
    setState({ health: { status: "ok", info, checkedAt: Date.now(), latencyMs } })
    if (healthLogged !== "ok") {
      healthLogged = "ok"
      log("ok", "engine", `Serwer działa: v${info.version} · node ${info.node} · ${info.host}:${info.port}${info.sea ? " · sidecar" : ""}`, { ms: latencyMs })
    }
  } catch (e) {
    const body = asBody(e)
    setState({ health: { status: "down", error: body, checkedAt: Date.now() } })
    if (healthLogged !== "down") {
      healthLogged = "down"
      log("error", "engine", body.message, { error: body, detail: body.hint ?? undefined })
    }
  }
}

/** Ręczne statystyki (gdy pobranie zawiedzie). */
export function setManual(username: string, key: "followers" | "following" | "posts", value: number | null) {
  const cur = getState().profiles[username]
  const manual = { followers: null, following: null, posts: null, ...(cur?.manual ?? {}), [key]: value }
  patchProfile(username, { manual })
}
