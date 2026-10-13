import * as React from "react"
import { ListOrderedIcon, PauseIcon, PlayIcon, Trash2Icon, UploadIcon, UsersIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { useNow } from "@/hooks/use-now"
import { analyzeFollowers, clearQueue, enqueue, parseList, pauseQueue, removeFromQueue, resumeQueue, retryFailed } from "@/lib/actions"
import { patchQueue, useStore } from "@/lib/store"
import { ListPager } from "@/components/list-pager"
import { duration, pageSlice } from "@/lib/large-lists"
import { flushSaved } from "@/lib/persist"

const DELAYS = [
  [2000, "2 s (ryzykownie)"],
  [5000, "5 s (zalecane)"],
  [10000, "10 s"],
  [20000, "20 s (ostrożnie)"],
  [45000, "45 s (bardzo ostrożnie)"],
] as const

export const openQueue = () => window.dispatchEvent(new Event("osint:open-queue"))
export const openFollowersQueue = (username: string) => window.dispatchEvent(new CustomEvent("osint:open-queue", { detail: { username } }))

/** Panel kolejki; otwierany z dowolnego miejsca przez openQueue(). */
export function QueueSheet() {
  const [page, setPage] = React.useState(0)
  const [importing, setImporting] = React.useState(false)
  const [importMessage, setImportMessage] = React.useState("")
  const fileRef = React.useRef<HTMLInputElement>(null)
  const storage = useStore((s) => s.storage)
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState("")
  const [sourceUser, setSourceUser] = React.useState("")
  const [scope, setScope] = React.useState("all")
  const [limit, setLimit] = React.useState("1000")
  const q = useStore((s) => s.queue)
  const sourceProfile = useStore((s) => s.profiles[sourceUser]?.data?.profile)
  const cookie = useStore((s) => s.session.cookie)
  const source = q.followersSource
  const hasWork = q.running || !!q.items.length || !!(source && !source.complete)
  const canResume = !!q.items.length || !!(source && !source.complete)
  const now = useNow(!!q.waitingUntil, 500)
  const parsed = React.useMemo(() => parseList(text), [text])
  const visible = pageSlice(q.items, page)

  React.useEffect(() => {
    const o = (event: Event) => {
      setSourceUser((event as CustomEvent<{ username?: string }>).detail?.username ?? "")
      setOpen(true)
    }
    window.addEventListener("osint:open-queue", o)
    return () => window.removeEventListener("osint:open-queue", o)
  }, [])

  const total = q.done + q.items.length
  const left = q.waitingUntil ? Math.max(0, Math.ceil((q.waitingUntil - now) / 1000)) : 0

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Analiza wielu kont</SheetTitle>
          <SheetDescription>
            {sourceUser ? `Pobierz obserwujących @${sourceUser} i przeanalizuj ich po kolei.` : "Wklej listę kont do analizy."} Przy limicie Instagrama kolejka odczeka i wznowi pracę.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6">
          {sourceUser && <section className="flex flex-col gap-4">
            <div className="border bg-muted/30 p-3">
              <p className="font-medium">@{sourceUser}</p>
              <p className="text-sm text-muted-foreground">{sourceProfile?.followers?.toLocaleString("pl-PL") ?? "—"} obserwujących według profilu</p>
            </div>
            <Field>
              <FieldLabel>Zakres analizy</FieldLabel>
              <Select value={scope} onValueChange={setScope} disabled={hasWork}>
                <SelectTrigger aria-label="Zakres analizy obserwujących"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value="all">Wszyscy dostępni</SelectItem>
                  <SelectItem value="limit">Określ liczbę kont</SelectItem>
                </SelectGroup></SelectContent>
              </Select>
              {scope === "limit" && <Input type="number" min={1} value={limit} disabled={hasWork}
                onChange={(e) => setLimit(e.target.value)} aria-label="Maksymalna liczba obserwujących" />}
              <FieldDescription>Lista pobiera się stronami. Każde nowe konto trafia do analizy i wspólnego grafu. Gotowe wyniki i duplikaty są pomijane.</FieldDescription>
            </Field>
            <Button disabled={!cookie || !sourceProfile?.id || sourceProfile.private || hasWork || (scope === "limit" && (!Number.isSafeInteger(Number(limit)) || Number(limit) < 1))}
              onClick={() => analyzeFollowers(sourceUser, scope === "limit" ? Number(limit) : undefined)}>
              <UsersIcon data-icon="inline-start" />
              Rozpocznij analizę obserwujących
            </Button>
            {!cookie && <p className="text-sm text-status-warn">Najpierw połącz konto w widoku Sesja IG.</p>}
            <p className="text-xs text-muted-foreground">Instagram może udostępnić tylko część listy. Dla prywatnych kont analiza obejmuje widoczne dane profilu. Postęp zapisuje się na urządzeniu; po restarcie kliknij Wznów.</p>
          </section>}
          <FieldGroup>
            {!sourceUser && <Field>
              <FieldLabel htmlFor="queue-text">Konta</FieldLabel>
              <Textarea
                id="queue-text"
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"@konto_1\nkonto_2, konto_3\nhttps://www.instagram.com/konto_4/"}
              />
              <FieldDescription>
                {parsed.length
                  ? `Rozpoznano ${parsed.length} kont.`
                  : "Po spacji, przecinku lub w nowych liniach; @ i linki są w porządku."}
              </FieldDescription>
            </Field>}
            <Field>
              <FieldLabel>Pauza między kontami</FieldLabel>
              <Select value={String(q.delayMs)} onValueChange={(v) => patchQueue({ delayMs: Number(v) })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {DELAYS.map(([ms, label]) => (
                      <SelectItem key={ms} value={String(ms)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>Każda pauza dostaje losowy rozrzut ±30%.</FieldDescription>
            </Field>
          </FieldGroup>
          {!sourceUser && <div className="flex flex-col gap-2"><Button
            disabled={!parsed.length}
            onClick={() => {
              enqueue(parsed)
              setText("")
            }}
          >
            <ListOrderedIcon data-icon="inline-start" />
            Dodaj do kolejki ({parsed.length})
          </Button>
            <input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden" aria-label="Plik z kontami do kolejki"
              onChange={async (e) => {
                const file = e.target.files?.[0]; e.target.value = ""
                if (!file) return
                setImporting(true); setImportMessage("")
                try {
                  if (file.size > 32 * 1024 * 1024) throw new Error("Wybierz plik do 32 MB.")
                  const names = parseList(await file.text())
                  const added = enqueue(names)
                  setImportMessage(`Dodano ${added.toLocaleString("pl-PL")} kont. Pominięto ${names.length - added} duplikatów lub gotowych wyników.`)
                } catch (e) { setImportMessage(e instanceof Error ? e.message : "Nie udało się odczytać pliku.") }
                finally { setImporting(false) }
              }} />
            <Button variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}><UploadIcon />{importing ? "Wczytuję…" : "Importuj konta z TXT / CSV"}</Button>
            <p className="text-xs text-muted-foreground">Plik: jedna nazwa lub link IG na wiersz; bez nagłówka. Duplikaty i gotowe wyniki są pomijane.</p>
            {importMessage && <p role="status" className="text-sm">{importMessage}</p>}
          </div>}

          <section className="flex flex-col gap-3 border-t pt-4">
            <div className="flex items-center gap-2">
              <h3 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">Kolejka</h3>
              {q.running && !q.paused && <Badge variant="secondary">w toku</Badge>}
              {q.paused && <Badge variant="outline">wstrzymana</Badge>}
              <div className="ml-auto flex gap-1">
                {q.running && !q.paused ? (
                  <Button size="xs" variant="outline" onClick={pauseQueue}>
                    <PauseIcon data-icon="inline-start" />
                    Wstrzymaj
                  </Button>
                ) : (
                  <Button size="xs" variant="outline" onClick={resumeQueue} disabled={!canResume || storage.status === "error"}>
                    <PlayIcon data-icon="inline-start" />
                    Wznów
                  </Button>
                )}
                <Button size="xs" variant="ghost" onClick={clearQueue} disabled={!q.items.length && !q.done && !source}>
                  <Trash2Icon data-icon="inline-start" />
                  Wyczyść
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 border bg-muted/20 p-3 text-xs" data-testid="queue-summary">
              <span>Czeka <strong className="tnum block text-lg">{q.items.length.toLocaleString("pl-PL")}</strong></span>
              <span>Gotowe <strong className="tnum block text-lg">{Math.max(0, q.done - q.failed.length).toLocaleString("pl-PL")}</strong></span>
              <span>Błędy <strong className="tnum block text-lg">{q.failed.length.toLocaleString("pl-PL")}</strong></span>
            </div>
            {q.items.length > 1 && <p className="text-xs text-muted-foreground">Same pauzy w obecnej kolejce: około {duration((q.items.length - 1) * q.delayMs)}. Pobieranie danych i limity wydłużą ten czas.</p>}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span role={storage.status === "error" ? "alert" : "status"} className={storage.status === "error" ? "text-status-bad" : ""}>
                {storage.status === "error" ? `Nie zapisano postępu. ${storage.message ?? "Sprawdź wolne miejsce."}` : storage.status === "saving" ? "Zapisuję postęp…" : storage.savedAt ? `Postęp zapisany ${new Date(storage.savedAt).toLocaleTimeString("pl-PL")}` : "Postęp zapisuje się lokalnie."}
              </span>
              <Button size="xs" variant="ghost" disabled={storage.status === "saving"} onClick={() => void flushSaved()}>{storage.status === "error" ? "Ponów zapis" : "Zapisz teraz"}</Button>
            </div>
            {source && <div className="flex flex-col gap-1.5 text-sm" role="status" aria-live="polite" data-testid="followers-progress">
              <p className="font-medium">Obserwujący @{source.username}</p>
              <p>Pobrano {source.discovered.toLocaleString("pl-PL")} kont · gotowe {q.done - q.failed.length} · pominięto gotowe {source.skipped} · błędy {q.failed.length}</p>
              {q.current && <p>Teraz: @{q.current}</p>}
              {q.running && !q.items.length && !source.complete && <p className="flex items-center gap-2"><Spinner className="size-3.5" /> Pobieram kolejną stronę obserwujących…</p>}
              {source.complete && !q.items.length && !q.running && !q.paused && <p className="text-status-good">Analiza pobranej listy zakończona.</p>}
              {source.limited && <p className="text-status-warn">Instagram ograniczył widoczną listę. Wynik obejmuje udostępnione konta.</p>}
              {source.error && <p className="text-status-bad">{source.error.message}</p>}
            </div>}
            {total > 0 && (
              <div className="flex items-center gap-2">
                <Progress value={(q.done / total) * 100} className="h-1" />
                <span className="tnum shrink-0 text-xs text-muted-foreground">
                  {q.done}/{total}
                  {q.failed.length ? ` · błędy ${q.failed.length}` : ""}
                </span>
              </div>
            )}
            {q.waitingUntil && (
              <p className="tnum text-sm text-status-warn">
                Czekam {left} s ({q.waitReason}).
              </p>
            )}
            {q.items.length ? (
              <ol className="divide-y border">
                {visible.items.map((u, i) => (
                  <li key={u} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="tnum min-w-6 text-xs text-muted-foreground">{visible.offset + i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">@{u}</span>
                    {q.current === u && <Spinner className="size-3.5" />}
                    <Button size="icon-xs" variant="ghost" onClick={() => removeFromQueue(u)} aria-label={`Usuń @${u} z kolejki`}>
                      <XIcon />
                    </Button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">Kolejka jest pusta.</p>
            )}
            <ListPager page={visible.page} pages={visible.pages} onChange={setPage} label="Kolejka" />
            {q.failed.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">Nie udało się: {q.failed.slice(0, 5).map((u) => "@" + u).join(", ")}{q.failed.length > 5 ? ` i ${q.failed.length - 5} więcej` : ""}</p>
                <Button
                  size="xs"
                  variant="outline"
                  className="w-fit"
                  onClick={retryFailed}
                >
                  Ponów nieudane
                </Button>
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function QueueIndicator() {
  const q = useStore((s) => s.queue)
  const now = useNow(!!q.waitingUntil, 500)
  if (!q.running && !q.items.length && (!q.followersSource || q.followersSource.complete)) return null
  const total = q.done + q.items.length
  const left = q.waitingUntil ? Math.max(0, Math.ceil((q.waitingUntil - now) / 1000)) : 0
  return (
    <button
      type="button"
      onClick={openQueue}
      className="tnum flex shrink-0 items-center gap-1.5 border px-2 py-1 text-[11px] hover:bg-muted"
    >
      <ListOrderedIcon className="size-3.5" />
      Kolejka {q.done}/{total}
      {q.followersSource && ` · @${q.followersSource.username}`}
      {q.paused ? " · pauza" : q.waitingUntil ? ` · ${left} s` : ""}
    </button>
  )
}
