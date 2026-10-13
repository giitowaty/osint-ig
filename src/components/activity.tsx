import * as React from "react"
import {
  ArrowDownToLineIcon,
  BanIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  OctagonXIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import { ErrorPanel } from "@/components/error-panel"
import { useNow } from "@/hooks/use-now"
import { JobSteps, StepIcon } from "@/components/job-steps"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { analyze } from "@/lib/actions"
import { fmtMs, fmtTime } from "@/lib/analysis"
import {
  cancelJob,
  clearFinishedJobs,
  clearLogs,
  useStore,
  type Job,
  type LogEntry,
  type LogLevel,
  type LogSource,
} from "@/lib/store"
import { cn } from "@/lib/utils"

const SOURCE_LABEL: Record<LogSource, string> = {
  app: "app",
  server: "serwer",
  ig: "IG",
  engine: "silnik",
}

function LevelIcon({ level }: { level: LogLevel }) {
  switch (level) {
    case "ok":
      return <CircleCheckIcon className="size-3.5 text-status-good" aria-label="ok" />
    case "warn":
      return <CircleAlertIcon className="size-3.5 text-status-warn" aria-label="ostrzeżenie" />
    case "error":
      return <OctagonXIcon className="size-3.5 text-status-bad" aria-label="błąd" />
    default:
      return <InfoIcon className="size-3.5 text-muted-foreground" aria-label="info" />
  }
}

type LevelFilter = "all" | "warn" | "error"

function LogRow({ e }: { e: LogEntry }) {
  const [open, setOpen] = React.useState(false)
  const expandable = !!e.error
  return (
    <li
      className={cn(
        "group border-b border-border/50 last:border-0",
        e.level === "error" && "bg-status-bad/[0.05]",
        e.level === "warn" && "bg-status-warn/[0.05]"
      )}
    >
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[86px_16px_52px_minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-1 text-left text-xs enabled:cursor-pointer enabled:hover:bg-muted/50"
      >
        <span className="tnum font-mono text-[11px] text-muted-foreground">{fmtTime(e.at)}</span>
        <span className="mt-px">
          <LevelIcon level={e.level} />
        </span>
        <span className="truncate text-[11px] text-muted-foreground uppercase">{SOURCE_LABEL[e.source]}</span>
        <span className="min-w-0">
          <span className="flex items-center gap-1">
            {expandable && (
              <ChevronRightIcon className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
            )}
            <span className={cn("break-words", e.level === "error" && "font-medium")}>{e.message}</span>
          </span>
          {e.detail && <span className="block break-words text-muted-foreground">{e.detail}</span>}
        </span>
        <span className="tnum text-[11px] text-muted-foreground">{fmtMs(e.ms)}</span>
      </button>
      {open && e.error && (
        <div className="px-3 pb-3">
          <ErrorPanel error={e.error} compact />
        </div>
      )}
    </li>
  )
}

/** Strumień logów na żywo z filtrem poziomu i przyklejaniem do dołu. */
export function LogStream({ className, toolbar = true }: { className?: string; toolbar?: boolean }) {
  const logs = useStore((s) => s.logs)
  const [level, setLevel] = React.useState<LevelFilter>("all")
  const [stick, setStick] = React.useState(true)
  const ref = React.useRef<HTMLDivElement>(null)

  const shown = React.useMemo(() => {
    const f =
      level === "all" ? logs : logs.filter((l) => (level === "error" ? l.level === "error" : l.level === "warn" || l.level === "error"))
    return f.slice(-800)
  }, [logs, level])

  const counts = React.useMemo(() => {
    let warn = 0
    let error = 0
    for (const l of logs) {
      if (l.level === "warn") warn++
      else if (l.level === "error") error++
    }
    return { warn, error }
  }, [logs])

  React.useLayoutEffect(() => {
    const el = ref.current
    if (el && stick) el.scrollTop = el.scrollHeight
  }, [shown, stick])

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {toolbar && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={level}
            onValueChange={(v) => v && setLevel(v as LevelFilter)}
          >
            <ToggleGroupItem value="all" className="h-7 px-2 text-xs">
              Wszystko <span className="tnum text-muted-foreground">{logs.length}</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="warn" className="h-7 px-2 text-xs">
              Ostrzeżenia <span className="tnum text-muted-foreground">{counts.warn + counts.error}</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="error" className="h-7 px-2 text-xs">
              Błędy <span className="tnum text-muted-foreground">{counts.error}</span>
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant={stick ? "secondary" : "ghost"}
                  aria-pressed={stick}
                  onClick={() => setStick((v) => !v)}
                  aria-label="Przewijaj do najnowszych"
                >
                  <ArrowDownToLineIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Przewijaj do najnowszych</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" onClick={clearLogs} aria-label="Wyczyść log">
                  <Trash2Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Wyczyść log</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
      <div
        ref={ref}
        className="min-h-0 flex-1 overflow-auto"
        onWheel={(ev) => {
          if (ev.deltaY < 0 && stick) setStick(false)
        }}
      >
        {shown.length ? (
          <ul>
            {shown.map((e) => (
              <LogRow key={e.id} e={e} />
            ))}
          </ul>
        ) : (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {level === "all" ? "Tu pojawi się każdy krok: zapytania do Instagrama, analiza, błędy." : "Brak wpisów dla tego filtra."}
          </p>
        )}
      </div>
    </div>
  )
}

function JobCard({ job }: { job: Job }) {
  const [open, setOpen] = React.useState(job.status !== "ok")
  const now = useNow(job.status === "running")
  const ms = (job.endedAt ?? now) - job.startedAt
  const last = job.steps[job.steps.length - 1]
  const statusIcon =
    job.status === "running" ? (
      <StepIcon status="progress" />
    ) : job.status === "ok" ? (
      <StepIcon status="ok" />
    ) : job.status === "cancelled" ? (
      <BanIcon className="size-3.5 text-muted-foreground" />
    ) : (
      <StepIcon status="error" />
    )
  return (
    <li className="border-b border-border/60 last:border-0">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
        >
          <ChevronRightIcon className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
          {statusIcon}
          <span className="truncate font-medium">{job.label}</span>
          {job.status === "running" && last && (
            <span className="truncate text-muted-foreground">· {last.label}</span>
          )}
        </button>
        <span className="tnum shrink-0 text-[11px] text-muted-foreground">{fmtMs(ms)}</span>
        {job.status === "running" ? (
          <Button size="icon-xs" variant="ghost" onClick={() => cancelJob(job.id)} aria-label="Anuluj zadanie">
            <XIcon />
          </Button>
        ) : job.status === "error" && job.kind === "profile" && job.target ? (
          <Button size="xs" variant="ghost" onClick={() => void analyze(job.target!, { focus: false })}>
            Ponów
          </Button>
        ) : null}
      </div>
      {job.status === "running" && job.progress && (
        <div className="flex items-center gap-2 px-3 pb-1.5 pl-8">
          <Progress value={(job.progress.current / Math.max(1, job.progress.total)) * 100} className="h-1" />
          <span className="tnum shrink-0 text-[11px] text-muted-foreground">
            {job.progress.current}/{job.progress.total}
          </span>
        </div>
      )}
      {open && (
        <div className="px-3 pb-2 pl-8">
          <JobSteps steps={job.steps} dense />
          {job.error && (
            <p className="mt-1 text-xs text-status-bad">
              {job.error.code}: {job.error.message}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

export function JobsList({ className }: { className?: string }) {
  const jobs = useStore((s) => s.jobs)
  const running = jobs.filter((j) => j.status === "running").length
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
        <span className="font-medium">Zadania</span>
        {running > 0 && <Badge variant="secondary">{running} w toku</Badge>}
        <Button size="xs" variant="ghost" className="ml-auto" onClick={clearFinishedJobs} disabled={!jobs.length}>
          Wyczyść zakończone
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {jobs.length ? (
          <ul>
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
          </ul>
        ) : (
          <Empty className="py-6">
            <EmptyHeader>
              <EmptyTitle className="text-sm">Brak zadań</EmptyTitle>
              <EmptyDescription className="text-xs">Każda analiza i pobranie listy pojawi się tu z krokami i czasem.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}
