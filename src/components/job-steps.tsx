import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  OctagonXIcon,
} from "lucide-react"

import { Spinner } from "@/components/ui/spinner"
import { fmtMs } from "@/lib/analysis"
import type { JobStep } from "@/lib/store"
import { cn } from "@/lib/utils"

const STAGE_LABEL: Record<string, string> = {
  validate: "walidacja",
  fetch: "Instagram",
  list: "Instagram",
  session: "sesja",
  normalize: "normalizacja",
  analyze: "analiza",
  image: "obrazek",
}

export function stageLabel(stage?: string | null) {
  if (!stage) return "—"
  return STAGE_LABEL[stage] ?? stage
}

export function StepIcon({ status, className }: { status: JobStep["status"]; className?: string }) {
  switch (status) {
    case "start":
    case "progress":
      return <Spinner className={cn("size-3.5 text-muted-foreground", className)} />
    case "ok":
      return <CircleCheckIcon className={cn("size-3.5 text-status-good", className)} aria-label="ok" />
    case "warn":
      return <CircleAlertIcon className={cn("size-3.5 text-status-warn", className)} aria-label="ostrzeżenie" />
    case "error":
      return <OctagonXIcon className={cn("size-3.5 text-status-bad", className)} aria-label="błąd" />
    default:
      return <CircleDashedIcon className={cn("size-3.5 text-muted-foreground", className)} />
  }
}

/** Oś kroków zadania: każdy krok z ikoną stanu, czasem i opisem wyniku. */
export function JobSteps({ steps, dense = false }: { steps: JobStep[]; dense?: boolean }) {
  if (!steps.length) {
    return <p className="text-xs text-muted-foreground">Czekam na pierwszy krok z serwera…</p>
  }
  return (
    <ol className={cn("flex flex-col", dense ? "gap-0.5" : "gap-1")}>
      {steps.map((s) => (
        <li key={s.id} className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-x-2 text-xs">
          <span className="mt-0.5">
            <StepIcon status={s.status} />
          </span>
          <span className="min-w-0">
            <span className={cn("font-medium", s.status === "error" && "text-status-bad")}>{s.label}</span>
            {s.detail && (
              <span className="block truncate text-muted-foreground" title={s.detail}>
                {s.detail}
              </span>
            )}
          </span>
          <span className="tnum text-muted-foreground">{fmtMs(s.ms)}</span>
        </li>
      ))}
    </ol>
  )
}
