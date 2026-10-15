import * as React from "react"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  ClipboardPasteIcon,
  CookieIcon,
  FileUpIcon,
  PlugZapIcon,
  PuzzleIcon,
  RotateCwIcon,
  ShieldAlertIcon,
  Trash2Icon,
  UnplugIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ErrorPanel } from "@/components/error-panel"
import { useNow } from "@/hooks/use-now"
import { IgImage } from "@/components/ig-image"
import { PageBody, Panel } from "@/components/profile-parts"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { addAccount, clearSession, connectCookies, connectCookiesTo, removeAccount, verifySession, verifySessionEntry } from "@/lib/actions"
import { CookieParseError, FORMAT_LABEL, mask, parseCookieInput, type CookieBundle } from "@/lib/cookies"
import { isTauri } from "@/lib/runtime"
import { setAutoLists, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

/* --------------------------- Stan połączenia ------------------------------ */

function ConnectionCard() {
  const s = useStore((st) => st.session)
  const now = useNow(false)
  const days = s.meta?.expires ? Math.round((s.meta.expires - now) / 86_400_000) : null
  const state = s.verifying ? "checking" : s.account ? "ok" : s.cookie ? (s.error ? "bad" : "unverified") : "none"

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-4 border bg-card p-4",
        state === "ok" && "border-status-good/40",
        state === "bad" && "border-status-bad/40"
      )}
    >
      {state === "ok" ? (
        <IgImage
          src={s.meta?.avatar ?? ""}
          className="size-14 shrink-0"
          fallback={<span className="font-heading text-xl uppercase">{s.account[0]}</span>}
        />
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center bg-muted">
          {state === "checking" ? <Spinner className="size-5" /> : <CookieIcon className="size-6 text-muted-foreground" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">Konto Instagrama w aplikacji</p>
        {state === "ok" && (
          <p className="font-heading text-2xl font-semibold">
            @{s.account}
            <CircleCheckIcon className="ml-2 inline size-5 align-[-3px] text-status-good" aria-label="połączone" />
          </p>
        )}
        {state === "checking" && <p className="text-lg">Sprawdzam, do kogo należą ciasteczka…</p>}
        {state === "unverified" && <p className="text-lg text-status-warn">Ciasteczka zapisane, konto niesprawdzone</p>}
        {state === "bad" && <p className="text-lg text-status-bad">{s.error?.message ?? "Nie udało się potwierdzić sesji"}</p>}
        {state === "none" && <p className="text-lg">Brak: aplikacja działa anonimowo</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {s.cookie && s.meta
            ? `${s.meta.names.length} ciasteczek (${s.meta.names.join(", ")})${s.meta.format ? ` · źródło: ${FORMAT_LABEL[s.meta.format as keyof typeof FORMAT_LABEL] ?? s.meta.format}` : ""}${days != null ? ` · sessionid ważne jeszcze ${days} dni` : ""}${s.verifiedAt ? ` · sprawdzono ${new Date(s.verifiedAt).toLocaleTimeString("pl-PL")}` : ""}`
            : "Bez sesji analiza profili działa, ale Instagram szybciej nakłada limity, a listy obserwujących są niedostępne."}
        </p>
      </div>
      {s.cookie && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" onClick={() => void verifySession()} disabled={s.verifying}>
            <RotateCwIcon data-icon="inline-start" />
            Sprawdź
          </Button>
          <Button size="xs" variant="destructive" onClick={clearSession}>
            <UnplugIcon data-icon="inline-start" />
            Odłącz i usuń
          </Button>
        </div>
      )}
    </div>
  )
}

/* ----------------------------- Podgląd paczki ----------------------------- */

function Preview({ bundle, onConnect }: { bundle: CookieBundle; onConnect: () => void }) {
  return (
    <div className="flex flex-col gap-3 border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <CircleCheckIcon className="size-4 text-status-good" />
        <span>
          Rozpoznano: <strong>{FORMAT_LABEL[bundle.format]}</strong>
          {bundle.account ? ` · konto @${bundle.account}` : ""}
        </span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {Object.entries(bundle.cookies).map(([k, v]) => (
            <tr key={k} className="border-t border-border/50">
              <td className="py-1 pr-3 font-medium">{k}</td>
              <td className="py-1 pr-3 font-mono text-muted-foreground">{mask(v)}</td>
              <td className="tnum py-1 text-right text-muted-foreground">
                {bundle.expires[k] ? new Date(bundle.expires[k]).toLocaleDateString("pl-PL") : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {bundle.warnings.map((w) => (
        <p key={w} className="flex gap-1.5 text-xs text-status-warn">
          <CircleAlertIcon className="mt-px size-3.5 shrink-0" />
          {w}
        </p>
      ))}
      <Button onClick={onConnect} className="w-fit">
        <PlugZapIcon data-icon="inline-start" />
        Połącz {bundle.account ? `@${bundle.account}` : "konto"}
      </Button>
    </div>
  )
}

/** Pole: wklej/upuść → parsowanie na żywo → podgląd → połącz. */
function useParsed(text: string) {
  return React.useMemo(() => {
    if (!text.trim()) return { bundle: null, error: null }
    try {
      return { bundle: parseCookieInput(text), error: null }
    } catch (e) {
      return { bundle: null, error: e instanceof CookieParseError ? e.message : String(e) }
    }
  }, [text])
}

function PasteTab() {
  const [text, setText] = React.useState("")
  const { bundle, error } = useParsed(text)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Działa każdy format: nagłówek <code className="text-foreground">Cookie:</code> z DevTools, JSON z Cookie-Editor lub
        EditThisCookie, plik cookies.txt albo sama wartość sessionid. Aplikacja zostawi tylko ciasteczka instagram.com.
      </p>
      <Textarea
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"sessionid=…; csrftoken=…; ds_user_id=…\nalbo JSON / cookies.txt / paczka OSINTIG1:…"}
        aria-label="Ciasteczka Instagrama"
        className="font-mono text-xs"
        spellCheck={false}
        autoComplete="off"
      />
      {error && <p className="text-sm text-status-bad">{error}</p>}
      {bundle && (
        <Preview
          bundle={bundle}
          onConnect={() => {
            void connectCookies(bundle)
            setText("")
          }}
        />
      )}
    </div>
  )
}

function FileTab() {
  const [text, setText] = React.useState("")
  const [name, setName] = React.useState("")
  const [over, setOver] = React.useState(false)
  const ref = React.useRef<HTMLInputElement>(null)
  const { bundle, error } = useParsed(text)
  const read = async (f?: File | null) => {
    if (!f) return
    if (f.size > 2_000_000) {
      toast.error("Plik jest za duży", { description: "Eksport ciasteczek ma zwykle kilka kB." })
      return
    }
    setName(f.name)
    setText(await f.text())
  }
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          void read(e.dataTransfer.files?.[0])
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 border border-dashed p-8 text-sm transition-colors",
          over ? "border-ring bg-muted" : "border-border hover:bg-muted/40"
        )}
      >
        <FileUpIcon className="size-6 text-muted-foreground" />
        <span className="font-medium">{name || "Przeciągnij tu plik z ciasteczkami albo kliknij"}</span>
        <span className="text-xs text-muted-foreground">cookies.txt (Netscape) lub .json z rozszerzenia do ciasteczek</span>
      </button>
      <input
        ref={ref}
        type="file"
        accept=".txt,.json,text/plain,application/json"
        className="hidden"
        onChange={(e) => {
          void read(e.target.files?.[0])
          e.target.value = ""
        }}
      />
      {error && <p className="text-sm text-status-bad">{error}</p>}
      {bundle && (
        <Preview
          bundle={bundle}
          onConnect={() => {
            void connectCookies(bundle)
            setText("")
            setName("")
          }}
        />
      )}
    </div>
  )
}

function ExtensionTab() {
  const [error, setError] = React.useState<string | null>(null)
  const fromClipboard = async () => {
    setError(null)
    try {
      const t = await navigator.clipboard.readText()
      await connectCookies(t)
    } catch (e) {
      setError(
        e instanceof CookieParseError
          ? e.message
          : `Brak dostępu do schowka (${e instanceof Error ? e.message : e}). Naciśnij Ctrl+V w dowolnym miejscu aplikacji albo użyj zakładki Wklej.`
      )
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
        <li>
          Zainstaluj rozszerzenie z folderu <code>extension/</code>: <span className="text-muted-foreground">chrome://extensions</span>{" "}
          (albo edge://extensions) → tryb dewelopera → „Załaduj rozpakowane”.
        </li>
        <li>Zaloguj się na instagram.com na koncie pomocniczym.</li>
        <li>
          Otwórz aplikację OSINT-IG, kliknij ikonę rozszerzenia → <strong>„Połącz z aplikacją OSINT-IG”</strong>.
        </li>
        <li>
          Konto zostanie połączone i sprawdzone automatycznie. Poniższy przycisk służy do ręcznego importu ze schowka.
        </li>
      </ol>
      <Button onClick={() => void fromClipboard()} className="w-fit">
        <ClipboardPasteIcon data-icon="inline-start" />
        Wklej ze schowka i połącz
      </Button>
      {error && <p className="text-sm text-status-bad">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Rozszerzenie czyta ciasteczka tylko z instagram.com i przekazuje je lokalnie do tej aplikacji. Potwierdzenie pojawia się po sprawdzeniu sesji przez Instagram.
      </p>
    </div>
  )
}

/* ------------------------------- Pula kont -------------------------------- */

function AccountPool() {
  const sessions = useStore((s) => s.sessions)
  const health = useStore((s) => s.health)
  useNow(false) // odświeżanie licznika cooldownu
  const cdAccounts = health.info?.cooldown?.accounts
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})

  const connect = async (id: string) => {
    const text = (drafts[id] || "").trim()
    if (!text) return
    try {
      await connectCookiesTo(id, text)
      setDrafts((d) => {
        const n = { ...d }
        delete n[id]
        return n
      })
    } catch (e) {
      toast.error(e instanceof CookieParseError ? e.message : "Nie udało się odczytać ciasteczek.")
    }
  }

  return (
    <Panel
      title="Pula kont (dzielenie pracy)"
      description="Dodaj kilka kont — aplikacja rozdziela pobieranie między nie (jedno konto na profil), żeby żadne nie przegrzało się. Limit (429) na jednym koncie nie blokuje pozostałych."
    >
      <div className="flex flex-col divide-y border">
        {sessions.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">Brak kont w puli. Dodaj pierwsze poniżej.</p>
        )}
        {sessions.map((e, i) => {
          const cd = cdAccounts?.[e.meta?.userId ?? ""] ?? cdAccounts?.[e.id]
          const cooling = cd?.active ? Math.ceil(cd.remainingMs / 1000) : 0
          return (
            <div key={e.id} className="flex flex-col gap-2 p-3">
              <div className="flex items-center gap-2">
                <span className="tnum text-xs text-muted-foreground">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {e.account ? `@${e.account}` : e.cookie ? "konto niezweryfikowane" : "nowe konto — wklej ciasteczka"}
                </span>
                {e.verifying && <Spinner className="size-3.5" />}
                {!e.verifying && e.account && cooling > 0 && (
                  <span className="text-[11px] text-amber-500">● cooldown {cooling}s</span>
                )}
                {!e.verifying && e.account && cooling === 0 && (
                  <span className="text-[11px] text-status-good">● gotowe</span>
                )}
                {!e.verifying && !e.account && e.cookie && (
                  <span className="text-[11px] text-destructive">● {e.error ? "błąd" : "niezweryfikowane"}</span>
                )}
                {e.cookie && (
                  <Button size="xs" variant="ghost" onClick={() => void verifySessionEntry(e.id)} disabled={e.verifying}>
                    Sprawdź
                  </Button>
                )}
                <Button size="icon-xs" variant="ghost" onClick={() => removeAccount(e.id)} aria-label="Usuń konto">
                  <Trash2Icon />
                </Button>
              </div>
              {!e.cookie && (
                <div className="flex flex-col gap-2">
                  <Textarea
                    rows={2}
                    value={drafts[e.id] || ""}
                    onChange={(ev) => setDrafts((d) => ({ ...d, [e.id]: ev.target.value }))}
                    placeholder="Wklej ciasteczka IG: sessionid=…; ds_user_id=…; csrftoken=…"
                    className="font-mono text-xs"
                  />
                  <Button size="xs" className="w-fit" onClick={() => void connect(e.id)} disabled={!(drafts[e.id] || "").trim()}>
                    Podłącz i sprawdź
                  </Button>
                </div>
              )}
              {e.error && <p className="text-xs text-destructive">{e.error.message}</p>}
            </div>
          )
        })}
      </div>
      <Button size="xs" variant="outline" className="mt-3 w-fit" onClick={() => addAccount()}>
        <PlugZapIcon data-icon="inline-start" />
        Dodaj konto do puli
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        Na razie wszystkie konta wychodzą z tego samego IP — to zmniejsza liczbę akcji na konto, ale IG może je kojarzyć po IP.
        Pełne rozdzielenie (proxy na konto) dodamy później.
      </p>
    </Panel>
  )
}

/* --------------------------------- Widok ---------------------------------- */

export function SessionView() {
  const session = useStore((s) => s.session)
  const autoLists = useStore((s) => s.autoLists)

  return (
    <PageBody>
      <ConnectionCard />
      <AccountPool />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title={session.cookie ? "Podmień ciasteczka" : "Połącz konto Instagrama"}
            description="Wybierz najwygodniejszy sposób. Ciasteczka zostają tylko na tym urządzeniu."
          >
            <Tabs defaultValue="extension">
              <TabsList>
                <TabsTrigger value="extension">
                  <PuzzleIcon />
                  Rozszerzenie
                </TabsTrigger>
                <TabsTrigger value="paste">
                  <ClipboardPasteIcon />
                  Wklej
                </TabsTrigger>
                <TabsTrigger value="file">
                  <FileUpIcon />
                  Plik
                </TabsTrigger>
              </TabsList>
              <TabsContent value="extension" className="pt-4">
                <ExtensionTab />
              </TabsContent>
              <TabsContent value="paste" className="pt-4">
                <PasteTab />
              </TabsContent>
              <TabsContent value="file" className="pt-4">
                <FileTab />
              </TabsContent>
            </Tabs>
          </Panel>
          {session.error && <ErrorPanel error={session.error} onRetry={() => void verifySession()} />}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Alert variant="destructive">
            <ShieldAlertIcon />
            <AlertTitle>Nie używaj swojego głównego konta</AlertTitle>
            <AlertDescription>
              Zapytania przez zalogowaną sesję to scraping: łamią regulamin IG i realnie grożą ograniczeniem lub blokadą konta.
              Załóż osobne konto pomocnicze.
            </AlertDescription>
          </Alert>
          <Panel title="Co dają ciasteczka">
            <ul className="flex flex-col gap-1.5 text-sm">
              <li>Analiza profili idzie jak z zalogowanej przeglądarki: rzadziej trafia na ścianę logowania i limit.</li>
              <li>Dostępne są listy obserwujących i obserwowanych (graf z kierunkami).</li>
              <li>Profile prywatne, które to konto obserwuje, stają się widoczne.</li>
            </ul>
          </Panel>
          <Panel title="Bezpieczeństwo">
            <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              <li>Ciasteczka leżą tylko w {isTauri ? "magazynie aplikacji" : "localStorage tej przeglądarki"}, nie w zapisie sesji ani eksportach.</li>
              <li>Do lokalnego serwera trafiają na czas zapytania; nie są zapisywane ani logowane, a w diagnostyce widać tylko ich nazwy.</li>
              <li>Przechodzą wyłącznie ciasteczka instagram.com z białej listy.</li>
              <li>„Odłącz i usuń” kasuje je natychmiast. Wylogowanie na instagram.com unieważnia je po stronie IG.</li>
            </ul>
          </Panel>
          <Panel title="Automatyzacja">
            <Label className="flex items-start gap-3 text-sm font-normal">
              <Switch checked={autoLists} onCheckedChange={setAutoLists} disabled={!session.cookie} className="mt-0.5" />
              <span>
                Pobieraj listy obserwujących i obserwowanych automatycznie przy każdej analizie.
                <span className="block text-xs text-muted-foreground">
                  Każda strona listy (50 kont) to osobne zapytanie z losową pauzą 3–7 s (anti-ban).
                </span>
              </span>
            </Label>
          </Panel>
          {session.cookie && (
            <Button
              variant="ghost"
              size="xs"
              className="w-fit"
              onClick={() => {
                clearSession()
                toast.success("Ciasteczka usunięte z urządzenia")
              }}
            >
              <Trash2Icon data-icon="inline-start" />
              Usuń ciasteczka z tego urządzenia
            </Button>
          )}
        </div>
      </div>
    </PageBody>
  )
}
