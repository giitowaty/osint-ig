/* ----------------------------------------------------------------------------
 * Magazyn stanu aplikacji (bez zewnętrznych bibliotek): profile w sesji
 * badawczej, zadania z krokami na żywo, log aktywności, stan serwera i sesji IG.
 * -------------------------------------------------------------------------- */

import { useSyncExternalStore } from "react"
import type { ApiErrorBody, Health, ProfilePayload, TraceEvent } from "./types"

export type View =
  | "overview"
  | "content"
  | "audience"
  | "network"
  | "influence"
  | "activity"
  | "session"
  | "tools"
  | "compare"

export const PROFILE_VIEWS: View[] = ["overview", "content", "audience"]

export interface ManualStats {
  followers: number | null
  following: number | null
  posts: number | null
}

export interface ProfileEntry {
  username: string
  status: "loading" | "ready" | "error"
  data?: ProfilePayload
  error?: ApiErrorBody
  jobId?: string
  manual?: ManualStats
  updatedAt: number
  followers?: string[]
  following?: string[]
  inNetwork: boolean
  notes?: string
  tags?: string[]
}

export interface QueueState {
  items: string[]
  running: boolean
  paused: boolean
  delayMs: number
  waitingUntil?: number
  waitReason?: string
  done: number
  failed: string[]
  current?: string
  followersSource?: {
    username: string
    userId: string
    cursor?: string
    limit?: number
    total?: number
    discovered: number
    skipped: number
    complete: boolean
    limited: boolean
    ids: Record<string, string>
    error?: ApiErrorBody
  }
}

export interface JobStep {
  id: string
  stage: string
  label: string
  status: "start" | "progress" | "ok" | "warn" | "error"
  ms?: number
  detail?: string
  t: number
}

export interface Job {
  id: string
  kind: "profile" | "list" | "whoami"
  label: string
  target?: string
  status: "running" | "ok" | "error" | "cancelled"
  startedAt: number
  endedAt?: number
  steps: JobStep[]
  progress?: { current: number; total: number; label?: string }
  error?: ApiErrorBody
  traceId?: string
}

export type LogLevel = "debug" | "info" | "ok" | "warn" | "error"
export type LogSource = "app" | "server" | "ig" | "engine"

export interface LogEntry {
  id: number
  at: number
  level: LogLevel
  source: LogSource
  message: string
  jobId?: string
  ms?: number
  detail?: string
  error?: ApiErrorBody
}

export interface HealthState {
  status: "checking" | "ok" | "down"
  info?: Health
  error?: ApiErrorBody
  checkedAt?: number
  latencyMs?: number
}

export interface SessionMeta {
  /** Nazwy przekazanych ciasteczek (bez wartości). */
  names: string[]
  /** Wygaśnięcie sessionid w ms, jeśli źródło je podało. */
  expires?: number
  format?: string
  importedAt?: number
  avatar?: string
  userId?: string
}

export interface SessionState {
  /** Ciasteczka IG jako nagłówek Cookie ("sessionid=…; csrftoken=…"). */
  cookie: string
  account: string
  verifying: boolean
  error?: ApiErrorBody
  verifiedAt?: number
  meta?: SessionMeta
}

/** Jedno konto w puli sesji IG. Pula dzieli pobieranie między konta (anti-ban). */
export interface SessionEntry {
  /** Stabilny klucz konta: userId (ds_user_id) gdy znany, inaczej tymczasowy. */
  id: string
  cookie: string
  account: string
  verifying: boolean
  error?: ApiErrorBody
  verifiedAt?: number
  meta?: SessionMeta
}

export interface State {
  profiles: Record<string, ProfileEntry>
  order: string[]
  active: string | null
  view: View
  jobs: Job[]
  logs: LogEntry[]
  health: HealthState
  /** Konto podstawowe = sessions[0] (utrzymywane w synchronie dla zgodności). */
  session: SessionState
  /** Pula kont sesji IG (konto podstawowe + dodatkowe). */
  sessions: SessionEntry[]
  /** Przypisanie profil -> id konta z puli (strategia: jedno konto na profil). */
  routing: Record<string, string>
  dockOpen: boolean
  autoLists: boolean
  history: string[]
  queue: QueueState
  hydrated: boolean
  storage: { status: "idle" | "saving" | "saved" | "error"; savedAt?: number; message?: string }
}

const LS = {
  history: "osint-ig-history",
  session: "osint-ig-session",
  sessionUser: "osint-ig-session-user",
  sessionMeta: "osint-ig-session-meta",
  dock: "osint-ig-dock",
  auto: "osint-ig-autofetch",
  sessions: "osint-ig-sessions",
}

let nextTmpId = 1
const tmpId = () => `tmp-${Date.now()}-${nextTmpId++}`

/** Buduje stan pojedynczej (podstawowej) sesji z pierwszego konta puli. */
function toPrimary(sessions: SessionEntry[]): SessionState {
  const p = sessions[0]
  if (!p) return { cookie: "", account: "", verifying: false }
  return { cookie: p.cookie, account: p.account, verifying: p.verifying, error: p.error, verifiedAt: p.verifiedAt, meta: p.meta }
}

/** Wczytuje pulę kont z localStorage; w razie braku odtwarza ją z zapisu pojedynczej sesji (migracja). */
function readSessions(): SessionEntry[] {
  try {
    const raw = JSON.parse(lsGet(LS.sessions) || "null")
    if (Array.isArray(raw) && raw.length) {
      return raw
        .filter((e) => e && typeof e.cookie === "string" && e.cookie)
        .map((e) => ({
          id: String(e.id || e.meta?.userId || tmpId()),
          cookie: migrateCookie(String(e.cookie)),
          account: String(e.account || ""),
          verifying: false,
          verifiedAt: e.verifiedAt,
          meta: e.meta,
        }))
    }
  } catch {
    /* niepoprawny zapis — spróbuj migracji z pojedynczej sesji */
  }
  const legacyCookie = migrateCookie(lsGet(LS.session) || "")
  if (!legacyCookie) return []
  const meta = readMeta()
  return [{ id: meta?.userId || "primary", cookie: legacyCookie, account: lsGet(LS.sessionUser) || "", verifying: false, meta }]
}

/** Zapisuje pulę (i mirror konta podstawowego w starych kluczach dla zgodności). */
function persistSessions(sessions: SessionEntry[]) {
  lsSet(LS.sessions, sessions.length ? JSON.stringify(sessions) : null)
  const p = sessions[0]
  lsSet(LS.session, p?.cookie || null)
  lsSet(LS.sessionUser, p?.account || null)
  lsSet(LS.sessionMeta, p?.cookie && p.meta ? JSON.stringify(p.meta) : null)
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* localStorage niedostępny (tryb prywatny) — stan tylko w pamięci */
  }
}

function readHistory(): string[] {
  try {
    const v = JSON.parse(lsGet(LS.history) || "[]")
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 20) : []
  } catch {
    return []
  }
}

/** Starszy zapis trzymał samo sessionid: zamieniamy na nagłówek Cookie. */
function migrateCookie(v: string) {
  return v && !v.includes("=") ? `sessionid=${v}` : v
}

function readMeta(): SessionMeta | undefined {
  try {
    const m = JSON.parse(lsGet("osint-ig-session-meta") || "null")
    return m && Array.isArray(m.names) ? m : undefined
  } catch {
    return undefined
  }
}

const initialSessions = readSessions()

let state: State = {
  profiles: {},
  order: [],
  active: null,
  view: "overview",
  jobs: [],
  logs: [],
  health: { status: "checking" },
  session: toPrimary(initialSessions),
  sessions: initialSessions,
  routing: {},
  // Na telefonie dok domyślnie zwinięty (zajmowałby pół ekranu).
  dockOpen: lsGet(LS.dock) ? lsGet(LS.dock) === "1" : typeof window === "undefined" || window.innerWidth >= 768,
  autoLists: lsGet(LS.auto) === "1",
  history: readHistory(),
  queue: { items: [], running: false, paused: false, delayMs: Number(lsGet("osint-ig-queue-delay")) || 5000, done: 0, failed: [] },
  hydrated: false,
  storage: { status: "idle" },
}

const listeners = new Set<() => void>()

export function getState() {
  return state
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const next = typeof patch === "function" ? patch(state) : patch
  state = { ...state, ...next }
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state)
  )
}

/* -------------------------------- Log ----------------------------------- */

let logSeq = 0
const MAX_LOGS = 3000

export function log(
  level: LogLevel,
  source: LogSource,
  message: string,
  extra: Partial<Omit<LogEntry, "id" | "level" | "source" | "message">> = {}
) {
  const entry: LogEntry = { id: ++logSeq, at: Date.now(), level, source, message, ...extra }
  setState((s) => ({
    logs: s.logs.length >= MAX_LOGS ? [...s.logs.slice(-MAX_LOGS + 1), entry] : [...s.logs, entry],
  }))
  return entry
}

export function clearLogs() {
  setState({ logs: [] })
}

/* -------------------------------- Zadania -------------------------------- */

let jobSeq = 0
const controllers = new Map<string, AbortController>()

export function startJob(kind: Job["kind"], label: string, target?: string) {
  const id = `j${++jobSeq}`
  const ctrl = new AbortController()
  controllers.set(id, ctrl)
  const job: Job = { id, kind, label, target, status: "running", startedAt: Date.now(), steps: [] }
  setState((s) => ({ jobs: [job, ...s.jobs].slice(0, 60) }))
  log("info", "app", `Start: ${label}`, { jobId: id })
  return { id, signal: ctrl.signal }
}

function patchJob(id: string, fn: (j: Job) => Job) {
  setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? fn(j) : j)) }))
}

/** Przyjmuje zdarzenie trace z serwera: aktualizuje kroki i dopisuje log. */
export function jobEvent(id: string, ev: TraceEvent) {
  if (ev.type === "step") {
    patchJob(id, (j) => {
      const steps = j.steps.slice()
      const i = steps.findIndex((s) => s.id === ev.id)
      const step: JobStep = {
        id: ev.id,
        stage: ev.stage,
        label: ev.label,
        status: ev.status,
        ms: ev.ms,
        detail: ev.detail,
        t: ev.t,
      }
      if (i >= 0) steps[i] = { ...steps[i], ...step }
      else steps.push(step)
      return { ...j, steps }
    })
    if (ev.status === "start") return
    const level: LogLevel =
      ev.status === "error" ? "error" : ev.status === "warn" ? "warn" : ev.status === "ok" ? "ok" : "info"
    log(level, ev.stage === "fetch" || ev.stage === "list" || ev.stage === "session" ? "ig" : "server", ev.label, {
      jobId: id,
      ms: ev.ms,
      detail: ev.detail,
    })
  } else if (ev.type === "log") {
    log(ev.level === "debug" ? "debug" : ev.level, "server", ev.message, { jobId: id })
  } else if (ev.type === "progress") {
    patchJob(id, (j) => ({ ...j, progress: { current: ev.current, total: ev.total, label: ev.label } }))
  }
}

export function setJobTrace(id: string, traceId: string) {
  patchJob(id, (j) => ({ ...j, traceId }))
}

export function finishJob(id: string, status: "ok" | "error" | "cancelled", error?: ApiErrorBody) {
  controllers.delete(id)
  let label = ""
  let ms = 0
  patchJob(id, (j) => {
    label = j.label
    ms = Date.now() - j.startedAt
    return { ...j, status, endedAt: Date.now(), error }
  })
  if (status === "ok") log("ok", "app", `Gotowe: ${label}`, { jobId: id, ms })
  else if (status === "cancelled") log("warn", "app", `Anulowano: ${label}`, { jobId: id, ms })
  else log("error", "app", `${label}: ${error?.message ?? "błąd"}`, { jobId: id, ms, error, detail: error?.hint ?? undefined })
}

export function cancelJob(id: string) {
  controllers.get(id)?.abort()
}

export function clearFinishedJobs() {
  setState((s) => ({ jobs: s.jobs.filter((j) => j.status === "running") }))
}

/* --------------------------- Profile / nawigacja -------------------------- */

export function patchProfile(username: string, patch: Partial<ProfileEntry>) {
  setState((s) => {
    const cur = Object.hasOwn(s.profiles, username) ? s.profiles[username] : undefined
    const next: ProfileEntry = cur
      ? { ...cur, ...patch, updatedAt: Date.now() }
      : { username, status: "loading", inNetwork: true, updatedAt: Date.now(), ...patch }
    return {
      profiles: { ...s.profiles, [username]: next },
      order: s.order.includes(username) ? s.order : [...s.order, username],
    }
  })
}

export function removeProfile(username: string) {
  setState((s) => {
    const profiles = { ...s.profiles }
    delete profiles[username]
    const order = s.order.filter((u) => u !== username)
    const active = s.active === username ? (order[order.length - 1] ?? null) : s.active
    return { profiles, order, active }
  })
}

export function navigate(view: View, active?: string | null) {
  setState((s) => ({ view, active: active === undefined ? s.active : active }))
}

export function pushHistory(username: string) {
  setState((s) => {
    const history = [username, ...s.history.filter((u) => u !== username)].slice(0, 20)
    lsSet(LS.history, JSON.stringify(history))
    return { history }
  })
}

export function clearHistory() {
  lsSet(LS.history, null)
  setState({ history: [] })
}

export function setDockOpen(open: boolean) {
  lsSet(LS.dock, open ? "1" : "0")
  setState({ dockOpen: open })
}

export function setAutoLists(on: boolean) {
  lsSet(LS.auto, on ? "1" : "0")
  setState({ autoLists: on })
}

export function patchQueue(patch: Partial<QueueState>) {
  setState((s) => ({ queue: { ...s.queue, ...patch } }))
  if (patch.delayMs != null) lsSet("osint-ig-queue-delay", String(patch.delayMs))
}

export function subscribeStore(l: () => void) {
  return subscribe(l)
}

/** Zapisuje pulę do stanu + localStorage i synchronizuje konto podstawowe. */
function commitSessions(sessions: SessionEntry[]) {
  persistSessions(sessions)
  setState({ sessions, session: toPrimary(sessions) })
}

/**
 * Zgodność wstecz: zmienia konto PODSTAWOWE (sessions[0]). Gdy puli nie ma,
 * a podano cookie — tworzy pierwsze konto. Pusty cookie bez konta = czyszczenie.
 */
export function setSession(patch: Partial<SessionState>) {
  const sessions = [...getState().sessions]
  const prev = sessions[0]
  if (!prev) {
    if (!patch.cookie) return
    sessions[0] = {
      id: patch.meta?.userId || "primary",
      cookie: patch.cookie, account: patch.account || "", verifying: patch.verifying || false,
      error: patch.error, verifiedAt: patch.verifiedAt, meta: patch.meta,
    }
  } else {
    const merged = { ...prev, ...patch }
    sessions[0] = { ...merged, id: merged.meta?.userId || prev.id }
  }
  commitSessions(sessions)
}

/** Dodaje puste konto do puli (do wypełnienia ciasteczkami) i zwraca jego id. */
export function addSessionSlot(): string {
  const id = tmpId()
  commitSessions([...getState().sessions, { id, cookie: "", account: "", verifying: false }])
  return id
}

/** Usuwa konto z puli i czyści przypisania profili do tego konta. */
export function removeSession(id: string) {
  const sessions = getState().sessions.filter((e) => e.id !== id)
  const routing = { ...getState().routing }
  for (const [u, sid] of Object.entries(routing)) if (sid === id) delete routing[u]
  setState({ routing })
  commitSessions(sessions)
}

/** Aktualizuje jedno konto w puli (po id). Zmiana meta.userId aktualizuje id. */
export function patchSessionEntry(id: string, patch: Partial<SessionEntry>) {
  const sessions = getState().sessions.map((e) => {
    if (e.id !== id) return e
    const merged = { ...e, ...patch }
    const newId = merged.meta?.userId || merged.id
    return { ...merged, id: newId }
  })
  commitSessions(sessions)
}

/** Konta puli gotowe do pracy: mają cookie i nie są w cooldownie (wg health). */
function usableSessions(): SessionEntry[] {
  const { sessions, health } = getState()
  const accounts = health.info?.cooldown?.accounts
  return sessions.filter((e) => e.cookie && !accounts?.[e.id]?.active)
}

/**
 * Wybiera konto z puli dla danego profilu (strategia: jedno konto na profil).
 * Trzyma się raz przypisanego konta; jeśli ono w cooldownie/zniknęło — bierze
 * następne round-robin (najmniej obciążone). Zwraca cookie albo undefined.
 */
export function cookieForProfile(username: string): string | undefined {
  const { sessions, routing } = getState()
  const pool = sessions.filter((e) => e.cookie)
  if (!pool.length) return undefined
  const usable = usableSessions()
  const prevId = routing[username]
  const prev = usable.find((e) => e.id === prevId)
  if (prev) return prev.cookie
  // Brak przypisania lub konto niedostępne: round-robin po najmniej obciążonych.
  const pick = (usable.length ? usable : pool)
  const counts = new Map<string, number>(pick.map((e) => [e.id, 0]))
  for (const sid of Object.values(routing)) if (counts.has(sid)) counts.set(sid, counts.get(sid)! + 1)
  let best = pick[0]
  for (const e of pick) if ((counts.get(e.id) ?? 0) < (counts.get(best.id) ?? 0)) best = e
  setState({ routing: { ...routing, [username]: best.id } })
  return best.cookie
}
