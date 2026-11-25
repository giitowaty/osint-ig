/* Autotest połączenia z Instagramem: uruchamia /api/selftest jako zadanie z krokami na żywo. */

import { AppError, streamJob } from "./api"
import { finishJob, getState, jobEvent, log, setJobTrace, startJob } from "./store"
import type { ApiErrorBody, SelftestReport } from "./types"

/** Sprawdza wszystkie zapytania do IG na podanym profilu; sesja = pierwsze konto puli z ciasteczkami. */
export async function runSelftest(username: string, useSession: boolean): Promise<SelftestReport | { error: ApiErrorBody }> {
  const cookie = useSession ? getState().sessions.find((e) => e.cookie)?.cookie : undefined
  const { id, signal } = startJob("selftest", `Autotest Instagrama @${username}`)
  try {
    const report = await streamJob<SelftestReport>(`/api/selftest?username=${encodeURIComponent(username)}`, {
      signal,
      session: cookie,
      onEvent: (ev) => jobEvent(id, ev),
      onStart: (s) => setJobTrace(id, s.traceId),
    })
    const failed = report.checks.filter((c) => c.status === "fail")
    finishJob(id, failed.length ? "error" : "ok", failed.length ? {
      code: failed[0].code ?? "SELFTEST_FAILED", origin: "server",
      message: `${failed.length} z ${report.checks.length} zapytań nie działa (${failed.map((c) => c.label).join(", ")}).`,
      hint: failed[0].hint ?? undefined,
    } : undefined)
    if (!failed.length) log("ok", "app", `Autotest Instagrama: wszystkie sprawdzone zapytania działają${report.authenticated ? "" : " (bez sesji)"}.`)
    return report
  } catch (e) {
    const body: ApiErrorBody = e instanceof AppError ? e.body
      : { code: "CLIENT_ERROR", origin: "client", message: e instanceof Error ? e.message : String(e) }
    finishJob(id, body.code === "CANCELLED" ? "cancelled" : "error", body.code === "CANCELLED" ? undefined : body)
    return { error: body }
  }
}
