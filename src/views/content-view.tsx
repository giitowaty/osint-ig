import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { CopyIcon, FilmIcon, HeartIcon, ImageIcon, MapPinIcon, MessageCircleIcon } from "lucide-react"

import { IgImage } from "@/components/ig-image"
import { PostingHeatmap } from "@/components/posting-heatmap"
import { PageBody, Panel, ProfileGate } from "@/components/profile-parts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { contentSummary, fmt, fmtCompact } from "@/lib/analysis"
import { openExternal } from "@/lib/runtime"
import type { Interest, Post } from "@/lib/types"
import { cn } from "@/lib/utils"

const TYPE_META = {
  image: { label: "Zdjęcie", icon: ImageIcon, color: "var(--series-1)" },
  video: { label: "Wideo", icon: FilmIcon, color: "var(--series-2)" },
  carousel: { label: "Karuzela", icon: CopyIcon, color: "var(--series-3)" },
} as const

const KIND_META: Record<Interest["kind"], { label: string; color: string }> = {
  kategoria: { label: "temat", color: "var(--series-1)" },
  konto: { label: "konto", color: "var(--series-2)" },
  hashtag: { label: "hashtag", color: "var(--series-3)" },
}

function PostTile({ p }: { p: Post }) {
  const T = TYPE_META[p.type]
  return (
    <button
      type="button"
      onClick={() => p.shortcode && void openExternal(`https://www.instagram.com/p/${p.shortcode}/`)}
      className="group relative aspect-square overflow-hidden bg-muted text-left focus-visible:z-10"
      title={p.alt || p.caption || ""}
    >
      <IgImage src={p.thumbnail} className="size-full transition-transform duration-300 group-hover:scale-[1.03]" />
      <span className="absolute top-1.5 right-1.5 bg-background/85 p-1">
        <T.icon className="size-3.5" aria-label={T.label} />
      </span>
      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pt-6 pb-1.5 text-[11px] text-white">
        <span className="tnum flex items-center gap-2.5">
          <span className="flex items-center gap-1">
            <HeartIcon className="size-3" />
            {fmtCompact(p.likes)}
          </span>
          <span className="flex items-center gap-1">
            <MessageCircleIcon className="size-3" />
            {fmtCompact(p.comments)}
          </span>
          {p.takenAt && <span className="ml-auto whitespace-nowrap opacity-80">{new Date(p.takenAt).toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}</span>}
        </span>
        {p.location && (
          <span className="flex items-center gap-1 truncate opacity-80">
            <MapPinIcon className="size-3 shrink-0" />
            <span className="truncate">{p.location}</span>
          </span>
        )}
      </span>
    </button>
  )
}

type Metric = "likes" | "comments" | "er"

function EngagementChart({ posts, followers }: { posts: Post[]; followers: number | null }) {
  const [metric, setMetric] = React.useState<Metric>("likes")
  const data = React.useMemo(
    () =>
      [...posts]
        .sort((a, b) => (a.takenAt ?? 0) - (b.takenAt ?? 0))
        .map((p, i) => ({
          key: p.shortcode || String(i),
          label: p.takenAt ? new Date(p.takenAt).toLocaleDateString("pl-PL", { day: "numeric", month: "short" }) : `#${i + 1}`,
          likes: p.likes ?? 0,
          comments: p.comments ?? 0,
          er: followers ? Number((((p.likes ?? 0) + (p.comments ?? 0)) / followers) * 100) : 0,
          type: TYPE_META[p.type].label,
        })),
    [posts, followers]
  )
  const config: ChartConfig = {
    likes: { label: "Polubienia", color: "var(--series-1)" },
    comments: { label: "Komentarze", color: "var(--series-1)" },
    er: { label: "Zaangażowanie %", color: "var(--series-1)" },
  }
  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup type="single" size="sm" variant="outline" value={metric} onValueChange={(v) => v && setMetric(v as Metric)}>
        <ToggleGroupItem value="likes" className="h-7 px-2.5 text-[11px]">Polubienia</ToggleGroupItem>
        <ToggleGroupItem value="comments" className="h-7 px-2.5 text-[11px]">Komentarze</ToggleGroupItem>
        <ToggleGroupItem value="er" className="h-7 px-2.5 text-[11px]" disabled={!followers}>Zaangażowanie</ToggleGroupItem>
      </ToggleGroup>
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        <BarChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--grid-line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v: number) => (metric === "er" ? `${v.toFixed(1)}%` : fmtCompact(v))}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)" }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const d = payload?.[0]?.payload as { label: string; type: string } | undefined
                  return d ? `${d.label} · ${d.type}` : ""
                }}
                formatter={(v) => (
                  <span className="tnum font-medium">
                    {metric === "er" ? `${Number(v).toFixed(2)}%` : fmt(Number(v))} {config[metric].label?.toString().toLowerCase()}
                  </span>
                )}
                hideIndicator
              />
            }
          />
          <Bar dataKey={metric} fill={`var(--color-${metric})`} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground">Ostatnie posty w kolejności publikacji. Najedź na słupek, by zobaczyć dokładną wartość.</p>
    </div>
  )
}

function Formats({ counts, total }: { counts: Record<keyof typeof TYPE_META, number>; total: number }) {
  const entries = (Object.keys(TYPE_META) as (keyof typeof TYPE_META)[]).filter((k) => counts[k] > 0)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 w-full gap-0.5" role="img" aria-label="Rozkład formatów">
        {entries.map((k) => (
          <span
            key={k}
            title={`${TYPE_META[k].label}: ${counts[k]}`}
            style={{ width: `${(counts[k] / total) * 100}%`, background: TYPE_META[k].color }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-3 gap-2">
        {(Object.keys(TYPE_META) as (keyof typeof TYPE_META)[]).map((k) => {
          const T = TYPE_META[k]
          return (
            <li key={k} className="flex flex-col">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-2" style={{ background: T.color }} />
                {T.label}
              </span>
              <span className="tnum text-lg font-semibold">
                {counts[k]}
                <span className="ml-1 text-xs font-normal text-muted-foreground">{Math.round((counts[k] / total) * 100)}%</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function ContentView() {
  return (
    <ProfileGate>
      {(entry) => {
        const data = entry.data
        const sum = contentSummary(data)
        const topics = data.content?.topics?.ranked ?? data.content?.topics?.topics ?? []
        const interests = data.content?.interests ?? []
        const iMax = interests[0]?.weight || 1
        const iSum = interests.reduce((a, i) => a + i.weight, 0) || 1
        const tMax = topics[0]?.hits || 1
        if (!data.posts.length) {
          return (
            <PageBody>
              <Panel title="Brak postów">
                <p className="text-sm text-muted-foreground">
                  {data.profile.private
                    ? "Profil jest prywatny: Instagram nie udostępnia jego postów bez obserwowania."
                    : "Instagram nie zwrócił żadnych postów dla tego profilu."}
                </p>
              </Panel>
            </PageBody>
          )
        }
        return (
          <PageBody>
            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Panel title={`Ostatnie posty · ${data.posts.length}`} description="Kliknij, aby otworzyć post na Instagramie" className="self-start">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1">
                  {data.posts.map((p, i) => (
                    <PostTile key={p.shortcode || i} p={p} />
                  ))}
                </div>
              </Panel>
              <div className="flex min-w-0 flex-col gap-4">
                <Panel title="Reakcje na posty">
                  <EngagementChart posts={data.posts} followers={data.profile.followers} />
                </Panel>
                {sum && (
                  <Panel title="Formaty">
                    <Formats counts={sum.typeCounts} total={sum.count} />
                  </Panel>
                )}
                <Panel title="Rytm publikacji" description="Dzień tygodnia × godzina: pomaga ustalić strefę czasową i nawyki">
                  <PostingHeatmap posts={data.posts} />
                </Panel>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              <Panel title="Tematyka" description="Kategorie wykryte w opisach, hashtagach i opisach zdjęć">
                {topics.length ? (
                  <ul className="flex flex-col gap-1.5">
                    {topics.map((t) => (
                      <li key={t.category} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm">
                        <span className="truncate">{t.category}</span>
                        <span className="h-2 bg-muted">
                          <span className="block h-full bg-series-1" style={{ width: `${Math.max(4, (t.hits / tMax) * 100)}%` }} />
                        </span>
                        <span className="tnum text-right text-xs text-muted-foreground">
                          {Math.round(t.share * 100)}% · {t.hits}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Za mało tekstu, by określić tematykę.</p>
                )}
              </Panel>

              <Panel
                title="Zainteresowania"
                description="Ranking z tego, co konto publikuje i udostępnia. Stories nie są dostępne publicznie."
              >
                {interests.length ? (
                  <>
                    <ul className="mb-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {Object.entries(KIND_META).map(([k, m]) => (
                        <li key={k} className="flex items-center gap-1.5">
                          <span className="size-2" style={{ background: m.color }} />
                          {m.label}
                        </li>
                      ))}
                    </ul>
                    <ul className="flex flex-col gap-1.5">
                      {interests.map((i) => (
                        <li key={i.kind + i.label} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
                          <span className="truncate" title={KIND_META[i.kind]?.label}>
                            {i.label}
                          </span>
                          <span className="h-2 bg-muted">
                            <span
                              className="block h-full"
                              style={{ width: `${Math.max(4, (i.weight / iMax) * 100)}%`, background: KIND_META[i.kind]?.color }}
                            />
                          </span>
                          <span className="tnum text-right text-xs text-muted-foreground">{Math.round((i.weight / iSum) * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Za mało opisów i hashtagów, by wyznaczyć zainteresowania.</p>
                )}
              </Panel>

              <Panel title="Hashtagi" description="Wszystkie z ostatnich postów, z liczbą użyć" className="lg:col-span-2 2xl:col-span-1">
                {data.hashtags?.length ? (
                  <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
                    {data.hashtags.map((h) => (
                      <li key={h.tag} className={cn("text-sm", h.count > 1 ? "font-medium" : "text-muted-foreground")}>
                        #{h.tag}
                        {h.count > 1 && <sup className="tnum ml-0.5 text-[10px] text-muted-foreground">{h.count}</sup>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Brak hashtagów w ostatnich postach.</p>
                )}
              </Panel>
            </div>
          </PageBody>
        )
      }}
    </ProfileGate>
  )
}
