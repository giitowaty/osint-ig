import * as React from "react"
import {
  ActivityIcon,
  AtSignIcon,
  ChevronRightIcon,
  ColumnsIcon,
  CircleAlertIcon,
  EyeIcon,
  EyeOffIcon,
  HistoryIcon,
  ImagesIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  MedalIcon,
  MoreHorizontalIcon,
  RotateCwIcon,
  SearchIcon,
  Trash2Icon,
  UsersIcon,
  WaypointsIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react"

import { IgImage } from "@/components/ig-image"
import { ListPager } from "@/components/list-pager"
import { pageSlice } from "@/lib/large-lists"
import { openQueue } from "@/components/queue-sheet"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { analyze, normalizeUsername, validateUsername } from "@/lib/actions"
import { fmtCompact } from "@/lib/analysis"
import { isTauri } from "@/lib/runtime"
import {
  clearHistory,
  navigate,
  patchProfile,
  removeProfile,
  useStore,
  type View,
} from "@/lib/store"
import { cn } from "@/lib/utils"

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" fill="currentColor" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="var(--background)" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="2.6" fill="var(--background)" />
      <path d="M16 3.5v4M16 24.5v4M3.5 16h4M24.5 16h4" stroke="var(--background)" strokeWidth="1.6" />
    </svg>
  )
}

function AnalyzeInput({ onSearch }: { onSearch: () => void }) {
  const [value, setValue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const ref = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    const focus = () => ref.current?.focus()
    window.addEventListener("osint:focus-analyze", focus)
    return () => window.removeEventListener("osint:focus-analyze", focus)
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const u = normalizeUsername(value)
    const err = validateUsername(u)
    setError(err)
    if (err) return
    void analyze(u)
    setValue("")
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1 group-data-[collapsible=icon]:hidden">
      <div
        className={cn(
          "flex h-9 items-center gap-1.5 border border-sidebar-border bg-background px-2 focus-within:border-ring",
          error && "border-status-bad"
        )}
      >
        <AtSignIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(null)
          }}
          placeholder="profil lub link IG"
          spellCheck={false}
          autoComplete="off"
          aria-label="Profil do analizy"
          aria-invalid={!!error}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-none"
        />
        <button
          type="button"
          onClick={onSearch}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Paleta poleceń"
          title="Paleta poleceń"
        >
          <Kbd>Ctrl K</Kbd>
        </button>
      </div>
      {error && <p className="text-[11px] leading-snug text-status-bad">{error}</p>}
      <button
        type="button"
        onClick={openQueue}
        className="w-fit text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Analizuj wiele kont naraz…
      </button>
    </form>
  )
}

function NavItem({
  view,
  icon: Icon,
  label,
  disabled,
  badge,
}: {
  view: View
  icon: React.ComponentType<{ className?: string }>
  label: string
  disabled?: boolean
  badge?: React.ReactNode
}) {
  const current = useStore((s) => s.view)
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={current === view}
        disabled={disabled}
        tooltip={label}
        onClick={() => {
          navigate(view)
          if (isMobile) setOpenMobile(false)
        }}
      >
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
      {badge != null && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  )
}

function ProfileItem({ username }: { username: string }) {
  const entry = useStore((s) => s.profiles[username])
  const active = useStore((s) => s.active === username)
  const view = useStore((s) => s.view)
  const { isMobile, setOpenMobile } = useSidebar()
  if (!entry) return null
  const p = entry.data?.profile
  const go = () => {
    navigate(["overview", "content", "audience"].includes(view) ? view : "overview", username)
    if (isMobile) setOpenMobile(false)
  }
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} onClick={go} tooltip={`@${username}`} size="lg" className="gap-2">
        <span className="relative size-7 shrink-0">
          <IgImage
            src={p?.avatar ?? ""}
            className="size-7"
            fallback={<span className="text-[11px] font-semibold uppercase">{username[0]}</span>}
          />
          {entry.status === "loading" && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/70">
              <Spinner className="size-3.5" />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className={cn("truncate text-sm", !entry.inNetwork && "text-muted-foreground line-through decoration-1")}>
            @{username}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {entry.status === "loading"
              ? "pobieranie…"
              : entry.status === "error"
                ? (entry.error?.code ?? "błąd")
                : p
                  ? `${fmtCompact(p.followers)} obs. · ${entry.data?.connections.length ?? 0} powiązań${entry.tags?.length ? ` · ${entry.tags.join(", ")}` : ""}`
                  : ""}
          </span>
        </span>
        {entry.status === "error" && <CircleAlertIcon className="ml-auto size-3.5 text-status-bad" />}
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={`Akcje dla @${username}`}>
            <MoreHorizontalIcon />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => void analyze(username, { focus: false, fresh: true })}>
              <RotateCwIcon />
              Pobierz ponownie
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => patchProfile(username, { inNetwork: !entry.inNetwork })}>
              {entry.inNetwork ? <EyeOffIcon /> : <EyeIcon />}
              {entry.inNetwork ? "Ukryj w sieci" : "Pokaż w sieci"}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onSelect={() => removeProfile(username)}>
              <Trash2Icon />
              Usuń z sesji
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

function EngineStatus() {
  const health = useStore((s) => s.health)
  const color =
    health.status === "ok" ? "bg-status-good" : health.status === "down" ? "bg-status-bad" : "bg-status-warn"
  const label =
    health.status === "ok"
      ? `${isTauri ? "Silnik" : "Serwer"} · ${health.latencyMs ?? "?"} ms`
      : health.status === "down"
        ? `${isTauri ? "Silnik" : "Serwer"} nie odpowiada`
        : "Łączę z serwerem…"
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="sm"
          tooltip={label}
          onClick={() => navigate("activity")}
          className="text-xs text-muted-foreground"
        >
          <span className="flex size-4 items-center justify-center">
            <span className={cn("size-2 rounded-full", color, health.status === "checking" && "animate-pulse")} />
          </span>
          <span className="truncate">{label}</span>
          {health.info && (
            <span className="ml-auto text-[10px] tracking-wide uppercase">
              {isTauri ? "desktop" : "web"} {health.info.version}
            </span>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function AppSidebar({ onCommand }: { onCommand: () => void }) {
  const order = useStore((s) => s.order)
  const active = useStore((s) => s.active)
  const history = useStore((s) => s.history)
  const logs = useStore((s) => s.logs)
  const account = useStore((s) => s.session.account)
  const cookie = useStore((s) => s.session.cookie)
  const profiles = useStore((s) => s.profiles)
  const [filter, setFilter] = React.useState("")
  const search = React.useDeferredValue(filter.trim().replace(/^@/, "").toLowerCase())
  const [status, setStatus] = React.useState("all")
  const [page, setPage] = React.useState(0)
  const matches = React.useMemo(() => order.filter((u) => {
    const p = profiles[u]
    return (status === "all" || p?.status === status) && (!search || `${u} ${p?.data?.profile.fullName ?? ""} ${p?.tags?.join(" ") ?? ""}`.toLowerCase().includes(search))
  }), [order, profiles, search, status])
  const visible = pageSlice(matches, page)
  const errorCount = React.useMemo(() => logs.filter((l) => l.level === "error").length, [logs])
  const recent = history.filter((u) => !order.includes(u))

  return (
    <Sidebar collapsible="icon" data-print-hide>
      <SidebarHeader className="gap-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={() => navigate(active ? "overview" : "overview")} tooltip="OSINT-IG">
              <BrandMark className="size-8 shrink-0 text-sidebar-foreground" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="font-heading text-base font-semibold tracking-wide">OSINT-IG</span>
                <span className="truncate text-[11px] text-muted-foreground">analiza profili i sieci</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <AnalyzeInput onSearch={onCommand} />
        <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Analizuj profil (Ctrl K)" onClick={onCommand}>
              <SearchIcon />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Profil{active ? ` · @${active}` : ""}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem view="overview" icon={LayoutDashboardIcon} label="Przegląd" />
              <NavItem view="content" icon={ImagesIcon} label="Treści" disabled={!active} />
              <NavItem view="audience" icon={UsersIcon} label="Odbiorcy" disabled={!active} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sieć</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem view="network" icon={WaypointsIcon} label="Graf powiązań" />
              <NavItem view="influence" icon={MedalIcon} label="Wpływ i centralność" />
              <NavItem view="compare" icon={ColumnsIcon} label="Porównanie profili" />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Profile w sesji · {order.length.toLocaleString("pl-PL")}</SidebarGroupLabel>
          {order.length > 0 && (
            <SidebarGroupAction title="Analizuj kolejny profil" onClick={onCommand}>
              <SearchIcon />
              <span className="sr-only">Analizuj kolejny profil</span>
            </SidebarGroupAction>
          )}
          <SidebarGroupContent>
            {order.length > 10 && <div className="mb-2 flex flex-col gap-1.5 px-2 group-data-[collapsible=icon]:hidden">
              <input value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0) }} aria-label="Szukaj w zapisanych profilach" placeholder="Szukaj konta, nazwy lub tagu…" className="h-8 w-full border bg-background px-2 text-xs" />
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }} aria-label="Stan zapisanych profili" className="h-8 border bg-background px-2 text-xs">
                <option value="all">Wszystkie stany</option><option value="ready">Gotowe</option><option value="error">Błędy</option><option value="loading">W trakcie</option>
              </select>
              <span className="text-[11px] text-muted-foreground">Znaleziono {matches.length.toLocaleString("pl-PL")}</span>
              {active && !visible.items.includes(active) && <button className="text-left text-xs underline" onClick={() => { setFilter(""); setStatus("all"); setPage(Math.floor(order.indexOf(active) / 50)) }}>Pokaż bieżący profil</button>}
            </div>}
            <SidebarMenu>
              {order.length ? (
                visible.items.map((u) => <ProfileItem key={u} username={u} />)
              ) : (
                <p className="px-2 py-1 text-xs leading-relaxed text-muted-foreground group-data-[collapsible=icon]:hidden">
                  Każdy analizowany profil trafia tutaj i do wspólnego grafu.
                </p>
              )}
            </SidebarMenu>
            {order.length > 0 && !matches.length && <p className="px-2 text-xs text-muted-foreground">Brak pasujących profili.</p>}
            <div className="group-data-[collapsible=icon]:hidden"><ListPager page={visible.page} pages={visible.pages} onChange={setPage} label="Profile" /></div>
          </SidebarGroupContent>
        </SidebarGroup>

        {recent.length > 0 && (
          <Collapsible defaultOpen className="group/collapsible">
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger>
                  <HistoryIcon className="mr-1" />
                  Historia
                  <ChevronRightIcon className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <SidebarGroupAction title="Wyczyść historię" onClick={clearHistory} className="right-8">
                <XIcon />
                <span className="sr-only">Wyczyść historię</span>
              </SidebarGroupAction>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {recent.slice(0, 10).map((u) => (
                      <SidebarMenuItem key={u}>
                        <SidebarMenuButton size="sm" tooltip={`Analizuj @${u}`} onClick={() => void analyze(u)}>
                          <AtSignIcon />
                          <span>{u}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        )}

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem
                view="activity"
                icon={ActivityIcon}
                label="Aktywność"
                badge={errorCount ? <span className="text-status-bad">{errorCount}</span> : undefined}
              />
              <NavItem
                view="session"
                icon={KeyRoundIcon}
                label="Sesja IG"
                badge={account ? <span className="max-w-16 truncate">@{account}</span> : cookie ? "?" : undefined}
              />
              <NavItem view="tools" icon={WrenchIcon} label="Narzędzia" />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter>
        <EngineStatus />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
