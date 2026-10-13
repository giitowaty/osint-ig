import * as React from "react"
import { ArrowRightIcon, AtSignIcon, CircleAlertIcon, RotateCwIcon } from "lucide-react"

import { BrandMark } from "@/components/app-sidebar"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { analyze, checkHealth, normalizeUsername, validateUsername } from "@/lib/actions"
import { isTauri } from "@/lib/runtime"
import { navigate, useStore, type View } from "@/lib/store"
import { cn } from "@/lib/utils"

const MAP: { view: View; title: string; text: string }[] = [
  { view: "overview", title: "Przegląd", text: "liczby, ratio, zaangażowanie, częstotliwość, archetyp konta i wnioski" },
  { view: "content", title: "Treści", text: "siatka postów, polubienia w czasie, formaty, tematyka, hashtagi, zainteresowania" },
  { view: "audience", title: "Odbiorcy", text: "wydźwięk komentarzy i szacunek płci z próbki (z jawnym marginesem błędu)" },
  { view: "network", title: "Graf powiązań", text: "wszystkie profile z sesji na jednej mapie: oznaczenia, wzmianki, listy obserwujących" },
  { view: "influence", title: "Wpływ", text: "PageRank, pośredniość, stopień, wektor własny i ranking hubów oraz mostów" },
  { view: "compare", title: "Porównanie", text: "profile obok siebie i macierz wspólnych powiązań między każdą parą" },
  { view: "activity", title: "Aktywność", text: "każde zapytanie do IG z czasem, statusem i pełną diagnostyką błędów" },
]

export function Welcome() {
  const [value, setValue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const history = useStore((s) => s.history)
  const health = useStore((s) => s.health)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const u = normalizeUsername(value)
    const err = validateUsername(u)
    setError(err)
    if (!err) void analyze(u)
  }

  return (
    <div className="grid min-h-full gap-0 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section className="flex flex-col justify-center gap-6 border-b p-6 lg:p-10 xl:border-r xl:border-b-0 2xl:p-16">
        <BrandMark className="size-12 text-foreground" />
        <div className="flex flex-col gap-3">
          <h1 className="font-heading text-4xl leading-[1.05] font-semibold tracking-tight text-balance lg:text-5xl 2xl:text-6xl">
            Który profil prześwietlamy?
          </h1>
          <p className="max-w-[60ch] text-base text-muted-foreground">
            Wpisz nazwę konta albo wklej link do profilu. Każdy analizowany profil zostaje w sesji i trafia do wspólnego grafu,
            więc kolejne konta od razu pokazują, co je łączy.
          </p>
        </div>
        <form onSubmit={submit} className="flex w-full max-w-2xl flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label
              className={cn(
                "flex h-12 flex-1 items-center gap-2 border border-input bg-background px-3 focus-within:border-ring",
                error && "border-status-bad"
              )}
            >
              <AtSignIcon className="size-4 text-muted-foreground" />
              <input
                autoFocus
                value={value}
                onChange={(e) => {
                  setValue(e.target.value)
                  if (error) setError(null)
                }}
                placeholder="nazwa_uzytkownika lub instagram.com/…"
                spellCheck={false}
                autoComplete="off"
                aria-label="Profil do analizy"
                aria-invalid={!!error}
                className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus-visible:outline-none"
              />
            </label>
            <Button type="submit" size="lg" className="h-12">
              Analizuj
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
          {error ? (
            <p className="text-sm text-status-bad">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Później szybciej: <Kbd>Ctrl K</Kbd> otwiera paletę z każdego miejsca.
            </p>
          )}
        </form>

        {history.length > 0 && (
          <div className="flex flex-col gap-2">
            <h2 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">Ostatnio analizowane</h2>
            <div className="flex flex-wrap gap-1.5">
              {history.slice(0, 12).map((u) => (
                <Button key={u} size="xs" variant="outline" className="normal-case tracking-normal" onClick={() => void analyze(u)}>
                  @{u}
                </Button>
              ))}
            </div>
          </div>
        )}

        {health.status === "down" && (
          <div className="flex max-w-2xl items-start gap-3 border border-status-bad/40 bg-status-bad/[0.06] p-3 text-sm">
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-status-bad" />
            <div className="flex-1">
              <p className="font-medium">{health.error?.message ?? "Serwer nie odpowiada."}</p>
              <p className="text-muted-foreground">{health.error?.hint}</p>
            </div>
            <Button size="xs" variant="outline" onClick={() => void checkHealth()}>
              <RotateCwIcon data-icon="inline-start" />
              Sprawdź
            </Button>
          </div>
        )}
      </section>

      <section className="flex flex-col justify-center gap-1 p-6 lg:p-10 2xl:p-16">
        <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          Co zobaczysz po analizie
        </h2>
        <ol className="flex flex-col">
          {MAP.map((m) => (
            <li key={m.view}>
              <button
                type="button"
                onClick={() => navigate(m.view)}
                className="group grid w-full grid-cols-[9rem_minmax(0,1fr)_auto] items-baseline gap-4 border-t py-3 text-left transition-colors hover:bg-muted/40"
              >
                <span className="font-heading text-lg font-semibold">{m.title}</span>
                <span className="text-sm text-muted-foreground">{m.text}</span>
                <ArrowRightIcon className="size-4 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
              </button>
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-[65ch] border-t pt-4 text-xs leading-relaxed text-muted-foreground">
          Dane pochodzą z publicznych profili przez lokalny {isTauri ? "silnik aplikacji" : "serwer"}; nic nie wychodzi poza
          Twój komputer i Instagram. Pobieranie jest „best-effort”: IG bywa kapryśny (limity, ściana logowania), a każdy taki
          przypadek zobaczysz z pełną diagnostyką. Sekcja płci to szacunek z małej próbki, nie demografia obserwujących.
          Korzystaj zgodnie z regulaminem Instagrama i prawem.
        </p>
      </section>
    </div>
  )
}
