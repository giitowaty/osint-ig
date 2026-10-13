import { ArrowRightIcon, AtSignIcon, TagIcon } from "lucide-react"

import { IgImage } from "@/components/ig-image"
import { NotesPanel } from "@/components/notes-panel"
import { InsightsList, PageBody, Panel, ProfileGate, ProfileHeader, StatStrip } from "@/components/profile-parts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { analyze } from "@/lib/actions"
import { contentSummary, engagementLabel, fmt } from "@/lib/analysis"
import { openExternal } from "@/lib/runtime"
import { navigate, useStore } from "@/lib/store"

function ConnectionsTable({ username }: { username: string }) {
  const entry = useStore((s) => s.profiles[username])
  const profiles = useStore((s) => s.profiles)
  const list = entry?.data?.connections ?? []
  if (!list.length) {
    return <p className="text-sm text-muted-foreground">W ostatnich postach nie ma oznaczeń, współautorów ani @wzmianek.</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Konto</TableHead>
          <TableHead>Relacja</TableHead>
          <TableHead className="text-right">Wystąpienia</TableHead>
          <TableHead className="w-0" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.slice(0, 15).map((c) => {
          const inSession = !!profiles[c.username]
          return (
            <TableRow key={c.username}>
              <TableCell className="font-medium">@{c.username}</TableCell>
              <TableCell>
                <span className="flex gap-1">
                  {(c.kinds ?? []).includes("tag") && (
                    <Badge variant="outline" className="gap-1">
                      <TagIcon className="size-3" />
                      oznaczenie
                    </Badge>
                  )}
                  {(c.kinds ?? []).includes("mention") && (
                    <Badge variant="outline" className="gap-1">
                      <AtSignIcon className="size-3" />
                      wzmianka
                    </Badge>
                  )}
                </span>
              </TableCell>
              <TableCell className="tnum text-right">{c.count}</TableCell>
              <TableCell>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => (inSession ? navigate("overview", c.username) : void analyze(c.username, { focus: false }))}
                >
                  {inSession ? "Pokaż" : "Analizuj"}
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export function OverviewView() {
  return (
    <ProfileGate>
      {(entry) => {
        const data = entry.data
        const c = data.content
        const sum = contentSummary(data)
        const topics = c?.topics?.topics ?? []
        return (
          <PageBody>
            <ProfileHeader entry={entry} />
            <StatStrip entry={entry} />
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-12">
              <Panel title="Wnioski" description="Heurystyki z liczb profilu" className="2xl:col-span-5">
                <InsightsList entry={entry} />
                {sum?.engagement != null && (
                  <p className="mt-4 border-t pt-3 text-sm">
                    Zaangażowanie <span className="font-semibold">{sum.engagement.toFixed(2)}%</span> jest{" "}
                    <span className="font-semibold">{engagementLabel(sum.engagement)}</span>{" "}
                    <span className="text-muted-foreground">
                      (śr. {fmt(sum.avgLikes)} polubień i {fmt(sum.avgComments)} komentarzy na post względem obserwujących).
                    </span>
                  </p>
                )}
              </Panel>

              <Panel
                title="Archetyp konta"
                description="Z kategorii IG i sygnałów: zasięg, ratio, weryfikacja, tematyka"
                className="2xl:col-span-3"
              >
                {c?.classification ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-heading text-2xl font-semibold">{c.classification.primary}</span>
                      <span className="tnum text-sm text-muted-foreground">
                        pewność ~{Math.round(c.classification.confidence * 100)}%
                      </span>
                    </div>
                    <Progress value={c.classification.confidence * 100} className="h-1" />
                    <ul className="flex flex-col gap-2">
                      {c.classification.labels.map((l) => (
                        <li key={l.label} className="text-sm">
                          <span className="font-medium">{l.label}</span>
                          <span className="block text-xs text-muted-foreground">{l.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Za mało danych do klasyfikacji.</p>
                )}
              </Panel>

              <Panel
                title="Dominująca tematyka"
                className="2xl:col-span-4"
                action={
                  <Button size="xs" variant="ghost" onClick={() => navigate("content")}>
                    Treści <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                }
              >
                {topics.length ? (
                  <ul className="flex flex-col gap-2">
                    {topics.slice(0, 6).map((t) => (
                      <li key={t.category} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
                        <span className="truncate">{t.category}</span>
                        <span className="h-2 bg-muted">
                          <span className="block h-full bg-series-1" style={{ width: `${Math.max(4, t.share * 100)}%` }} />
                        </span>
                        <span className="tnum text-right text-muted-foreground">{Math.round(t.share * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Za mało opisów i hashtagów, by określić tematykę.</p>
                )}
                {sum?.topPost && (
                  <button
                    type="button"
                    onClick={() => void openExternal(`https://www.instagram.com/p/${sum.topPost!.shortcode}/`)}
                    className="mt-4 flex w-full gap-3 border-t pt-3 text-left hover:opacity-80"
                  >
                    <IgImage src={sum.topPost.thumbnail} className="size-14 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                        Najpopularniejszy z ostatnich
                      </span>
                      <span className="tnum block text-sm font-medium">{fmt(sum.topPost.likes)} polubień</span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">{sum.topPost.caption || "bez opisu"}</span>
                    </span>
                  </button>
                )}
              </Panel>

              <NotesPanel key={entry.username} username={entry.username} className="lg:col-span-2 2xl:col-span-4" />

              <Panel
                title="Powiązane konta"
                description="Oznaczenia, współautorzy (collab/regram) i @wzmianki z ostatnich postów"
                className="lg:col-span-2 2xl:col-span-8"
                action={
                  <Button size="xs" variant="ghost" onClick={() => navigate("network")}>
                    Graf <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                }
              >
                <ConnectionsTable username={entry.username} />
              </Panel>
            </div>
          </PageBody>
        )
      }}
    </ProfileGate>
  )
}
