import { Button } from "@/components/ui/button"

export function ListPager({ page, pages, onChange, label = "Strona" }: { page: number; pages: number; onChange: (page: number) => void; label?: string }) {
  if (pages < 2) return null
  return <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground" aria-label={label}>
    <Button variant="ghost" size="xs" disabled={!page} onClick={() => onChange(page - 1)} aria-label={`${label}: poprzednia`}>Wstecz</Button>
    <span className="tnum">{page + 1} / {pages.toLocaleString("pl-PL")}</span>
    <Button variant="ghost" size="xs" disabled={page >= pages - 1} onClick={() => onChange(page + 1)} aria-label={`${label}: następna`}>Dalej</Button>
  </div>
}
