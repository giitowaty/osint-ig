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

export interface State {
  profiles: Record<string, ProfileEntry>
  order: string[]
  active: string | null
  view: View
  jobs: Job[]
  logs: LogEntry[]
  health: HealthState
  session: SessionState
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

let state: State = {
  profiles: {},
  order: [],
  active: null,
  view: "overview",
  jobs: [],
  logs: [],
  health: { status: "checking" },
  session: {
    cookie: migrateCookie(lsGet(LS.session) || ""),
    account: lsGet(LS.sessionUser) || "",
    meta: readMeta(),
    verifying: false,
  },
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

export function setSession(patch: Partial<SessionState>) {
  setState((s) => {
    const session = { ...s.session, ...patch }
    lsSet(LS.session, session.cookie || null)
    lsSet(LS.sessionUser, session.account || null)
    lsSet(LS.sessionMeta, session.cookie && session.meta ? JSON.stringify(session.meta) : null)
    return { session }
  })
}
