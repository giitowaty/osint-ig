import { RotateCwIcon } from "lucide-react"

import { JobsList, LogStream } from "@/components/activity"
import { ErrorPanel } from "@/components/error-panel"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { checkHealth, clearServerCache, resetCooldown } from "@/lib/actions"
import { isTauri } from "@/lib/runtime"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

function uptime(ms: number) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h} h ${m} min` : m ? `${m} min ${s % 60} s` : `${s} s`
}

function EngineCard() {
  const health = useStore((s) => s.health)
  const i = health.info
  const rows: [string, string][] = i
    ? [
        ["Tryb", isTauri ? "desktop" : "web"],
        ["Wersja", i.version],
        ["Node", i.node],
        ["Platforma", i.platform],
        ["Adres", `${i.host}:${i.port}`],
        ["PID", String(i.pid)],
        ["Działa od", uptime(i.uptimeMs)],
        ["Opóźnienie", `${health.latencyMs ?? "?"} ms`],
        ["Plik wykonywalny", i.sea ? "pojedynczy plik (SEA)" : "node + skrypty"],
      ]
    : []
  return (
    <div className="flex shrink-0 flex-col gap-3 border-b p-4 xl:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "size-2.5 rounded-full",
            health.status === "ok" ? "bg-status-good" : health.status === "down" ? "bg-status-bad" : "animate-pulse bg-status-warn"
          )}
        />
        <h1 className="font-heading text-2xl font-semibold">
          {health.status === "ok" ? "Silnik działa" : health.status === "down" ? "Silnik nie odpowiada" : "Łączę z silnikiem…"}
        </h1>
        <Button size="xs" variant="outline" className="ml-auto" onClick={() => void checkHealth()}>
          <RotateCwIcon data-icon="inline-start" />
          Sprawdź teraz
        </Button>
      </div>
      {i && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9">
          {rows.map(([k, v]) => (
            <div key={k} className="flex min-w-0 flex-col">
              <dt className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{k}</dt>
              <dd className="tnum truncate" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {i && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-3 text-sm">
          <span className="flex items-center gap-2">
            <span className={cn("size-2 rounded-full", i.cooldown?.active ? "bg-status-warn" : "bg-status-good")} />
            {i.cooldown?.active
              ? `Zapytania do IG wstrzymane jeszcze ~${Math.ceil(i.cooldown.remainingMs / 1000)} s (${i.cooldown.strikes}. limit z rzędu)`
              : "Brak blokady zapytań do IG"}
          </span>
          {i.cooldown?.active && (
            <Button size="xs" variant="outline" onClick={() => void resetCooldown()}>
              Zdejmij blokadę
            </Button>
          )}
          <span className="text-muted-foreground">
            Pamięć podręczna: {i.cache?.entries ?? 0} profili, ważność {Math.round((i.cache?.ttlMs ?? 0) / 60000)} min
          </span>
          <Button size="xs" variant="ghost" onClick={() => void clearServerCache()} disabled={!i.cache?.entries}>
            Wyczyść pamięć
          </Button>
        </div>
      )}
      {health.status === "down" && health.error && (
        <ErrorPanel error={health.error} onRetry={() => void checkHealth()} />
      )}
    </div>
  )
}

export function ActivityView() {
  return (
    <div className="flex h-full min-h-[520px] flex-col">
      <EngineCard />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="62%" minSize="35%">
          <LogStream className="h-full" />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="38%" minSize="20%">
          <JobsList className="h-full" />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
