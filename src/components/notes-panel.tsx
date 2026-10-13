import * as React from "react"
import { TagIcon, XIcon } from "lucide-react"

import { Panel } from "@/components/profile-parts"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { setNotes, setTags } from "@/lib/actions"
import { useStore } from "@/lib/store"

const SUGGESTED = ["do sprawdzenia", "potwierdzone", "bot?", "marka", "osoba", "kluczowe", "powiązane"]

/** Notatki badawcze i tagi profilu: zapis automatyczny (sesja trwała w IndexedDB). */
export function NotesPanel({ username, className }: { username: string; className?: string }) {
  const entry = useStore((s) => s.profiles[username])
  const allTags = useStore((s) => s.profiles)
  const [draft, setDraft] = React.useState(entry?.notes ?? "")
  const [tag, setTag] = React.useState("")
  const tags = React.useMemo(() => entry?.tags ?? [], [entry?.tags])

  // Zapis z opóźnieniem: nie zapisujemy przy każdym znaku.
  React.useEffect(() => {
    if (draft === (entry?.notes ?? "")) return
    const t = setTimeout(() => setNotes(username, draft), 500)
    return () => clearTimeout(t)
  }, [draft, username, entry?.notes])

  const known = React.useMemo(() => {
    const set = new Set(SUGGESTED)
    for (const p of Object.values(allTags)) for (const t of p.tags ?? []) set.add(t)
    return [...set].filter((t) => !tags.includes(t)).slice(0, 10)
  }, [allTags, tags])

  const add = (t: string) => {
    const v = t.trim().toLowerCase()
    if (v) setTags(username, [...tags, v])
    setTag("")
  }

  return (
    <Panel
      title="Notatki badawcze"
      description="Zapisują się automatycznie i zostają w sesji po restarcie aplikacji."
      className={className}
    >
      <div className="flex flex-col gap-3">
        <Textarea
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ustalenia, źródła, hipotezy, co sprawdzić dalej…"
          aria-label={`Notatki o @${username}`}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <TagIcon className="size-3.5 text-muted-foreground" />
          {tags.map((t) => (
            <Badge key={t} variant="outline" className="gap-1">
              {t}
              <button
                type="button"
                onClick={() => setTags(username, tags.filter((x) => x !== t))}
                aria-label={`Usuń tag ${t}`}
                className="hover:text-status-bad"
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              add(tag)
            }}
          >
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="dodaj tag + Enter"
              aria-label="Nowy tag"
              className="h-6 w-32 border-b border-dashed border-input bg-transparent text-xs outline-none focus:border-ring focus-visible:outline-none"
            />
          </form>
        </div>
        {known.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {known.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => add(t)}
                className="border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-foreground hover:text-foreground"
              >
                + {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}
