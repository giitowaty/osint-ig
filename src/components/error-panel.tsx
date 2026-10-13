import * as React from "react"
import {
  ChevronRightIcon,
  ClipboardCopyIcon,
  ExternalLinkIcon,
  OctagonXIcon,
  PencilLineIcon,
  RotateCwIcon,
} from "lucide-react"
import { toast } from "sonner"

import { JobSteps, stageLabel } from "@/components/job-steps"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useNow } from "@/hooks/use-now"
import { diagnosticText } from "@/lib/api"
import { fmtMs } from "@/lib/analysis"
import { openExternal } from "@/lib/runtime"
import type { JobStep } from "@/lib/store"
import type { ApiErrorBody } from "@/lib/types"
import { cn } from "@/lib/utils"

const ORIGIN_LABEL: Record<string, string> = {
  server: "serwer lokalny",
  client: "aplikacja",
}

/** Odliczanie do końca blokady IG (liczone od chwili pokazania błędu). */
function RetryCountdown({ ms }: { ms: number }) {
  const [until] = React.useState(() => Date.now() + ms)
  const now = useNow(true, 1000)
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  return (
    <p className="tnum mt-1 text-sm text-status-warn">
      {left > 0 ? `Instagram powinien znów odpowiadać za ~${left} s.` : "Blokada powinna już minąć: możesz ponowić."}
    </p>
  )
}

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words", mono && "font-mono text-[11px]")}>{children}</dd>
    </>
  )
}

/**
 * Szczegółowy panel błędu: kod, etap, podpowiedź, przebieg zadania oraz
 * surowa odpowiedź Instagrama (status, nagłówki, fragment treści).
 */
export function ErrorPanel({
  error,
  steps,
  onRetry,
  onManual,
  profileUrl,
  compact = false,
  className,
}: {
  error: ApiErrorBody
  steps?: JobStep[]
  onRetry?: () => void
  onManual?: () => void
  profileUrl?: string
  compact?: boolean
  className?: string
}) {
  const u = error.upstream
  const [open, setOpen] = React.useState(!compact)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagnosticText(error))
      toast.success("Skopiowano diagnostykę do schowka")
    } catch {
      toast.error("Schowek niedostępny", { description: "Przeglądarka zablokowała dostęp do schowka." })
    }
  }

  return (
    <section
      role="alert"
      className={cn("overflow-hidden border border-status-bad/40 bg-card text-card-foreground", className)}
    >
      <div className="flex flex-wrap items-start gap-3 border-b border-status-bad/25 bg-status-bad/[0.06] px-4 py-3">
        <OctagonXIcon className="mt-0.5 size-5 shrink-0 text-status-bad" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{error.message}</h3>
            <Badge variant="outline" className="font-mono text-[10px]">
              {error.code}
            </Badge>
            {error.status ? (
              <Badge variant="outline" className="tnum text-[10px]">
                HTTP {error.status}
              </Badge>
            ) : null}
          </div>
          {error.hint && <p className="mt-1 max-w-[75ch] text-sm text-muted-foreground">{error.hint}</p>}
          {error.retryAfterMs ? <RetryCountdown ms={error.retryAfterMs} /> : null}
        </div>
        <div className="flex flex-wrap gap-1.5" data-print-hide>
          {onRetry && (
            <Button size="sm" onClick={onRetry}>
              <RotateCwIcon data-icon="inline-start" />
              Ponów
            </Button>
          )}
          {onManual && (
            <Button size="sm" variant="outline" onClick={onManual}>
              <PencilLineIcon data-icon="inline-start" />
              Wpisz ręcznie
            </Button>
          )}
          {profileUrl && (
            <Button size="sm" variant="outline" onClick={() => void openExternal(profileUrl)}>
              <ExternalLinkIcon data-icon="inline-start" />
              Otwórz na IG
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={copy}>
            <ClipboardCopyIcon data-icon="inline-start" />
            Kopiuj diagnostykę
          </Button>
        </div>
      </div>

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            Szczegóły techniczne
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className={cn("grid gap-4 px-4 pb-4", steps?.length ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]" : "")}>
            <div className="flex min-w-0 flex-col gap-4">
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
                <Row label="Etap">{stageLabel(error.stage)}</Row>
                {error.origin && <Row label="Źródło">{ORIGIN_LABEL[error.origin] ?? error.origin}</Row>}
                {error.job && <Row label="Zadanie">{error.job}</Row>}
                {error.path && <Row label="Endpoint" mono>{error.path}</Row>}
                {error.ms != null && <Row label="Czas">{fmtMs(error.ms)}</Row>}
                {error.traceId && <Row label="Trace" mono>{error.traceId}</Row>}
                {error.detail && <Row label="Szczegóły" mono>{error.detail}</Row>}
              </dl>

              {u && (
                <div className="min-w-0 border bg-muted/40">
                  <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
                    <span className="font-medium">Odpowiedź Instagrama</span>
                    {u.status != null && (
                      <Badge variant="outline" className="tnum text-[10px]">
                        {u.status} {u.statusText}
                      </Badge>
                    )}
                    {u.ms != null && <span className="tnum text-muted-foreground">{fmtMs(u.ms)}</span>}
                    {u.bytes != null && <span className="tnum text-muted-foreground">{(u.bytes / 1024).toFixed(1)} kB</span>}
                    {u.authenticated != null && (
                      <span className="text-muted-foreground">{u.authenticated ? "z sesją IG" : "bez sesji"}</span>
                    )}
                    {u.timeoutMs != null && <span className="text-muted-foreground">limit {fmtMs(u.timeoutMs)}</span>}
                  </div>
                  <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 px-3 py-2 text-xs">
                    {u.url && <Row label={u.method || "GET"} mono>{u.url}</Row>}
                    {u.finalUrl && <Row label="Przekierowanie" mono>{u.finalUrl}</Row>}
                    {Object.entries(u.headers ?? {}).map(([k, v]) => (
                      <Row key={k} label={k} mono>
                        {v}
                      </Row>
                    ))}
                  </dl>
                  {u.body && (
                    <pre className="max-h-48 overflow-auto border-t px-3 py-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">
                      {u.body}
                    </pre>
                  )}
                </div>
              )}
            </div>
            {steps && steps.length > 0 && (
              <div className="min-w-0">
                <h4 className="mb-2 text-xs font-medium text-muted-foreground">Przebieg zadania</h4>
                <JobSteps steps={steps} />
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
