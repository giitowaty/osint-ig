import * as React from "react"
import {
  BadgeCheckIcon,
  BriefcaseBusinessIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  DotIcon,
  ClipboardCopyIcon,
  ExternalLinkIcon,
  FileJsonIcon,
  LinkIcon,
  LockIcon,
  PrinterIcon,
  RotateCwIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ErrorPanel } from "@/components/error-panel"
import { IgImage } from "@/components/ig-image"
import { JobSteps } from "@/components/job-steps"
import { openFollowersQueue } from "@/components/queue-sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { analyze, setManual } from "@/lib/actions"
import { contentSummary, downloadJson, exportText, fmt, fmtCompact, fmtDate, insights, ratio, type Stats } from "@/lib/analysis"
import { openExternal } from "@/lib/runtime"
import { useStore, type ProfileEntry } from "@/lib/store"
import type { ProfilePayload } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Welcome } from "@/views/welcome"

/* ------------------------------- Panel ---------------------------------- */

export function Panel({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <Card size="sm" className={cn("min-w-0 gap-3 shadow-none", className)}>
      <CardHeader>
        <CardTitle className="text-sm tracking-widest">{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={cn("min-w-0", contentClassName)}>{children}</CardContent>
    </Card>
  )
}

export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-4 p-4 xl:p-5", className)}>{children}</div>
}

/* ----------------------------- Statystyki -------------------------------- */

export function statsOf(entry: ProfileEntry): Stats {
  const p = entry.data?.profile
  return {
    followers: entry.manual?.followers ?? p?.followers ?? null,
    following: entry.manual?.following ?? p?.following ?? null,
    posts: entry.manual?.posts ?? p?.posts ?? null,
  }
}

function StatCell({
  label,
  value,
  hint,
  editKey,
  username,
  raw,
}: {
  label: string
  value: string
  hint?: string
  editKey?: "followers" | "following" | "posts"
  username?: string
  raw?: number | null
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-r border-border/70 px-4 py-3 last:border-r-0">
      <span className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{label}</span>
      {editKey && username ? (
        <input
          type="number"
          min={0}
          inputMode="numeric"
          defaultValue={raw ?? ""}
          placeholder="—"
          aria-label={`${label} (ręcznie)`}
          onChange={(e) => setManual(username, editKey, e.target.value === "" ? null : Number(e.target.value))}
          className="tnum h-8 w-full min-w-0 border-b border-dashed border-input bg-transparent text-xl font-semibold outline-none focus:border-ring"
        />
      ) : (
        <span className="tnum truncate text-xl font-semibold" title={value}>
          {value}
        </span>
      )}
      {hint && <span className="truncate text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function StatStrip({ entry, editable }: { entry: ProfileEntry; editable?: boolean }) {
  const s = statsOf(entry)
  const r = ratio(s)
  const sum = entry.data ? contentSummary(entry.data) : null
  const u = editable ? entry.username : undefined
  return (
    <div className="grid grid-cols-2 border bg-card sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7 [&>*]:border-b [&>*]:border-border/70 2xl:[&>*]:border-b-0">
      <StatCell label="Obserwujący" value={fmt(s.followers)} hint={fmtCompact(s.followers)} editKey="followers" username={u} raw={s.followers} />
      <StatCell label="Obserwuje" value={fmt(s.following)} editKey="following" username={u} raw={s.following} />
      <StatCell label="Posty" value={fmt(s.posts)} editKey="posts" username={u} raw={s.posts} />
      <StatCell label="Ratio" value={r == null ? "—" : r.toFixed(2)} hint="obserwujący ÷ obserwowani" />
      <StatCell
        label="Zaangażowanie"
        value={sum?.engagement != null ? `${sum.engagement.toFixed(2)}%` : "—"}
        hint={sum ? `z ${sum.count} ost. postów` : "brak postów"}
      />
      <StatCell label="Śr. polubień" value={fmt(sum?.avgLikes)} hint={sum?.medianLikes != null ? `mediana ${fmt(sum.medianLikes)}` : undefined} />
      <StatCell
        label="Częstotliwość"
        value={sum?.cadenceDays != null ? `co ${sum.cadenceDays.toFixed(1)} d` : "—"}
        hint={sum?.span ? `${fmtDate(sum.span.from)} – ${fmtDate(sum.span.to)}` : undefined}
      />
    </div>
  )
}

/* ----------------------------- Nagłówek ---------------------------------- */

export function ProfileHeader({ entry }: { entry: ProfileEntry }) {
  const data = entry.data
  const p = data?.profile
  const username = entry.username
  const loading = entry.status === "loading"
  const cookie = useStore((s) => s.session.cookie)

  const copy = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(exportText(data))
      toast.success("Skopiowano podsumowanie")
    } catch {
      toast.error("Schowek niedostępny")
    }
  }

  return (
    <div className="flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 gap-4">
        <IgImage
          src={p?.avatar ?? ""}
          className="size-20 shrink-0 xl:size-24"
          fallback={<span className="font-heading text-3xl uppercase">{username[0]}</span>}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="font-heading text-3xl leading-none font-semibold tracking-tight break-all xl:text-4xl">
              @{p?.username ?? username}
            </h1>
            {p?.verified && <BadgeCheckIcon className="size-5 text-series-1" aria-label="zweryfikowane" />}
            {p?.private && (
              <Badge variant="outline" className="gap-1">
                <LockIcon className="size-3" /> prywatny
              </Badge>
            )}
            {(p?.isBusiness || p?.isProfessional) && (
              <Badge variant="outline" className="gap-1">
                <BriefcaseBusinessIcon className="size-3" />
                {p.isBusiness ? "firma" : "twórca"}
              </Badge>
            )}
            {loading && <Spinner className="size-4" />}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {p?.fullName && <span className="text-foreground">{p.fullName}</span>}
            {p?.category && <span>{p.category}</span>}
            {data?.fetchedAt && (
              <span className="text-xs">
                pobrano {new Date(data.fetchedAt).toLocaleTimeString("pl-PL")}
                {data.ms != null ? ` w ${(data.ms / 1000).toFixed(2)} s` : ""}
              </span>
            )}
          </div>
          {p?.bio && <p className="max-w-[75ch] text-sm whitespace-pre-line">{p.bio}</p>}
          {p?.externalUrl && (
            <button
              type="button"
              onClick={() => void openExternal(p.externalUrl)}
              className="inline-flex w-fit max-w-full items-center gap-1.5 text-sm text-series-1 underline-offset-4 hover:underline"
            >
              <LinkIcon className="size-3.5 shrink-0" />
              <span className="truncate">{p.externalUrl.replace(/^https?:\/\//, "")}</span>
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 lg:justify-end" data-print-hide>
        <Button size="xs" variant="outline" onClick={() => openFollowersQueue(username)}
          disabled={loading || !p?.id || p.private || !cookie} title={!cookie ? "Najpierw połącz konto w Sesja IG" : p?.private ? "Wybierz publiczny profil" : undefined}>
          <UsersIcon data-icon="inline-start" />
          Analizuj obserwujących
        </Button>
        <Button size="xs" variant="outline" onClick={() => void analyze(username, { focus: false, fresh: true })} disabled={loading}>
          <RotateCwIcon data-icon="inline-start" />
          Odśwież
        </Button>
        <Button size="xs" variant="outline" onClick={() => void openExternal(`https://www.instagram.com/${username}/`)}>
          <ExternalLinkIcon data-icon="inline-start" />
          Instagram
        </Button>
        <Button size="xs" variant="outline" onClick={copy} disabled={!data}>
          <ClipboardCopyIcon data-icon="inline-start" />
          Kopiuj
        </Button>
        <Button size="xs" variant="outline" onClick={() => data && downloadJson(`osint-ig-${username}.json`, data)} disabled={!data}>
          <FileJsonIcon data-icon="inline-start" />
          JSON
        </Button>
        <Button size="xs" variant="outline" onClick={() => window.print()} disabled={!data}>
          <PrinterIcon data-icon="inline-start" />
          PDF
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------- Bramka ---------------------------------- */

function LoadingState({ entry }: { entry: ProfileEntry }) {
  const job = useStore((s) => s.jobs.find((j) => j.id === entry.jobId))
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-4">
        <div className="flex gap-4">
          <Skeleton className="size-24" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-full max-w-xl" />
          </div>
        </div>
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
      <Panel title="Co się teraz dzieje" description={`Analiza @${entry.username} krok po kroku, prosto z serwera.`}>
        <JobSteps steps={job?.steps ?? []} />
      </Panel>
    </div>
  )
}

/**
 * Obsługuje stany profilu wspólne dla widoków Przegląd/Treści/Odbiorcy:
 * brak profilu → ekran startowy, ładowanie → kroki na żywo, błąd → diagnostyka,
 * dane → children(data).
 */
export function ProfileGate({
  children,
}: {
  children: (entry: ProfileEntry & { data: ProfilePayload }) => React.ReactNode
}) {
  const active = useStore((s) => s.active)
  const entry = useStore((s) => (s.active ? s.profiles[s.active] : undefined))
  const job = useStore((s) => (entry?.jobId ? s.jobs.find((j) => j.id === entry.jobId) : undefined))
  const [manual, setManualMode] = React.useState(false)

  if (!active || !entry) return <Welcome />

  if (!entry.data) {
    if (entry.status === "loading") {
      return (
        <PageBody>
          <LoadingState entry={entry} />
        </PageBody>
      )
    }
    return (
      <PageBody>
        <ProfileHeader entry={entry} />
        {entry.error && (
          <ErrorPanel
            error={entry.error}
            steps={job?.steps}
            onRetry={() => void analyze(entry.username, { focus: false })}
            onManual={manual ? undefined : () => setManualMode(true)}
            profileUrl={`https://www.instagram.com/${entry.username}/`}
          />
        )}
        {(manual || entry.manual) && (
          <Panel
            title="Tryb ręczny"
            description="Przepisz liczby z profilu na Instagramie: ratio i wnioski przeliczą się na żywo."
          >
            <StatStrip entry={entry} editable />
            <ManualInsights entry={entry} />
          </Panel>
        )}
      </PageBody>
    )
  }

  return (
    <>
      {entry.error && entry.status !== "loading" && (
        <div className="px-4 pt-4 xl:px-5">
          <ErrorPanel
            error={entry.error}
            steps={job?.steps}
            compact
            onRetry={() => void analyze(entry.username, { focus: false })}
          />
        </div>
      )}
      {children(entry as ProfileEntry & { data: ProfilePayload })}
    </>
  )
}

/* ------------------------------- Wnioski --------------------------------- */

const TONE_ICON = {
  good: <CircleCheckIcon className="size-4 text-status-good" />,
  warn: <CircleAlertIcon className="size-4 text-status-warn" />,
  neutral: <DotIcon className="size-4 text-muted-foreground" />,
}

export function InsightsList({ entry }: { entry: ProfileEntry }) {
  const p = entry.data?.profile ?? {
    username: entry.username, fullName: "", bio: "", externalUrl: "", avatar: "",
    verified: false, private: false, category: "", followers: null, following: null, posts: null,
  }
  const items = insights(p, statsOf(entry))
  return (
    <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map((i) => (
        <li key={i.key} className="flex gap-2 text-sm">
          <span className="mt-0.5 shrink-0">{TONE_ICON[i.tone]}</span>
          <span className="min-w-0">
            <span className="font-medium">{i.title}</span>
            <span className="block text-xs text-muted-foreground">{i.text}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function ManualInsights({ entry }: { entry: ProfileEntry }) {
  return (
    <div className="mt-4">
      <InsightsList entry={entry} />
    </div>
  )
}
