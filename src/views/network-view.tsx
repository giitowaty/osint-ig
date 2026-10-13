import * as React from "react"
import {
  BracesIcon,
  CircleDotIcon,
  DatabaseIcon,
  FileDownIcon,
  ImageIcon,
  SheetIcon,
  DownloadIcon,
  ListPlusIcon,
  MaximizeIcon,
  SearchIcon,
  WaypointsIcon,
  XIcon,
} from "lucide-react"

import { BubbleChart } from "@/components/bubble-chart"
import { ForceGraph, type ForceGraphHandle } from "@/components/force-graph"
import { IgImage } from "@/components/ig-image"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { analyze, applyPastedList, fetchList, fetchListsForAll } from "@/lib/actions"
import { fmtCompact } from "@/lib/analysis"
import { cypher, downloadDataUrl, downloadText, edgesCsv, gexf, nodeLink, nodesCsv } from "@/lib/exporters"
import { buildGraph, graphPreview, rankInfluential, INFLUENCE_LABEL, type GraphModel } from "@/lib/graph"
import { navigate, setAutoLists, useStore, type ProfileEntry } from "@/lib/store"
import { cn } from "@/lib/utils"

export function useGraphModel(opts: { hashtags: boolean; lists: boolean; minSources: number; focus?: string | null }) {
  const profiles = useStore((s) => s.profiles)
  const order = useStore((s) => s.order)
  const active = useStore((s) => s.active)
  const full = React.useMemo(() => {
    const list = order.map((u) => profiles[u]).filter((p): p is ProfileEntry => !!p && p.inNetwork && !!p.data)
    return { model: buildGraph(list, opts), analyzed: list }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, order, opts.hashtags, opts.lists, opts.minSources])
  const model = React.useMemo(() => graphPreview(full.model, opts.focus ?? active), [full.model, opts.focus, active])
  return { model, fullModel: full.model, analyzed: full.analyzed, truncated: model !== full.model }
}

function Legend({ hashtags, lists }: { hashtags: boolean; lists: boolean }) {
  const item = (swatch: React.ReactNode, label: string) => (
    <li className="flex items-center gap-1.5">
      {swatch}
      {label}
    </li>
  )
  const dot = (color: string, square = false) => (
    <span className={cn("size-2.5 shrink-0", !square && "rounded-full")} style={{ background: color }} />
  )
  const line = (color: string) => <span className="h-0.5 w-4 shrink-0" style={{ background: color }} />
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {item(dot("var(--node-analyzed)"), "profil analizowany")}
      {item(dot("var(--series-2)"), "wspólne (≥2 profile)")}
      {item(dot("var(--node-account)"), "powiązane konto")}
      {hashtags && item(dot("var(--series-other)", true), "hashtag")}
      {item(line("var(--muted-foreground)"), "oznaczenie / wzmianka")}
      {lists && item(line("var(--series-1)"), "obserwuje →")}
      {lists && item(line("var(--series-3)"), "obserwujący →")}
    </ul>
  )
}

function ExportMenu({
  model,
  graphRef,
  canPng,
}: {
  model: GraphModel
  graphRef: React.RefObject<ForceGraphHandle | null>
  canPng: boolean
}) {
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")
  const large = model.nodes.length > 400 || model.edges.length > 4000
  const rank = () => large ? [] : rankInfluential(model)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="outline" disabled={!model.nodes.length}>
          <FileDownIcon data-icon="inline-start" />
          Eksport
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Obraz</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={!canPng}
            onSelect={() => {
              const url = graphRef.current?.toPng()
              if (url) downloadDataUrl(`osint-ig-graf-${stamp()}.png`, url)
            }}
          >
            <ImageIcon />
            PNG (aktualny widok)
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Dane całej sieci{large ? " (bez rankingu)" : ""}</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => {
              downloadText(`osint-ig-wezly-${stamp()}.csv`, nodesCsv(model, rank()), "text/csv")
              downloadText(`osint-ig-krawedzie-${stamp()}.csv`, edgesCsv(model), "text/csv")
            }}
          >
            <SheetIcon />
            CSV: węzły + krawędzie
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => downloadText(`osint-ig-${stamp()}.gexf`, gexf(model, rank()), "application/xml")}>
            <WaypointsIcon />
            GEXF (Gephi)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => downloadText(`osint-ig-${stamp()}.cypher`, cypher(model))}>
            <DatabaseIcon />
            Cypher (Neo4j)
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => downloadText(`osint-ig-${stamp()}.json`, JSON.stringify(nodeLink(model), null, 2), "application/json")}
          >
            <BracesIcon />
            JSON node-link (d3, networkx)
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ListsSheet() {
  const order = useStore((s) => s.order)
  const profiles = useStore((s) => s.profiles)
  const cookie = useStore((s) => s.session.cookie)
  const account = useStore((s) => s.session.account)
  const autoLists = useStore((s) => s.autoLists)
  const [acc, setAcc] = React.useState(order[0] ?? "")
  const [type, setType] = React.useState<"followers" | "following">("following")
  const [text, setText] = React.useState("")
  const [msg, setMsg] = React.useState<string | null>(null)

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="xs" variant="outline">
          <ListPlusIcon data-icon="inline-start" />
          Listy obserwujących
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Listy obserwujących i obserwowanych</SheetTitle>
          <SheetDescription>
            Dodają do grafu kierunkowe krawędzie. Pobierz je sesją IG albo wklej listę zebraną bookmarkletem.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6">
          <section className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">Stan list</h3>
            <ul className="divide-y border">
              {order.slice(0, 50).map((u) => {
                const p = profiles[u]
                return (
                  <li key={u} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">@{u}</span>
                    <span className="tnum text-xs text-muted-foreground">
                      obs. {p?.followers?.length ?? "—"} · obserwuje {p?.following?.length ?? "—"}
                    </span>
                    <Button size="xs" variant="ghost" disabled={!cookie} onClick={() => void fetchList(u, "followers").then(() => fetchList(u, "following"))}>
                      Pobierz
                    </Button>
                  </li>
                )
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="xs" disabled={!cookie || !order.length} onClick={() => void fetchListsForAll()}>
                <DownloadIcon data-icon="inline-start" />
                Pobierz wszystkie z sesji IG
              </Button>
              <span className="text-xs text-muted-foreground">
                {cookie ? (account ? `sesja: @${account}` : "sesja niezweryfikowana") : "najpierw ustaw sesję IG"}
              </span>
              {!cookie && (
                <Button size="xs" variant="link" onClick={() => navigate("session")}>
                  Ustaw sesję
                </Button>
              )}
            </div>
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Switch checked={autoLists} onCheckedChange={setAutoLists} disabled={!cookie} />
              Pobieraj listy automatycznie przy każdej analizie
            </Label>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">Wklej listę ręcznie</h3>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-2">
                <Field>
                  <FieldLabel>Konto</FieldLabel>
                  <input value={acc} onChange={(e) => setAcc(e.target.value.trim().replace(/^@/, "").toLowerCase())} aria-label="Konto do wklejenia listy" placeholder="nazwa konta w sesji" className="h-9 min-w-0 border bg-background px-2 text-sm" />
                </Field>
                <Field>
                  <FieldLabel>Rodzaj</FieldLabel>
                  <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="following">Obserwowani (to konto obserwuje)</SelectItem>
                        <SelectItem value="followers">Obserwujący (obserwują to konto)</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field>
                <FieldLabel>Nazwy kont</FieldLabel>
                <Textarea
                  rows={6}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Po spacji, przecinku lub w nowych liniach. @ i linki są w porządku."
                />
              </Field>
            </FieldGroup>
            <div className="flex items-center gap-2">
              <Button
                size="xs"
                disabled={!acc || !text.trim()}
                onClick={() => {
                  const n = applyPastedList(acc, type, text)
                  setMsg(`Wczytano ${n} kont dla @${acc}.`)
                  setText("")
                }}
              >
                Zastosuj
              </Button>
              <Button size="xs" variant="link" onClick={() => navigate("tools")}>
                Bookmarklet do zbierania list
              </Button>
            </div>
            {msg && <p className="text-xs text-status-good">{msg}</p>}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Inspector({ id, model, onClose }: { id: string; model: GraphModel; onClose: () => void }) {
  const node = model.nodes.find((n) => n.id === id)
  const profiles = useStore((s) => s.profiles)
  const rank = React.useMemo(() => rankInfluential(model), [model])
  if (!node) return null
  const r = rank.findIndex((x) => x.node === id)
  const inf = rank[r]
  const incoming = model.edges.filter((e) => e.target === id)
  const outgoing = model.edges.filter((e) => e.source === id)
  const entry = profiles[id]
  const KIND: Record<string, string> = { ref: "oznaczenie/wzmianka", following: "obserwuje", follower: "obserwujący", uses: "hashtag" }
  return (
    <aside className="flex w-full min-w-0 flex-col gap-4 overflow-y-auto border-t bg-card p-4 lg:w-80 lg:border-t-0 lg:border-l">
      <div className="flex items-start gap-3">
        {node.kind !== "hashtag" && (
          <IgImage
            src={entry?.data?.profile.avatar ?? ""}
            className="size-12 shrink-0"
            fallback={<span className="font-heading text-lg uppercase">{id[0]}</span>}
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-xl font-semibold break-all">{node.kind === "hashtag" ? id : `@${id}`}</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge variant="outline">
              {node.kind === "analyzed" ? "analizowany" : node.kind === "hashtag" ? "hashtag" : "powiązany"}
            </Badge>
            {node.shared && <Badge variant="outline" className="text-series-2">wspólny</Badge>}
            {inf && <Badge variant="outline">{INFLUENCE_LABEL[inf.influence]}</Badge>}
          </div>
        </div>
        <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Zamknij inspektor">
          <XIcon />
        </Button>
      </div>
      {entry?.data && (
        <p className="tnum text-sm text-muted-foreground">
          {fmtCompact(entry.data.profile.followers)} obserwujących · {fmtCompact(entry.data.profile.posts)} postów
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Ranking wpływu</dt>
        <dd className="tnum text-right">{r >= 0 ? `#${r + 1} / ${rank.length}` : "—"}</dd>
        <dt className="text-muted-foreground">Wynik</dt>
        <dd className="tnum text-right">{inf ? inf.score.toFixed(3) : "—"}</dd>
        <dt className="text-muted-foreground">PageRank</dt>
        <dd className="tnum text-right">{inf ? inf.pagerank.toFixed(4) : "—"}</dd>
        <dt className="text-muted-foreground">Pośredniość</dt>
        <dd className="tnum text-right">{inf ? inf.betweenness.toFixed(4) : "—"}</dd>
        <dt className="text-muted-foreground">Relacje we / wy</dt>
        <dd className="tnum text-right">
          {incoming.length} / {outgoing.length}
        </dd>
      </dl>
      {node.sources.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Wskazany przez {node.sources.length} {node.sources.length === 1 ? "profil" : "profile"}
          </h4>
          <ul className="flex flex-col gap-1 text-sm">
            {node.sources.map((s) => {
              const kinds = [...new Set(model.edges.filter((e) => (e.source === s && e.target === id) || (e.source === id && e.target === s)).map((e) => KIND[e.kind]))]
              return (
                <li key={s} className="flex items-baseline justify-between gap-2">
                  <button type="button" className="truncate font-medium hover:underline" onClick={() => navigate("overview", s)}>
                    @{s}
                  </button>
                  <span className="truncate text-xs text-muted-foreground">{kinds.join(", ")}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        {node.kind === "analyzed" ? (
          <Button size="xs" onClick={() => navigate("overview", id)}>
            Otwórz profil
          </Button>
        ) : node.kind === "account" ? (
          <Button size="xs" onClick={() => void analyze(id, { focus: false })} disabled={profiles[id]?.status === "loading"}>
            Analizuj i dołącz do grafu
          </Button>
        ) : null}
      </div>
    </aside>
  )
}

export function NetworkView() {
  const [mode, setMode] = React.useState<"graph" | "bubbles">("graph")
  const [hashtags, setHashtags] = React.useState(false)
  const [lists, setLists] = React.useState(true)
  const [sharedOnly, setSharedOnly] = React.useState(false)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [focus, setFocus] = React.useState<string | null>(null)
  const graphRef = React.useRef<ForceGraphHandle>(null)
  const order = useStore((s) => s.order)
  const loading = useStore((s) => s.order.some((u) => s.profiles[u]?.status === "loading"))
  const { model, fullModel, analyzed, truncated } = useGraphModel({ hashtags, lists, minSources: 1, focus })

  const sharedCount = model.nodes.filter((n) => n.shared && n.kind !== "analyzed").length

  const find = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim().replace(/^@/, "").toLowerCase()
    if (!q) return
    const hit = fullModel.nodes.find((n) => n.id === q) ?? fullModel.nodes.find((n) => n.id.includes(q))
    if (hit) { setFocus(hit.id); setSelected(hit.id) }
  }

  if (!order.length) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WaypointsIcon />
          </EmptyMedia>
          <EmptyTitle>Graf jest pusty</EmptyTitle>
          <EmptyDescription>
            Przeanalizuj co najmniej jeden profil. Każdy kolejny dołącza do tej samej mapy, a konta wskazywane przez kilka profili
            podświetlą się jako wspólne powiązania.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => window.dispatchEvent(new Event("osint:focus-analyze"))}>Analizuj profil</Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background px-4 py-2">
        <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as typeof mode)}>
          <ToggleGroupItem value="graph" className="h-7 px-2.5 text-[11px]">
            <WaypointsIcon />
            Graf
          </ToggleGroupItem>
          <ToggleGroupItem value="bubbles" className="h-7 px-2.5 text-[11px]">
            <CircleDotIcon />
            Bąbelki
          </ToggleGroupItem>
        </ToggleGroup>
        <Label className="flex items-center gap-2 text-xs font-normal">
          <Switch size="sm" checked={lists} onCheckedChange={setLists} />
          Listy obserwujących
        </Label>
        <Label className="flex items-center gap-2 text-xs font-normal">
          <Switch size="sm" checked={hashtags} onCheckedChange={setHashtags} />
          Hashtagi
        </Label>
        <Label className="flex items-center gap-2 text-xs font-normal">
          <Switch size="sm" checked={sharedOnly} onCheckedChange={setSharedOnly} />
          Wyróżnij wspólne
        </Label>
        <form onSubmit={find} className="flex h-7 items-center gap-1.5 border border-input px-2 focus-within:border-ring">
          <SearchIcon className="size-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="znajdź konto"
            aria-label="Znajdź konto w grafie"
            className="w-32 bg-transparent text-xs outline-none focus-visible:outline-none"
          />
        </form>
        <div className="ml-auto flex items-center gap-2">
          <span className="tnum hidden text-xs text-muted-foreground xl:inline">
            {analyzed.length} profili · {model.nodes.length} węzłów · {model.edges.length} relacji · {sharedCount} wspólnych
          </span>
          <ExportMenu model={fullModel} graphRef={graphRef} canPng={mode === "graph"} />
          <ListsSheet />
          {mode === "graph" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-xs" variant="outline" onClick={() => graphRef.current?.fit()} aria-label="Dopasuj widok">
                  <MaximizeIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Dopasuj widok (dwuklik na grafie)</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {truncated && <p className="border-b px-4 py-2 text-xs text-muted-foreground">Widok skupiony: {model.nodes.length} z {fullModel.nodes.length.toLocaleString("pl-PL")} węzłów. Wyszukaj konto, aby zobaczyć jego otoczenie. Eksport danych obejmuje całą sieć; PNG zapisuje widok.</p>}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[360px] min-w-0 flex-1 bg-card">
          {analyzed.length === 0 ? (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              {loading ? "Czekam na pierwsze dane profilu…" : "Żaden profil w sesji nie ma jeszcze danych."}
            </p>
          ) : mode === "graph" ? (
            <ForceGraph
              ref={graphRef}
              model={model}
              selected={selected}
              onSelect={setSelected}
              focusShared={sharedOnly}
              className="absolute inset-0"
            />
          ) : (
            <BubbleChart model={model} selected={selected} onSelect={setSelected} className="absolute inset-0" />
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 p-3">
            <div className="pointer-events-auto bg-card/90 px-2 py-1.5 backdrop-blur-sm">
              <Legend hashtags={hashtags} lists={lists} />
            </div>
            {mode === "graph" && (
              <p className="pointer-events-auto bg-card/90 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur-sm">
                kółko: zoom · przeciągnij tło: przesuń · Shift+puść węzeł: przypnij
              </p>
            )}
          </div>
        </div>
        {selected && <Inspector id={selected} model={model} onClose={() => setSelected(null)} />}
      </div>
    </div>
  )
}
