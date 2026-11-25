import * as React from "react"
import { MoonIcon, PanelBottomCloseIcon, PanelBottomOpenIcon, SunIcon, XIcon } from "lucide-react"

import { JobsList, LogStream } from "@/components/activity"
import { AppSidebar } from "@/components/app-sidebar"
import { CommandMenu } from "@/components/command-menu"
import { ErrorBoundary } from "@/components/error-boundary"
import { openQueue, QueueIndicator, QueueSheet } from "@/components/queue-sheet"
import { useTheme } from "@/components/theme-provider"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Progress } from "@/components/ui/progress"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { Toaster } from "@/components/ui/sonner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCookiePaste } from "@/hooks/use-cookie-paste"
import { useExtensionBridge } from "@/hooks/use-extension-bridge"
import { useEngineBridge } from "@/hooks/use-engine"
import { useIsMobile } from "@/hooks/use-mobile"
import { useHashRoute } from "@/hooks/use-hash-route"
import { getState, setDockOpen, useStore, type View } from "@/lib/store"
import { OverviewView } from "@/views/overview-view"

/*
 * Szybki start: w głównej paczce jest tylko widok startowy (Przegląd). Pozostałe
 * widoki — razem z ciężkimi bibliotekami (recharts, silnik grafu) — ładują się
 * osobno. Po pierwszym renderze dociągamy je w tle, więc przełączanie zostaje
 * natychmiastowe, a start nie czeka na kod, którego jeszcze nie widać.
 */
type LazyView = Exclude<View, "overview">
const imports: Record<LazyView, () => Promise<React.ComponentType>> = {
  content: () => import("@/views/content-view").then((m) => m.ContentView),
  audience: () => import("@/views/audience-view").then((m) => m.AudienceView),
  network: () => import("@/views/network-view").then((m) => m.NetworkView),
  influence: () => import("@/views/influence-view").then((m) => m.InfluenceView),
  activity: () => import("@/views/activity-view").then((m) => m.ActivityView),
  session: () => import("@/views/session-view").then((m) => m.SessionView),
  tools: () => import("@/views/tools-view").then((m) => m.ToolsView),
  compare: () => import("@/views/compare-view").then((m) => m.CompareView),
}

// Widoki już pobrane renderujemy wprost: React.lazy przy pierwszym renderze zawsze
// pokazuje fallback i trzyma go ≥300 ms, nawet gdy kod jest gotowy.
const loadedViews: Partial<Record<LazyView, React.ComponentType>> = {}
const loaders = Object.fromEntries(
  (Object.keys(imports) as LazyView[]).map((k) => [k, () => imports[k]().then((c) => { loadedViews[k] = c; return c })])
) as Record<LazyView, () => Promise<React.ComponentType>>

const LAZY_VIEWS = Object.fromEntries(
  (Object.keys(loaders) as LazyView[]).map((k) => [k, React.lazy(() => loaders[k]().then((c) => ({ default: c })))])
) as Record<LazyView, React.LazyExoticComponent<React.ComponentType>>

/** Dociąga kod pozostałych widoków, gdy przeglądarka jest bezczynna. */
function usePrefetchViews() {
  React.useEffect(() => {
    const run = () => { for (const load of Object.values(loaders)) void load().catch(() => {}) }
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(run, { timeout: 3000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = setTimeout(run, 1500)
    return () => clearTimeout(id)
  }, [])
}

function ViewFallback() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground" role="status">
      <Spinner className="size-5" />
      <span className="sr-only">Ładowanie widoku…</span>
    </div>
  )
}

const VIEW_TITLE: Record<View, string> = {
  overview: "Przegląd",
  content: "Treści",
  audience: "Odbiorcy",
  network: "Graf powiązań",
  influence: "Wpływ i centralność",
  activity: "Aktywność",
  session: "Sesja IG",
  tools: "Narzędzia",
  compare: "Porównanie",
}

function RunningIndicator() {
  const jobs = useStore((s) => s.jobs)
  const running = jobs.filter((j) => j.status === "running")
  if (!running.length) return null
  const j = running[0]
  const last = j.steps[j.steps.length - 1]
  return (
    <div className="hidden min-w-0 items-center gap-2 text-xs md:flex" aria-live="polite">
      <Spinner className="size-3.5 shrink-0" />
      <span className="truncate">
        <span className="font-medium">{j.label}</span>
        {last && <span className="text-muted-foreground"> · {last.label}</span>}
      </span>
      {j.progress && (
        <Progress value={(j.progress.current / Math.max(1, j.progress.total)) * 100} className="h-1 w-20 shrink-0" />
      )}
      {running.length > 1 && <span className="shrink-0 text-muted-foreground">+{running.length - 1}</span>}
    </div>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const dark =
    theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-sm" variant="ghost" onClick={() => setTheme(dark ? "light" : "dark")} aria-label="Przełącz motyw">
          {dark ? <SunIcon /> : <MoonIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Motyw <Kbd>D</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

function TopBar({ onCommand }: { onCommand: () => void }) {
  const view = useStore((s) => s.view)
  const active = useStore((s) => s.active)
  const dockOpen = useStore((s) => s.dockOpen)
  const profileView = view === "overview" || view === "content" || view === "audience"
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3" data-print-hide>
      <SidebarTrigger />
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className="hidden sm:inline-flex">
            <BreadcrumbPage className={profileView && active ? "text-muted-foreground" : undefined}>
              {VIEW_TITLE[view]}
            </BreadcrumbPage>
          </BreadcrumbItem>
          {profileView && active && (
            <>
              <BreadcrumbSeparator className="hidden sm:inline-flex" />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate">@{active}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mx-auto flex min-w-0 items-center gap-3 px-2">
        <RunningIndicator />
        <QueueIndicator />
      </div>
      <Button variant="outline" size="xs" onClick={onCommand} className="hidden gap-2 sm:inline-flex">
        Szukaj <Kbd>Ctrl K</Kbd>
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant={dockOpen ? "secondary" : "ghost"}
            onClick={() => setDockOpen(!dockOpen)}
            aria-label="Panel aktywności"
            aria-pressed={dockOpen}
          >
            {dockOpen ? <PanelBottomCloseIcon /> : <PanelBottomOpenIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Panel aktywności <Kbd>Ctrl J</Kbd>
        </TooltipContent>
      </Tooltip>
      <ThemeToggle />
    </header>
  )
}

function Dock() {
  const isMobile = useIsMobile()
  return (
    <section className="flex h-full min-h-0 flex-col bg-sidebar" aria-label="Aktywność na żywo" data-print-hide>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-good opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-status-good" />
        </span>
        <h2 className="text-[11px] font-semibold tracking-widest uppercase">Na żywo</h2>
        <Button size="icon-xs" variant="ghost" className="ml-auto" onClick={() => setDockOpen(false)} aria-label="Zamknij panel">
          <XIcon />
        </Button>
      </div>
      {isMobile ? (
        <LogStream className="min-h-0 flex-1" />
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize="62%" minSize="30%">
            <LogStream className="h-full" />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="38%" minSize="20%">
            <JobsList className="h-full" />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </section>
  )
}

function CurrentView() {
  const view = useStore((s) => s.view)
  // Wybór ustalany raz na wejście w widok (rodzic ma key={view}): przeskok z wersji
  // lazy na gotową w trakcie pracy przemontowałby widok i zgubił jego stan.
  const [Ready] = React.useState(() => (view === "overview" ? undefined : loadedViews[view]))
  if (view === "overview") return <OverviewView />
  if (Ready) return <Ready />
  const Lazy = LAZY_VIEWS[view]
  return (
    <React.Suspense fallback={<ViewFallback />}>
      <Lazy />
    </React.Suspense>
  )
}

export default function App() {
  const [cmdOpen, setCmdOpen] = React.useState(false)
  const dockOpen = useStore((s) => s.dockOpen)
  const view = useStore((s) => s.view)
  const active = useStore((s) => s.active)
  useEngineBridge()
  useHashRoute()
  useCookiePaste()
  useExtensionBridge()
  usePrefetchViews()

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setCmdOpen((v) => !v)
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault()
        openQueue()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault()
        setDockOpen(!getState().dockOpen)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const main = (
    <main id="main" className="h-full overflow-y-auto overflow-x-hidden" tabIndex={-1}>
      <div key={view} className="h-full animate-in fade-in-0 duration-200 motion-reduce:animate-none">
        <ErrorBoundary scope={VIEW_TITLE[view]} resetKey={`${view}/${active}`}>
          <CurrentView />
        </ErrorBoundary>
      </div>
    </main>
  )

  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <AppSidebar onCommand={() => setCmdOpen(true)} />
      <SidebarInset className="min-w-0 overflow-hidden">
        <TopBar onCommand={() => setCmdOpen(true)} />
        <div className="min-h-0 flex-1">
          {dockOpen && view !== "activity" ? (
            <ResizablePanelGroup orientation="vertical" id="osint-main-split">
              <ResizablePanel defaultSize="70%" minSize="30%">
                {main}
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize="30%" minSize="12%" maxSize="70%">
                <ErrorBoundary scope="Panel aktywności">
                  <Dock />
                </ErrorBoundary>
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            main
          )}
        </div>
      </SidebarInset>
      <ErrorBoundary scope="Paleta poleceń" resetKey={cmdOpen}>
        <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
      </ErrorBoundary>
      <ErrorBoundary scope="Kolejka">
        <QueueSheet />
      </ErrorBoundary>
      <Toaster position="bottom-right" />
    </SidebarProvider>
  )
}
