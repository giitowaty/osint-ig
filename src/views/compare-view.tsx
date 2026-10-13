import * as React from "react"
import { ColumnsIcon, XIcon } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { IgImage } from "@/components/ig-image"
import { PageBody, Panel, statsOf } from "@/components/profile-parts"
import { openQueue } from "@/components/queue-sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { contentSummary, fmt, fmtCompact, ratio } from "@/lib/analysis"
import { navigate, useStore, type ProfileEntry } from "@/lib/store"
import { cn } from "@/lib/utils"
import { ListPager } from "@/components/list-pager"
import { pageSlice } from "@/lib/large-lists"
import { Input } from "@/components/ui/input"

type Better = "high" | "low" | null

interface Metric {
  key: string
  label: string
  better: Better
  value: (e: ProfileEntry) => number | null
  show: (v: number | null, e: ProfileEntry) => React.ReactNode
}

const METRICS: Metric[] = [
  { key: "followers", label: "Obserwujący", better: "high", value: (e) => statsOf(e).followers, show: (v) => fmt(v) },
  { key: "following", label: "Obserwuje", better: null, value: (e) => statsOf(e).following, show: (v) => fmt(v) },
  { key: "posts", label: "Posty", better: "high", value: (e) => statsOf(e).posts, show: (v) => fmt(v) },
  { key: "ratio", label: "Ratio", better: "high", value: (e) => ratio(statsOf(e)), show: (v) => (v == null ? "—" : v.toFixed(2)) },
  {
    key: "er",
    label: "Zaangażowanie",
    better: "high",
    value: (e) => (e.data ? contentSummary(e.data)?.engagement ?? null : null),
    show: (v) => (v == null ? "—" : `${v.toFixed(2)}%`),
  },
  {
    key: "likes",
    label: "Śr. polubień",
    better: "high",
    value: (e) => (e.data ? contentSummary(e.data)?.avgLikes ?? null : null),
    show: (v) => fmt(v),
  },
  {
    key: "comments",
    label: "Śr. komentarzy",
    better: "high",
    value: (e) => (e.data ? contentSummary(e.data)?.avgComments ?? null : null),
    show: (v) => fmt(v),
  },
  {
    key: "cadence",
    label: "Post co (dni)",
    better: "low",
    value: (e) => (e.data ? contentSummary(e.data)?.cadenceDays ?? null : null),
    show: (v) => (v == null ? "—" : v.toFixed(1)),
  },
  {
    key: "conn",
    label: "Powiązane konta",
    better: "high",
    value: (e) => e.data?.connections.length ?? null,
    show: (v) => fmt(v),
  },
  {
    key: "pos",
    label: "Pozytywne komentarze",
    better: "high",
    value: (e) => (e.data?.content?.sentiment?.available ? e.data.content.sentiment.positivePct : null),
    show: (v) => (v == null ? "—" : `${v}%`),
  },
]

function connSet(e: ProfileEntry) {
  return new Set([...(e.data?.connections ?? []).map((c) => c.username), ...(e.following ?? []), ...(e.followers ?? [])])
}

export function CompareView() {
  const order = useStore((s) => s.order)
  const profiles = useStore((s) => s.profiles)
  const [hidden, setHidden] = React.useState<string[]>([])
  const [page, setPage] = React.useState(0)
  const [query, setQuery] = React.useState("")
  const search = React.useDeferredValue(query.toLowerCase().replace(/^@/, ""))
  const eligible = React.useMemo(() => {
    const omitted = new Set(hidden)
    return order.map((u) => profiles[u]).filter((e): e is ProfileEntry => !!e?.data && !omitted.has(e.username) && (!search || e.username.includes(search)))
  }, [order, profiles, hidden, search])
  const visible = React.useMemo(() => pageSlice(eligible, page, 6), [eligible, page])
  const list = visible.items

  const matrix = React.useMemo(() => {
    const sets = list.map(connSet)
    return list.map((_, i) =>
      list.map((__, j) => {
        if (i === j) return null
        const shared = [...sets[i]].filter((x) => sets[j].has(x))
        return shared
      })
    )
  }, [list])

  if (order.length < 2) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ColumnsIcon />
          </EmptyMedia>
          <EmptyTitle>Porównanie potrzebuje co najmniej dwóch profili</EmptyTitle>
          <EmptyDescription>
            Przeanalizuj kilka kont (najwygodniej kolejką), a zobaczysz je obok siebie: liczby, zaangażowanie, tematykę i to, ile
            powiązań mają wspólnych.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={openQueue}>Analizuj wiele kont</Button>
          {hidden.length > 0 && (
            <Button variant="outline" onClick={() => setHidden([])}>
              Pokaż ukryte ({hidden.length})
            </Button>
          )}
        </EmptyContent>
      </Empty>
    )
  }

  const erData = list.map((e) => ({ name: `@${e.username}`, value: contentSummary(e.data!)?.engagement ?? 0 }))
  const erConfig: ChartConfig = { value: { label: "Zaangażowanie %", color: "var(--series-1)" } }

  return (
    <PageBody>
      <div className="flex flex-wrap items-center gap-3">
        <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} aria-label="Szukaj profili do porównania" placeholder="Filtruj porównanie po nazwie konta…" className="max-w-sm" />
        <span className="text-xs text-muted-foreground">Pokazano {list.length} z {eligible.length.toLocaleString("pl-PL")} profili. Porównanie i wspólne powiązania dotyczą tej strony.</span>
        <ListPager page={visible.page} pages={visible.pages} onChange={setPage} label="Porównanie" />
      </div>
      {!list.length && <p className="text-sm text-muted-foreground">Brak gotowych profili pasujących do filtra.</p>}
      <Panel
        title={`Porównanie · ${list.length} profili`}
        description="Najlepsza wartość w wierszu jest pogrubiona. Kliknij nagłówek, aby otworzyć profil."
        action={
          hidden.length ? (
            <Button size="xs" variant="ghost" onClick={() => setHidden([])}>
              Pokaż ukryte ({hidden.length})
            </Button>
          ) : undefined
        }
        contentClassName="px-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 z-10 bg-card px-4 py-2 text-left text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                  Metryka
                </th>
                {list.map((e) => (
                  <th key={e.username} className="min-w-40 px-4 py-2 text-left font-normal">
                    <div className="flex items-center gap-2">
                      <IgImage
                        src={e.data!.profile.avatar}
                        className="size-8 shrink-0"
                        fallback={<span className="text-xs uppercase">{e.username[0]}</span>}
                      />
                      <button
                        type="button"
                        onClick={() => navigate("overview", e.username)}
                        className="min-w-0 truncate text-left font-semibold hover:underline"
                      >
                        @{e.username}
                      </button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => setHidden((h) => [...h, e.username])}
                        aria-label={`Ukryj @${e.username} w porównaniu`}
                      >
                        <XIcon />
                      </Button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60">
                <td className="sticky left-0 bg-card px-4 py-2 text-muted-foreground">Archetyp</td>
                {list.map((e) => (
                  <td key={e.username} className="px-4 py-2">
                    {e.data!.content?.classification?.primary ?? "—"}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-border/60">
                <td className="sticky left-0 bg-card px-4 py-2 text-muted-foreground">Główny temat</td>
                {list.map((e) => (
                  <td key={e.username} className="px-4 py-2">
                    {e.data!.content?.topics?.topics?.[0]?.category ?? "—"}
                  </td>
                ))}
              </tr>
              {METRICS.map((m) => {
                const vals = list.map((e) => m.value(e))
                const nums = vals.filter((v): v is number => v != null)
                const best = m.better && nums.length > 1 ? (m.better === "high" ? Math.max(...nums) : Math.min(...nums)) : null
                const max = Math.max(1e-9, ...nums)
                return (
                  <tr key={m.key} className="border-b border-border/60">
                    <td className="sticky left-0 bg-card px-4 py-2 text-muted-foreground">{m.label}</td>
                    {list.map((e, i) => {
                      const v = vals[i]
                      return (
                        <td key={e.username} className="px-4 py-2">
                          <div className="flex flex-col gap-1">
                            <span className={cn("tnum", v != null && v === best && "font-semibold")}>{m.show(v, e)}</span>
                            {v != null && m.better && (
                              <span className="h-1 w-full bg-muted">
                                <span className="block h-full bg-series-1" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
                              </span>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              <tr>
                <td className="sticky left-0 bg-card px-4 py-2 text-muted-foreground">Tagi</td>
                {list.map((e) => (
                  <td key={e.username} className="px-4 py-2">
                    <span className="flex flex-wrap gap-1">
                      {(e.tags ?? []).length ? (
                        e.tags!.map((t) => (
                          <Badge key={t} variant="outline">
                            {t}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 2xl:grid-cols-2">
        <Panel title="Zaangażowanie" description="(śr. polubienia + komentarze) ÷ obserwujący, z ostatnich postów">
          <ChartContainer config={erConfig} className="aspect-auto h-64 w-full">
            <BarChart data={erData} margin={{ left: 4, right: 4, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--grid-line)" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
              <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
              <ChartTooltip
                cursor={{ fill: "var(--muted)" }}
                content={<ChartTooltipContent formatter={(v) => <span className="tnum font-medium">{Number(v).toFixed(2)}%</span>} hideIndicator />}
              />
              <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ChartContainer>
        </Panel>

        <Panel
          title="Wspólne powiązania"
          description="Ile kont łączy każdą parę profili (oznaczenia, wzmianki i wczytane listy). Najedź, by zobaczyć które."
        >
          <div className="overflow-x-auto">
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  <th />
                  {list.map((e) => (
                    <th key={e.username} className="max-w-28 truncate px-2 pb-2 text-left text-xs font-medium">
                      @{e.username}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((row, i) => {
                  const maxShared = Math.max(1, ...matrix.flat().map((x) => x?.length ?? 0))
                  return (
                    <tr key={row.username}>
                      <th className="max-w-32 truncate pr-3 text-left text-xs font-medium">@{row.username}</th>
                      {list.map((col, j) => {
                        const shared = matrix[i][j]
                        if (!shared) return <td key={col.username} className="size-12 bg-muted/40" />
                        const a = shared.length / maxShared
                        return (
                          <td key={col.username} className="p-0.5">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  className="tnum flex size-12 items-center justify-center text-sm font-semibold"
                                  style={{
                                    background: `color-mix(in oklch, var(--series-1) ${Math.round(a * 85)}%, var(--muted))`,
                                    color: a > 0.55 ? "white" : undefined,
                                  }}
                                >
                                  {shared.length}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                {shared.length
                                  ? shared.slice(0, 25).map((x) => "@" + x).join(", ") + (shared.length > 25 ? ` i ${shared.length - 25} więcej` : "")
                                  : "brak wspólnych kont"}
                              </TooltipContent>
                            </Tooltip>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Łącznie {fmtCompact(new Set(list.flatMap((e) => [...connSet(e)])).size)} unikalnych powiązanych kont.
          </p>
        </Panel>
      </div>
    </PageBody>
  )
}
