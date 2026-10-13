/* ----------------------------------------------------------------------------
 * Klient API z obsługą strumienia postępu (SSE przez fetch, bo EventSource nie
 * pozwala wysłać nagłówka x-ig-cookies) i pełną diagnostyką błędów.
 * -------------------------------------------------------------------------- */

import { apiBase, isTauri } from "./runtime"
import type { ApiErrorBody, Health, TraceEvent } from "./types"

export class AppError extends Error {
  body: ApiErrorBody
  constructor(body: ApiErrorBody) {
    super(body.message)
    this.body = body
  }
}

function unreachable(path: string, e: unknown): AppError {
  const reason = e instanceof Error ? e.message : String(e)
  return new AppError({
    code: "SERVER_UNREACHABLE",
    origin: "client",
    path,
    message: "Nie można połączyć się z lokalnym serwerem OSINT-IG.",
    hint: isTauri
      ? "Silnik (sidecar Node) nie odpowiada. Uruchom aplikację ponownie; jeśli problem wraca, sprawdź log silnika w panelu Aktywność."
      : "Serwer Node nie działa. W trybie deweloperskim uruchom „npm run dev”, w produkcyjnym „npm start”.",
    detail: reason,
  })
}

async function readJsonError(res: Response, path: string): Promise<AppError> {
  const text = await res.text().catch(() => "")
  try {
    const j = JSON.parse(text)
    if (j && j.error) {
      return new AppError({ origin: "server", path, ...j.error })
    }
  } catch {
    /* nie-JSON: opisujemy poniżej */
  }
  return new AppError({
    code: `HTTP_${res.status}`,
    status: res.status,
    origin: "server",
    path,
    message: `Serwer odpowiedział HTTP ${res.status} ${res.statusText}`.trim(),
    hint: "Odpowiedź nie zawiera opisu błędu. Sprawdź log serwera.",
    detail: text.slice(0, 600) || null,
  })
}

export interface StreamHandlers {
  onEvent?: (ev: TraceEvent) => void
  onStart?: (info: { traceId: string; job: string }) => void
}

/**
 * Wywołuje endpoint w trybie strumienia. Rozwiązuje się wynikiem albo rzuca
 * AppError z pełnym opisem. `signal` przerywa zadanie (serwer też je kończy).
 */
export async function streamJob<T>(
  path: string,
  opts: { session?: string; signal?: AbortSignal } & StreamHandlers = {}
): Promise<T> {
  let base: string
  try {
    base = await apiBase()
  } catch (e) {
    throw unreachable(path, e)
  }
  const sep = path.includes("?") ? "&" : "?"
  const headers: Record<string, string> = { Accept: "text/event-stream" }
  if (opts.session) headers["x-ig-cookies"] = opts.session

  let res: Response
  try {
    res = await fetch(`${base}${path}${sep}stream=1`, {
      headers,
      signal: opts.signal,
    })
  } catch (e) {
    if (opts.signal?.aborted) throw cancelled(path)
    throw unreachable(path, e)
  }

  const ctype = res.headers.get("content-type") || ""
  if (!ctype.includes("text/event-stream")) {
    if (!res.ok) throw await readJsonError(res, path)
    return (await res.json()) as T
  }
  if (!res.body) throw unreachable(path, "Brak treści odpowiedzi strumienia.")

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ""
  let result: T | undefined
  let error: AppError | undefined

  const handle = (block: string) => {
    let event = "message"
    const data: string[] = []
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart())
    }
    if (!data.length) return
    let payload: unknown
    try {
      payload = JSON.parse(data.join("\n"))
    } catch {
      return
    }
    if (event === "trace") opts.onEvent?.(payload as TraceEvent)
    else if (event === "start") opts.onStart?.(payload as { traceId: string; job: string })
    else if (event === "result") result = payload as T
    else if (event === "error")
      error = new AppError({ origin: "server", path, ...(payload as ApiErrorBody) })
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += value.replace(/\r\n/g, "\n")
      let idx: number
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        handle(buf.slice(0, idx))
        buf = buf.slice(idx + 2)
      }
    }
    if (buf.trim()) handle(buf)
  } catch (e) {
    if (opts.signal?.aborted) throw cancelled(path)
    throw new AppError({
      code: "STREAM_BROKEN",
      origin: "client",
      path,
      message: "Połączenie z serwerem zostało przerwane w trakcie zadania.",
      hint: "Serwer mógł zostać zamknięty lub zrestartowany. Spróbuj ponownie.",
      detail: e instanceof Error ? e.message : String(e),
    })
  }

  if (error) throw error
  if (result === undefined) {
    throw new AppError({
      code: "STREAM_INCOMPLETE",
      origin: "client",
      path,
      message: "Serwer zakończył strumień bez wyniku.",
      hint: "To nie powinno się zdarzyć. Sprawdź log serwera w panelu Aktywność.",
    })
  }
  return result
}

function cancelled(path: string) {
  return new AppError({
    code: "CANCELLED",
    origin: "client",
    path,
    message: "Zadanie anulowane.",
    hint: null,
  })
}

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  let base: string
  try {
    base = await apiBase()
  } catch (e) {
    throw unreachable("/api/health", e)
  }
  let res: Response
  try {
    res = await fetch(`${base}/api/health`, { signal })
  } catch (e) {
    throw unreachable("/api/health", e)
  }
  if (!res.ok) throw await readJsonError(res, "/api/health")
  return res.json()
}

/** Tekst diagnostyczny do schowka/zgłoszenia (bez cookie). */
export function diagnosticText(err: ApiErrorBody): string {
  const L = [
    `OSINT-IG · diagnostyka błędu`,
    `kod: ${err.code}${err.status ? ` (HTTP ${err.status})` : ""}`,
    `komunikat: ${err.message}`,
  ]
  if (err.hint) L.push(`podpowiedź: ${err.hint}`)
  if (err.job) L.push(`zadanie: ${err.job}`)
  if (err.stage) L.push(`etap: ${err.stage}`)
  if (err.path) L.push(`endpoint: ${err.path}`)
  if (err.ms != null) L.push(`czas: ${err.ms} ms`)
  if (err.traceId) L.push(`trace: ${err.traceId}`)
  if (err.detail) L.push(`szczegóły: ${err.detail}`)
  const u = err.upstream
  if (u) {
    L.push("", "odpowiedź Instagrama:")
    if (u.url) L.push(`  ${u.method || "GET"} ${u.url}`)
    if (u.finalUrl) L.push(`  przekierowano na: ${u.finalUrl}`)
    if (u.status != null) L.push(`  status: ${u.status} ${u.statusText || ""}`)
    if (u.ms != null) L.push(`  czas: ${u.ms} ms`)
    if (u.authenticated != null) L.push(`  z sesją: ${u.authenticated ? "tak" : "nie"}`)
    for (const [k, v] of Object.entries(u.headers || {})) L.push(`  ${k}: ${v}`)
    if (u.body) L.push(`  treść: ${u.body}`)
  }
  L.push("", `czas zgłoszenia: ${new Date().toISOString()}`, `środowisko: ${isTauri ? "desktop (Tauri)" : "web"} · ${navigator.userAgent}`)
  return L.join("\n")
}
