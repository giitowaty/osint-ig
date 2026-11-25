import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"
import { useNow } from "@/hooks/use-now"
import {
  atLimit, dayKey, DAILY_LIMIT_DEFAULT, DAILY_LIMIT_MAX, describeTempo, formatWait, msToMidnight, parseLimit,
  positionFromTempo, tempoFromPosition, usedToday,
} from "@/lib/pace"
import { patchQueue, setDailyLimit, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const LEVEL_TEXT = { fast: "text-status-warn", normal: "text-muted-foreground", careful: "text-muted-foreground" } as const

/**
 * Tempo pracy (suwak pauzy między kontami) i dzienny limit operacji na konto.
 * Oba pokrętła zmniejszają ryzyko limitu Instagrama bez żadnych sztuczek: wolniej
 * i mniej zapytań z jednego konta.
 */
export function PacePanel() {
  const delayMs = useStore((s) => s.queue.delayMs)
  const dailyLimit = useStore((s) => s.dailyLimit)
  const usage = useStore((s) => s.usage)
  const sessions = useStore((s) => s.sessions)
  useNow(true, 30_000) // odświeża „zeruje się za…” i licznik po północy
  const now = new Date()
  const today = dayKey(now)
  const tempo = describeTempo(delayMs)
  const accounts = sessions.filter((e) => e.cookie)

  // Podczas edycji pole ma roboczy tekst (draft); poza edycją pokazuje zapisany limit.
  // Puste lub niepoprawne wartości nie zmieniają limitu.
  const [draft, setDraft] = React.useState<string | null>(null)
  const parsed = draft == null ? dailyLimit : parseLimit(draft)

  return (
    <div className="flex flex-col gap-5">
      <Field>
        <div className="flex items-baseline justify-between gap-3">
          <FieldLabel htmlFor="pace-slider">Tempo: pauza między kontami</FieldLabel>
          <span className="tnum text-sm font-semibold" aria-live="polite">
            {tempo.label}
            <span className="ml-2 text-xs font-normal text-muted-foreground">≈ {tempo.perMinute.toLocaleString("pl-PL")} kont/min</span>
          </span>
        </div>
        <Slider
          id="pace-slider"
          aria-label="Pauza między kontami"
          min={0}
          max={100}
          step={1}
          value={[positionFromTempo(delayMs)]}
          onValueChange={([p]) => patchQueue({ delayMs: tempoFromPosition(p) })}
        />
        <div className="flex justify-between text-[11px] text-muted-foreground" aria-hidden>
          <span>2 s · szybko</span>
          <span>~15 s</span>
          <span>2 min · ostrożnie</span>
        </div>
        <FieldDescription className={cn(LEVEL_TEXT[tempo.level])}>
          {tempo.advice} Każda pauza dostaje losowy rozrzut ±30%. Dotyczy kolejki kont i stron listy obserwujących.
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="pace-limit">Dzienny limit operacji na konto</FieldLabel>
        <Input
          id="pace-limit"
          type="text"
          inputMode="numeric"
          value={draft ?? String(dailyLimit)}
          aria-invalid={parsed == null}
          onFocus={() => setDraft(String(dailyLimit))}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            setDraft(e.target.value)
            const n = parseLimit(e.target.value)
            if (n != null) setDailyLimit(n)
          }}
          className="max-w-32"
        />
        <FieldDescription className={parsed == null ? "text-destructive" : dailyLimit === 0 ? "text-status-warn" : undefined}>
          {parsed == null
            ? `Wpisz liczbę od 0 do ${DAILY_LIMIT_MAX.toLocaleString("pl-PL")}. Dopóki pole jest niepoprawne, obowiązuje poprzedni limit.`
            : dailyLimit === 0
              ? "Bez limitu: kolejka nie ma górnego pułapu operacji na konto. Konto jest wtedy narażone na blokadę przy dużych kolejkach."
              : `Operacja to jedna analiza profilu albo jedna strona listy obserwujących (1–4 zapytań do Instagrama). Po wyczerpaniu limitu konto jest pomijane, a gdy limit wyczerpią wszystkie, kolejka się wstrzymuje. 0 = bez limitu; domyślnie ${DAILY_LIMIT_DEFAULT}.`}
        </FieldDescription>
      </Field>

      {accounts.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Dziś na kontach</span>
            <span className="text-xs text-muted-foreground">licznik zeruje się za {formatWait(msToMidnight(now))}</span>
          </div>
          <ul className="flex flex-col gap-2">
            {accounts.map((e, i) => {
              const used = usedToday(usage, e.id, today)
              const full = atLimit(used, dailyLimit)
              return (
                <li key={e.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">{e.account ? `@${e.account}` : `Konto ${i + 1}`}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {full && <Badge variant="destructive">limit wyczerpany</Badge>}
                      <span className="tnum text-muted-foreground">
                        {used}
                        {dailyLimit > 0 ? ` / ${dailyLimit}` : " (bez limitu)"}
                      </span>
                    </span>
                  </div>
                  {dailyLimit > 0 && <Progress value={Math.min(100, (used / dailyLimit) * 100)} className={cn("h-1", full && "bg-destructive/20")} aria-label={`Wykorzystanie limitu: ${used} z ${dailyLimit}`} />}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Bez połączonego konta zapytania idą anonimowo z Twojego adresu IP i limit dzienny ich nie obejmuje; tempo nadal działa.
        </p>
      )}
    </div>
  )
}
