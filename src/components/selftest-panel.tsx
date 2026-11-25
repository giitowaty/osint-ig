import * as React from "react"
import { CircleCheckIcon, CircleMinusIcon, CopyIcon, OctagonXIcon, PlayIcon } from "lucide-react"
import { toast } from "sonner"

import { Panel } from "@/components/profile-parts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { runSelftest } from "@/lib/selftest"
import { hasAnySession, useStore } from "@/lib/store"
import type { ApiErrorBody, SelftestCheck, SelftestReport } from "@/lib/types"

function StatusIcon({ status }: { status: SelftestCheck["status"] }) {
  if (status === "ok") return <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-status-good" aria-label="działa" />
  if (status === "fail") return <OctagonXIcon className="mt-0.5 size-4 shrink-0 text-status-bad" aria-label="nie działa" />
  return <CircleMinusIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="pominięto" />
}

/**
 * Autotest połączenia z Instagramem: sprawdza każde zapytanie z osobna i mówi,
 * który identyfikator w ig-queries.json poprawić, gdy Instagram go zmieni.
 */
export function SelftestPanel() {
  const anySession = useStore(hasAnySession)
  const [username, setUsername] = React.useState("instagram")
  const [useSession, setUseSession] = React.useState(true)
  const [running, setRunning] = React.useState(false)
  const [report, setReport] = React.useState<SelftestReport | null>(null)
  const [error, setError] = React.useState<ApiErrorBody | null>(null)

  const start = async () => {
    const u = username.trim().replace(/^@+/, "") || "instagram"
    setRunning(true)
    setError(null)
    const r = await runSelftest(u, useSession && anySession)
    setRunning(false)
    if ("error" in r) { setReport(null); setError(r.error) } else setReport(r)
  }
  const failed = report?.checks.filter((c) => c.status === "fail").length ?? 0

  return (
    <Panel
      title="Autotest połączenia z Instagramem"
      description="Sprawdza po kolei każde zapytanie programu na znanym publicznym profilu. Gdy Instagram zmieni identyfikator zapytania, autotest wskaże, co poprawić."
      className="xl:col-span-2 2xl:col-span-3"
    >
      <div className="flex flex-col gap-4 text-sm">
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => { e.preventDefault(); if (!running) void start() }}
        >
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Profil testowy @</span>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} className="h-8 w-44" aria-label="Profil testowy" />
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={useSession && anySession} onCheckedChange={setUseSession} disabled={!anySession} />
            <span className={anySession ? "" : "text-muted-foreground"}>
              {anySession ? "z sesją IG (sprawdza też zapytania GraphQL)" : "bez sesji — połącz konto, by sprawdzić wszystko"}
            </span>
          </label>
          <Button type="submit" size="sm" disabled={running}>
            {running ? <Spinner data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
            {running ? "Sprawdzam…" : "Uruchom autotest"}
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-status-bad">
            Autotest się nie wykonał: {error.message}{error.hint ? ` ${error.hint}` : ""}
          </p>
        )}

        {report && (
          <>
            <p role="status" className={failed ? "font-medium text-status-bad" : "font-medium text-status-good"}>
              {failed
                ? `${failed} z ${report.checks.length} zapytań nie działa (profil @${report.username}).`
                : `Wszystkie sprawdzone zapytania działają (profil @${report.username}${report.authenticated ? ", z sesją" : ", bez sesji"}).`}
            </p>
            <ul className="flex flex-col divide-y border">
              {report.checks.map((c) => (
                <li key={c.id} className="flex gap-3 px-3 py-2.5">
                  <StatusIcon status={c.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{c.label}</span>
                      {c.configKey && <code className="text-xs text-muted-foreground">{c.configKey}</code>}
                      {c.code && <code className="text-xs text-status-bad">{c.code}</code>}
                    </div>
                    <p className="text-muted-foreground">{c.message}</p>
                    {c.hint && <p className="mt-1">{c.hint}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <details className="text-muted-foreground">
          <summary className="cursor-pointer select-none">Jak poprawić identyfikator bez przebudowy programu</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p>
              Utwórz plik JSON z nowymi wartościami (tylko te, które się zmieniły), np.{" "}
              <code>{'{ "profilePosts": "1234567890123456" }'}</code>. Program czyta go przy każdym zapytaniu — restart nie
              jest potrzebny. Potem uruchom autotest ponownie.
            </p>
            <p>
              Nowy <code>doc_id</code> znajdziesz w przeglądarce: zaloguj się na instagram.com, otwórz DevTools → Sieć,
              filtr „graphql”, wejdź na dowolny profil i w zapytaniu o nazwie z autotestu (np. PolarisProfilePostsQuery)
              skopiuj pole <code>doc_id</code>.
            </p>
            {report && (
              <div className="flex flex-wrap items-center gap-2">
                <span>Plik:</span>
                <code className="break-all text-foreground">{report.config.path}</code>
                <Button size="xs" variant="ghost" onClick={() => {
                  void navigator.clipboard?.writeText(report.config.path).then(() => toast.success("Skopiowano ścieżkę"))
                }}>
                  <CopyIcon data-icon="inline-start" /> Kopiuj
                </Button>
                <span>
                  ·{" "}
                  {report.config.source === "file"
                    ? `nadpisane: ${report.config.overrides.join(", ")}`
                    : "teraz obowiązują wartości domyślne"}
                </span>
              </div>
            )}
            {report?.config.errors.length ? (
              <p className="text-status-bad">Błędy w pliku: {report.config.errors.join("; ")}</p>
            ) : null}
          </div>
        </details>
      </div>
    </Panel>
  )
}
