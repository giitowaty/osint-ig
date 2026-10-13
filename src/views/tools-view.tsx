import * as React from "react"
import { BookmarkIcon, DownloadIcon, PuzzleIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { toast } from "sonner"

import { PageBody, Panel } from "@/components/profile-parts"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { downloadJson } from "@/lib/analysis"
import { BOOKMARKLET_HREF } from "@/lib/collector"
import { importSession, savedSize } from "@/lib/persist"
import { isTauri } from "@/lib/runtime"
import { getState, setState, useStore } from "@/lib/store"

const SHORTCUTS: [string[], string][] = [
  [["Ctrl", "K"], "paleta poleceń: analiza profilu, widoki, akcje"],
  [["Ctrl", "J"], "pokaż / ukryj panel aktywności"],
  [["Ctrl", "Shift", "K"], "analiza wielu kont (kolejka)"],
  [["Ctrl", "B"], "zwiń / rozwiń pasek boczny"],
  [["D"], "przełącz jasny / ciemny motyw"],
  [["Dwuklik"], "dopasuj graf do widoku"],
  [["Shift", "puść węzeł"], "przypnij węzeł w grafie"],
]

function Bookmarklet() {
  const ref = React.useRef<HTMLAnchorElement>(null)
  React.useEffect(() => {
    // href ustawiany przez DOM: React blokuje adresy javascript: w atrybutach.
    ref.current?.setAttribute("href", BOOKMARKLET_HREF)
  }, [])
  return (
    <a
      ref={ref}
      onClick={(e) => {
        e.preventDefault()
        toast.info("Przeciągnij ten przycisk na pasek zakładek", {
          description: "Potem użyj go na Instagramie, na otwartej liście obserwujących.",
        })
      }}
      className="inline-flex h-9 w-fit cursor-grab items-center gap-2 border border-dashed border-foreground/40 px-4 text-xs font-semibold tracking-widest uppercase hover:bg-muted"
    >
      <BookmarkIcon className="size-3.5" />
      OSINT-IG zbieracz
    </a>
  )
}

export function ToolsView() {
  const order = useStore((s) => s.order)
  const profiles = useStore((s) => s.profiles)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [size, setSize] = React.useState(0)
  React.useEffect(() => {
    const t = setTimeout(() => void savedSize().then(setSize), 1200)
    return () => clearTimeout(t)
  }, [profiles, order])
  return (
    <PageBody>
      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        <Panel title="Zbieracz list (bookmarklet)" description="Działa w Twojej przeglądarce, na Twojej sesji IG. Nic nie trafia na serwer.">
          <div className="flex flex-col gap-3 text-sm">
            <Bookmarklet />
            <ol className="flex list-decimal flex-col gap-1.5 pl-5">
              <li>Przeciągnij przycisk wyżej na pasek zakładek{isTauri ? " przeglądarki (nie w tej aplikacji)" : ""}.</li>
              <li>Na Instagramie otwórz u profilu listę Obserwujący albo Obserwowani.</li>
              <li>Kliknij zakładkę: przewinie listę i skopiuje nazwy do schowka.</li>
              <li>Wklej je w grafie: Listy obserwujących, Wklej listę ręcznie.</li>
            </ol>
            <p className="text-xs text-muted-foreground">To scraping po stronie przeglądarki: używaj z umiarem, nadużycie grozi ograniczeniem konta.</p>
          </div>
        </Panel>

        <Panel title="Rozszerzenie przeglądarki" description="Chrome / Edge, Manifest V3, folder extension/ w repozytorium">
          <div className="flex flex-col gap-3 text-sm">
            <PuzzleIcon className="size-6 text-muted-foreground" />
            <ol className="flex list-decimal flex-col gap-1.5 pl-5">
              <li>Otwórz chrome://extensions (lub edge://extensions) i włącz tryb dewelopera.</li>
              <li>„Załaduj rozpakowane” i wskaż folder extension/.</li>
              <li>Na instagram.com rozszerzenie pokaże konto, pobierze listy i skopiuje sessionid.</li>
            </ol>
            <p className="text-xs text-muted-foreground">Zapytania idą tylko z Twojej przeglądarki do Instagrama.</p>
          </div>
        </Panel>

        <Panel title="Dane sesji badawczej">
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              {order.length} {order.length === 1 ? "profil" : "profili"} w sesji. Sesja (dane, listy, notatki, tagi) zapisuje się
              lokalnie w IndexedDB{size ? ` (${(size / 1024).toFixed(0)} kB)` : ""} i wraca po restarcie. Cookie sesji IG nie
              jest w niej przechowywane.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ""
                if (!file) return
                try {
                  const n = importSession(JSON.parse(await file.text()))
                  toast.success(`Zaimportowano ${n} profili`)
                } catch (err) {
                  toast.error("Nie udało się zaimportować", { description: err instanceof Error ? err.message : String(err) })
                }
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="xs"
                variant="outline"
                disabled={!order.length}
                onClick={() => {
                  const s = getState()
                  downloadJson(`osint-ig-sesja-${new Date().toISOString().slice(0, 10)}.json`, {
                    exportedAt: new Date().toISOString(),
                    profiles: s.order.map((u) => {
                      const p = s.profiles[u]
                      return {
                        username: u,
                        data: p.data,
                        followers: p.followers,
                        following: p.following,
                        manual: p.manual,
                        notes: p.notes,
                        tags: p.tags,
                      }
                    }),
                  })
                }}
              >
                <DownloadIcon data-icon="inline-start" />
                Eksport całej sesji (JSON)
              </Button>
              <Button size="xs" variant="outline" onClick={() => fileRef.current?.click()}>
                <UploadIcon data-icon="inline-start" />
                Importuj sesję
              </Button>
              <Button
                size="xs"
                variant="destructive"
                disabled={!order.length}
                onClick={() => {
                  setState({ profiles: {}, order: [], active: null })
                  toast.success("Wyczyszczono profile z sesji")
                }}
              >
                <Trash2Icon data-icon="inline-start" />
                Wyczyść sesję
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="Skróty klawiszowe" className="xl:col-span-2 2xl:col-span-3">
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={label} className="flex items-center gap-3">
                <dt className="w-36 shrink-0">
                  <KbdGroup>
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </KbdGroup>
                </dt>
                <dd className="text-muted-foreground">{label}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </PageBody>
  )
}
