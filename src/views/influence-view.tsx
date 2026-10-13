import * as React from "react"
import { ArrowDownIcon, MedalIcon } from "lucide-react"
import { Bar, BarChart, XAxis, YAxis } from "recharts"

import { PageBody, Panel } from "@/components/profile-parts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { analyze } from "@/lib/actions"
import { centralities, INFLUENCE_HINT, INFLUENCE_LABEL, rankInfluential, type GraphModel, type Influence, type NodeInfluence } from "@/lib/graph"
import { navigate, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { useGraphModel } from "@/views/network-view"

type SortKey = "score" | "pagerank" | "betweenness" | "degree" | "eigenvector" | "sources"

const COLS: { key: SortKey; label: string; hint: string }[] = [
  { key: "score", label: "Wynik", hint: "0,5·PageRank + 0,3·stopień + 0,2·wektor własny (znormalizowane)" },
  { key: "pagerank", label: "PageRank", hint: "jak ważne konta na niego wskazują" },
  { key: "betweenness", label: "Pośredniość", hint: "jak często leży na najkrótszej ścieżce między innymi" },
  { key: "degree", label: "Stopień", hint: "udział bezpośrednich relacji" },
  { key: "eigenvector", label: "Wektor własny", hint: "powiązania z dobrze powiązanymi" },
  { key: "sources", label: "Profile", hint: "ile analizowanych profili go wskazuje" },
]

const INF_ORDER: Influence[] = ["hub", "bridge", "connector", "peripheral"]

/** Liczy centralności i ranking, mierząc czas obliczeń (pokazywany w UI). */
function analyzeGraph(model: GraphModel) {
  if (!model.nodes.length) return { rank: [] as NodeInfluence[], cent: null, ms: 0 }
  const t0 = performance.now()
  const c = centralities(model)
  const r = rankInfluential(model, c)
  return { rank: r, cent: c, ms: Math.round(performance.now() - t0) }
}

export function InfluenceView() {
  const [lists, setLists] = React.useState(true)
  const [hashtags, setHashtags] = React.useState(false)
  const [sort, setSort] = React.useState<SortKey>("score")
  const [limit, setLimit] = React.useState(50)
  const profiles = useStore((s) => s.profiles)
  const { model, fullModel, analyzed, truncated } = useGraphModel({ hashtags, lists, minSources: 1 })

  const { rank, cent, ms } = React.useMemo(() => analyzeGraph(model), [model])

  const sorted = React.useMemo(() => [...rank].sort((a, b) => b[sort] - a[sort]), [rank, sort])
  const counts = React.useMemo(() => {
    const m: Record<Influence, number> = { hub: 0, bridge: 0, connector: 0, peripheral: 0 }
    for (const r of rank) m[r.influence]++
    return m
  }, [rank])

  if (!analyzed.length) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MedalIcon />
          </EmptyMedia>
          <EmptyTitle>Brak sieci do policzenia</EmptyTitle>
          <EmptyDescription>
            Centralności liczą się z grafu wszystkich profili w sesji. Przeanalizuj kilka powiązanych kont, aby zobaczyć huby i mosty.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const n = model.nodes.length
  const density = n > 1 ? model.edges.length / (n * (n - 1)) : 0
  const top = sorted.slice(0, 15).map((r) => ({ name: r.kind === "hashtag" ? r.node : `@${r.node}`, value: r[sort] }))
  const config: ChartConfig = { value: { label: COLS.find((c) => c.key === sort)!.label, color: "var(--series-1)" } }

  return (
    <PageBody>
      {truncated && <p className="border bg-muted/20 p-3 text-sm">Ranking dotyczy fragmentu sieci wokół bieżącego profilu: {model.nodes.length} z {fullModel.nodes.length.toLocaleString("pl-PL")} węzłów. Otwórz inny profil, aby zmienić zakres. Wyniki nie opisują całej sieci.</p>}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Label className="flex items-center gap-2 text-xs font-normal">
          <Switch size="sm" checked={lists} onCheckedChange={setLists} />
          Uwzględnij listy obserwujących
        </Label>
        <Label className="flex items-center gap-2 text-xs font-normal">
          <Switch size="sm" checked={hashtags} onCheckedChange={setHashtags} />
          Uwzględnij hashtagi
        </Label>
        <span className="tnum ml-auto text-xs text-muted-foreground">
          policzono w {ms} ms{cent?.degenerate.length ? ` · ${cent.degenerate.join(", ")}: brak zbieżności (wyzerowano)` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 border bg-card sm:grid-cols-4 xl:grid-cols-8">
        {[
          ["Profile", analyzed.length],
          ["Węzły", n],
          ["Relacje", model.edges.length],
          ["Gęstość", density.toFixed(4)],
          ...INF_ORDER.map((k) => [INFLUENCE_LABEL[k], counts[k]] as const),
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 border-r border-b border-border/70 px-4 py-3 xl:border-b-0">
            <span className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{label}</span>
            <span className="tnum text-xl font-semibold">{value}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Panel title={`Top 15 · ${config.value.label}`} description={COLS.find((c) => c.key === sort)!.hint}>
          <ChartContainer config={config} className="aspect-auto h-[420px] w-full">
            <BarChart data={top} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} interval={0} />
              <ChartTooltip
                cursor={{ fill: "var(--muted)" }}
                content={<ChartTooltipContent formatter={(v) => <span className="tnum font-medium">{Number(v).toFixed(4)}</span>} hideIndicator />}
              />
              <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} maxBarSize={20} />
            </BarChart>
          </ChartContainer>
        </Panel>

        <Panel
          title="Ranking wpływu"
          description="Kliknij nagłówek kolumny, aby sortować. Rodzaje: hub, most, łącznik, peryferia."
          contentClassName="px-0"
        >
          <div className="max-h-[560px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-10 pl-4">#</TableHead>
                  <TableHead>Węzeł</TableHead>
                  <TableHead>Rodzaj</TableHead>
                  {COLS.map((c) => (
                    <TableHead key={c.key} className="text-right">
                      <button
                        type="button"
                        title={c.hint}
                        onClick={() => setSort(c.key)}
                        className={cn("inline-flex items-center gap-1 hover:text-foreground", sort === c.key && "text-foreground")}
                      >
                        {c.label}
                        {sort === c.key && <ArrowDownIcon className="size-3" />}
                      </button>
                    </TableHead>
                  ))}
                  <TableHead className="w-0 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.slice(0, limit).map((r, i) => (
                  <TableRow key={r.node}>
                    <TableCell className="tnum pl-4 text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="max-w-48 truncate font-medium">
                      {r.kind === "hashtag" ? r.node : `@${r.node}`}
                      {r.kind === "analyzed" && <span className="ml-1.5 text-[10px] text-muted-foreground uppercase">analizowany</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" title={INFLUENCE_HINT[r.influence]}>
                        {INFLUENCE_LABEL[r.influence]}
                      </Badge>
                    </TableCell>
                    {COLS.map((c) => (
                      <TableCell key={c.key} className={cn("tnum text-right", sort === c.key && "font-semibold")}>
                        {c.key === "sources" ? r.sources : r[c.key].toFixed(c.key === "score" ? 3 : 4)}
                      </TableCell>
                    ))}
                    <TableCell className="pr-4">
                      {r.kind === "analyzed" ? (
                        <Button size="xs" variant="ghost" onClick={() => navigate("overview", r.node)}>
                          Profil
                        </Button>
                      ) : r.kind === "account" && !profiles[r.node] ? (
                        <Button size="xs" variant="ghost" onClick={() => void analyze(r.node, { focus: false })}>
                          Analizuj
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {sorted.length > limit && (
            <div className="border-t px-4 pt-3">
              <Button size="xs" variant="outline" onClick={() => setLimit((l) => l + 100)}>
                Pokaż kolejne ({sorted.length - limit})
              </Button>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Jak czytać rodzaje wpływu">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {INF_ORDER.map((k) => (
            <div key={k}>
              <dt className="font-heading text-base font-semibold">{INFLUENCE_LABEL[k]}</dt>
              <dd className="text-muted-foreground">{INFLUENCE_HINT[k]}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </PageBody>
  )
}
