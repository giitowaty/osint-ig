import * as React from "react"
import {
  ActivityIcon,
  AtSignIcon,
  ImagesIcon,
  ColumnsIcon,
  KeyRoundIcon,
  ListOrderedIcon,
  LayoutDashboardIcon,
  MedalIcon,
  MoonIcon,
  PanelBottomIcon,
  RotateCwIcon,
  SearchIcon,
  UsersIcon,
  WaypointsIcon,
  WrenchIcon,
} from "lucide-react"

import { openQueue } from "@/components/queue-sheet"
import { useTheme } from "@/components/theme-provider"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import {
  analyze,
  normalizeUsername,
  reanalyzeAll,
  validateUsername,
} from "@/lib/actions"
import {
  getState,
  navigate,
  setDockOpen,
  useStore,
  type View,
} from "@/lib/store"

const VIEWS: {
  view: View
  label: string
  icon: React.ComponentType
  needsProfile?: boolean
}[] = [
  {
    view: "overview",
    label: "Przegląd profilu",
    icon: LayoutDashboardIcon,
    needsProfile: true,
  },
  { view: "content", label: "Treści", icon: ImagesIcon, needsProfile: true },
  { view: "audience", label: "Odbiorcy", icon: UsersIcon, needsProfile: true },
  { view: "network", label: "Graf powiązań", icon: WaypointsIcon },
  { view: "influence", label: "Wpływ i centralność", icon: MedalIcon },
  { view: "activity", label: "Aktywność i log", icon: ActivityIcon },
  { view: "session", label: "Sesja IG", icon: KeyRoundIcon },
  { view: "tools", label: "Narzędzia", icon: WrenchIcon },
]

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [query, setQuery] = React.useState("")
  const order = useStore((s) => s.order)
  const history = useStore((s) => s.history)
  const active = useStore((s) => s.active)
  const { theme, setTheme } = useTheme()

  const candidate = normalizeUsername(query)
  const valid = candidate && !validateUsername(candidate)
  const sessionNames = React.useMemo(() => {
    const q = query.trim().replace(/^@/, "").toLowerCase()
    return (q ? order.filter((u) => u.includes(q)) : order).slice(0, 50)
  }, [order, query])

  const run = (fn: () => void) => {
    onOpenChange(false)
    setQuery("")
    fn()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Paleta poleceń"
      description="Analizuj profil lub przejdź do widoku"
    >
      <Command>
        <CommandInput
          placeholder="Wpisz @nazwę, link IG albo polecenie…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            Brak wyników. Wpisz poprawną nazwę konta, aby ją przeanalizować.
          </CommandEmpty>
          {valid && (
            <CommandGroup heading="Analiza">
              <CommandItem
                value={`analizuj ${candidate}`}
                onSelect={() => run(() => void analyze(candidate))}
              >
                <SearchIcon />
                Analizuj @{candidate}
                <CommandShortcut>Enter</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          )}
          {order.length > 0 && (
            <CommandGroup heading="Profile w sesji">
              {sessionNames.map((u) => (
                <CommandItem
                  key={u}
                  value={`profil ${u}`}
                  onSelect={() => run(() => navigate("overview", u))}
                >
                  <AtSignIcon />
                  {u}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {history.filter((u) => !order.includes(u)).length > 0 && (
            <CommandGroup heading="Historia">
              {history
                .filter((u) => !order.includes(u))
                .slice(0, 8)
                .map((u) => (
                  <CommandItem
                    key={u}
                    value={`historia ${u}`}
                    onSelect={() => run(() => void analyze(u))}
                  >
                    <RotateCwIcon />
                    Analizuj ponownie @{u}
                  </CommandItem>
                ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup heading="Widoki">
            {VIEWS.filter((v) => !v.needsProfile || active).map((v) => (
              <CommandItem
                key={v.view}
                value={`widok ${v.label}`}
                onSelect={() => run(() => navigate(v.view))}
              >
                <v.icon />
                {v.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Akcje">
            {order.length > 0 && (
              <CommandItem
                value="odśwież wszystkie profile"
                onSelect={() => run(() => void reanalyzeAll())}
              >
                <RotateCwIcon />
                Pobierz ponownie wszystkie profile
              </CommandItem>
            )}
            <CommandItem
              value="kolejka wiele kont wsadowo"
              onSelect={() => run(openQueue)}
            >
              <ListOrderedIcon />
              Analizuj wiele kont (kolejka)
            </CommandItem>
            <CommandItem
              value="porównanie profili"
              onSelect={() => run(() => navigate("compare"))}
            >
              <ColumnsIcon />
              Porównaj profile w sesji
            </CommandItem>
            <CommandItem
              value="panel aktywności dok"
              onSelect={() => run(() => setDockOpen(!getState().dockOpen))}
            >
              <PanelBottomIcon />
              Pokaż / ukryj panel aktywności
              <CommandShortcut>Ctrl J</CommandShortcut>
            </CommandItem>
            <CommandItem
              value="motyw ciemny jasny"
              onSelect={() =>
                run(() => setTheme(theme === "dark" ? "light" : "dark"))
              }
            >
              <MoonIcon />
              Przełącz motyw
              <CommandShortcut>D</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
