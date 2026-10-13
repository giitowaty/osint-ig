import { TriangleAlertIcon } from "lucide-react"

import { PageBody, Panel, ProfileGate } from "@/components/profile-parts"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface Seg {
  key: string
  label: string
  value: number
  color: string
  /** Jasne segmenty (neutralne, nieokreślone) dostają ciemny napis. */
  light?: boolean
}

function StackBar({ segs, label }: { segs: Seg[]; label: string }) {
  const total = segs.reduce((a, s) => a + s.value, 0) || 1
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-8 w-full gap-0.5" role="img" aria-label={label}>
        {segs
          .filter((s) => s.value > 0)
          .map((s) => (
            <span
              key={s.key}
              className={cn(
                "flex items-center justify-center overflow-hidden text-[11px] font-semibold",
                s.light ? "text-foreground" : "text-white"
              )}
              style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
              title={`${s.label}: ${s.value}`}
            >
              {(s.value / total) * 100 >= 9 ? `${Math.round((s.value / total) * 100)}%` : ""}
            </span>
          ))}
      </div>
      <ul className="grid grid-cols-3 gap-2">
        {segs.map((s) => (
          <li key={s.key} className="flex flex-col">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tnum text-xl font-semibold">
              {s.value}
              <span className="ml-1 text-xs font-normal text-muted-foreground">{Math.round((s.value / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const GENDER_LABEL = { female: "kobieta", male: "mężczyzna", unknown: "nieokreślona" } as const

export function AudienceView() {
  return (
    <ProfileGate>
      {(entry) => {
        const s = entry.data.content?.sentiment
        const a = entry.data.audience
        return (
          <PageBody>
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel
                title="Wydźwięk komentarzy"
                description={
                  s?.available
                    ? `Próbka ${s.sampleSize} podglądowych komentarzy, leksykon słów i emoji. Ogólny ton: ${s.tone}.`
                    : "Brak komentarzy do analizy."
                }
              >
                {s?.available ? (
                  <div className="flex flex-col gap-4">
                    <StackBar
                      label="Rozkład wydźwięku"
                      segs={[
                        { key: "pos", label: "Pozytywne", value: s.positive, color: "var(--div-pos)" },
                        { key: "neu", label: "Neutralne", value: s.neutral, color: "var(--div-mid)", light: true },
                        { key: "neg", label: "Negatywne", value: s.negative, color: "var(--div-neg)" },
                      ]}
                    />
                    {(s.examples?.positive || s.examples?.negative) && (
                      <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                        {s.examples?.positive && (
                          <figure className="flex flex-col gap-1">
                            <figcaption className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                              Przykład pozytywny
                            </figcaption>
                            <blockquote className="font-heading text-base italic">„{s.examples.positive}”</blockquote>
                          </figure>
                        )}
                        {s.examples?.negative && (
                          <figure className="flex flex-col gap-1">
                            <figcaption className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                              Przykład negatywny
                            </figcaption>
                            <blockquote className="font-heading text-base italic">„{s.examples.negative}”</blockquote>
                          </figure>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{s?.reason ?? "Instagram nie udostępnił podglądu komentarzy."}</p>
                )}
              </Panel>

              <Panel title="Płeć odbiorców · szacunek" description={a?.available ? `Próbka ${a.sampleSize} osób: ${a.source}` : undefined}>
                <div className="flex flex-col gap-4">
                  <Alert>
                    <TriangleAlertIcon />
                    <AlertTitle>To nie jest demografia obserwujących</AlertTitle>
                    <AlertDescription>
                      Instagram pokazuje ją tylko właścicielowi konta. Tu zgadujemy płeć z imion w małej próbce osób komentujących
                      i lajkujących (słownik PESEL + źródła otwarte). Wynik ma duży margines błędu.
                    </AlertDescription>
                  </Alert>
                  {a?.available ? (
                    <StackBar
                      label="Szacunek płci"
                      segs={[
                        { key: "f", label: "Kobiety", value: a.female, color: "var(--series-1)" },
                        { key: "m", label: "Mężczyźni", value: a.male, color: "var(--series-2)" },
                        { key: "u", label: "Nieokreślona", value: a.unknown, color: "var(--series-other)", light: true },
                      ]}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">Brak próbki komentujących i lajkujących (IG nie udostępnił podglądu).</p>
                  )}
                </div>
              </Panel>
            </div>

            {a?.sample && a.sample.length > 0 && (
              <Panel
                title="Próbka do weryfikacji"
                description="Każda osoba z próbki i to, jak ją sklasyfikowano. Sprawdź, czy heurystyka ma sens dla tego profilu."
              >
                <div className="max-h-[28rem] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead>Konto</TableHead>
                        <TableHead>Nazwa wyświetlana</TableHead>
                        <TableHead>Szacunek</TableHead>
                        <TableHead className="text-right">Pewność</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {a.sample.map((x) => (
                        <TableRow key={x.username}>
                          <TableCell className="font-medium">@{x.username}</TableCell>
                          <TableCell className="text-muted-foreground">{x.fullName || "—"}</TableCell>
                          <TableCell>
                            <Badge variant={x.gender === "unknown" ? "secondary" : "outline"}>{GENDER_LABEL[x.gender]}</Badge>
                          </TableCell>
                          <TableCell className="tnum text-right">{x.confidence ? `${Math.round(x.confidence * 100)}%` : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Panel>
            )}
          </PageBody>
        )
      }}
    </ProfileGate>
  )
}
