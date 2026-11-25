import * as React from "react"
import { AtSignIcon, CopyIcon, ExternalLinkIcon, HashIcon, LinkIcon, MailIcon, PhoneIcon } from "lucide-react"
import { toast } from "sonner"

import { Panel } from "@/components/profile-parts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { analyze } from "@/lib/actions"
import { parseBio, type BioLink } from "@/lib/bio"
import { openExternal } from "@/lib/runtime"
import { navigate, useStore, type ProfileEntry } from "@/lib/store"

function copy(text: string, what: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success(`Skopiowano ${what}`),
    () => toast.error("Nie udało się skopiować do schowka")
  )
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3 py-2 text-sm">
      <span className="flex items-center gap-2 pt-0.5 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {icon}
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1.5">{children}</div>
    </div>
  )
}

function Copyable({ value, what }: { value: string; what: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="tnum truncate select-all">{value}</span>
      <Button size="icon-xs" variant="ghost" onClick={() => copy(value, what)} aria-label={`Kopiuj ${what}`}>
        <CopyIcon />
      </Button>
    </span>
  )
}

const SOURCE: Record<BioLink["source"], string> = { bio: "w tekście bio", externalUrl: "link w profilu", bioLinks: "lista linków IG" }

/**
 * Kontakty i odnośniki wyciągnięte z bio (oraz z pól kontaktowych konta firmowego).
 * Wzmianki z bio trafiają też do grafu powiązań.
 */
export function BioPanel({ entry, className }: { entry: ProfileEntry; className?: string }) {
  const profiles = useStore((s) => s.profiles)
  const p = entry.data?.profile
  const info = React.useMemo(() => (p ? parseBio(p) : null), [p])
  if (!p || !info) return null

  return (
    <Panel
      title="Z bio: kontakt i odnośniki"
      description="Wyciągnięte z opisu profilu i publicznych pól kontaktowych. Wzmianki z bio są też w grafie powiązań."
      className={className}
    >
      {info.empty ? (
        <p className="text-sm text-muted-foreground">
          {p.bio ? "W bio nie ma e-maili, telefonów, linków, wzmianek ani hashtagów." : "Profil nie ma bio ani linków."}
        </p>
      ) : (
        <div className="flex flex-col divide-y">
          {info.emails.length > 0 && (
            <Row icon={<MailIcon className="size-3.5" />} label="E-mail">
              {info.emails.map((e) => <Copyable key={e} value={e} what="e-mail" />)}
            </Row>
          )}
          {info.phones.length > 0 && (
            <Row icon={<PhoneIcon className="size-3.5" />} label="Telefon">
              {info.phones.map((ph) => <Copyable key={ph} value={ph} what="numer" />)}
            </Row>
          )}
          {info.links.length > 0 && (
            <Row icon={<LinkIcon className="size-3.5" />} label="Linki">
              {info.links.map((l) => (
                <span key={l.url} className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void openExternal(l.url)}
                    className="flex min-w-0 items-center gap-1 underline-offset-2 hover:underline"
                    title={`${l.url} · ${SOURCE[l.source]}`}
                  >
                    <span className="truncate">{l.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                    <ExternalLinkIcon className="size-3 shrink-0" />
                  </button>
                  {l.platform && <Badge variant="outline">{l.platform}</Badge>}
                </span>
              ))}
            </Row>
          )}
          {info.mentions.length > 0 && (
            <Row icon={<AtSignIcon className="size-3.5" />} label="Konta">
              {info.mentions.map((m) => {
                const inSession = profiles[m]?.status === "ready"
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => (inSession ? navigate("overview", m) : void analyze(m))}
                    className="underline-offset-2 hover:underline"
                    title={inSession ? "Otwórz profil z sesji" : "Analizuj ten profil"}
                  >
                    @{m}
                    {inSession && <span className="ml-1 text-xs text-muted-foreground">· w sesji</span>}
                  </button>
                )
              })}
            </Row>
          )}
          {info.hashtags.length > 0 && (
            <Row icon={<HashIcon className="size-3.5" />} label="Hashtagi">
              {info.hashtags.map((h) => <span key={h}>#{h}</span>)}
            </Row>
          )}
        </div>
      )}
    </Panel>
  )
}
