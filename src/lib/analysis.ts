/* Analiza heurystyczna profilu po stronie klienta (wnioski, treści, eksport). */

import type { Post, Profile, ProfilePayload } from "./types"

const nf = new Intl.NumberFormat("pl-PL")
const nfCompact = new Intl.NumberFormat("pl-PL", { notation: "compact", maximumFractionDigits: 1 })

export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—"
  return nf.format(Number(n))
}

export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—"
  return Math.abs(n) < 10000 ? nf.format(n) : nfCompact.format(n)
}

export function fmtMs(ms: number | undefined | null): string {
  if (ms == null) return ""
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`
}

export function fmtTime(at: number): string {
  const d = new Date(at)
  return `${d.toLocaleTimeString("pl-PL", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`
}

export function fmtDate(at: number | null | undefined): string {
  if (!at) return "—"
  return new Date(at).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" })
}

export interface Stats {
  followers: number | null
  following: number | null
  posts: number | null
}

export function ratio(p: Stats): number | null {
  if (!p.following || p.followers == null) return null
  return p.followers / p.following
}

export function followersPerPost(p: Stats): number | null {
  if (!p.posts || p.followers == null) return null
  return p.followers / p.posts
}

export type InsightTone = "neutral" | "good" | "warn"
export interface Insight {
  key: string
  title: string
  text: string
  tone: InsightTone
}

export function tierOf(f: number | null): { label: string; text: string } | null {
  if (f == null) return null
  if (f >= 1_000_000) return { label: "Mega", text: "1 mln+ obserwujących" }
  if (f >= 100_000) return { label: "Macro", text: "duży zasięg, 100 tys.+" }
  if (f >= 10_000) return { label: "Micro", text: "średni zasięg, 10–100 tys." }
  if (f >= 1_000) return { label: "Nano", text: "mały zasięg, 1–10 tys." }
  return { label: "Niszowe", text: "poniżej 1 tys. obserwujących" }
}

export function insights(p: Profile, stats: Stats): Insight[] {
  const out: Insight[] = []
  const r = ratio(stats)
  const fpp = followersPerPost(stats)
  const tier = tierOf(stats.followers)
  if (tier) out.push({ key: "tier", title: `Skala: ${tier.label}`, text: tier.text, tone: "neutral" })
  if (r !== null) {
    let text: string
    let tone: InsightTone = "neutral"
    if (r >= 10) text = "silnie „influencerski”: obserwujących znacznie więcej niż obserwowanych"
    else if (r >= 2) text = "nadwyżka obserwujących nad obserwowanymi"
    else if (r >= 0.5) text = "zbalansowany stosunek obserwujących do obserwowanych"
    else {
      text = "obserwuje więcej kont, niż samo ma obserwujących (typowe dla kont prywatnych, nowych lub botów)"
      tone = "warn"
    }
    out.push({ key: "ratio", title: `Ratio ${r.toFixed(2)}`, text, tone })
  }
  if (stats.posts != null) {
    const n = stats.posts
    const text =
      n === 0
        ? "brak opublikowanych postów"
        : n < 10
          ? "bardzo mało postów: konto świeże lub mało aktywne"
          : n < 100
            ? "umiarkowana liczba postów"
            : "bogate archiwum: konto aktywne od dłuższego czasu"
    out.push({ key: "posts", title: `${fmt(n)} postów`, text, tone: n < 10 ? "warn" : "neutral" })
  }
  if (fpp !== null) {
    out.push({
      key: "fpp",
      title: `~${fmtCompact(Math.round(fpp))} obs. / post`,
      text: "orientacyjny potencjalny zasięg pojedynczego posta",
      tone: "neutral",
    })
  }
  out.push({
    key: "verified",
    title: p.verified ? "Zweryfikowane" : "Niezweryfikowane",
    text: p.verified ? "konto ma niebieski znaczek" : "brak znaczka weryfikacji",
    tone: p.verified ? "good" : "neutral",
  })
  out.push({
    key: "private",
    title: p.private ? "Profil prywatny" : "Profil publiczny",
    text: p.private ? "treści i próbki odbiorców są ukryte" : "treści dostępne do analizy",
    tone: p.private ? "warn" : "neutral",
  })
  if (p.category || p.isBusiness || p.isProfessional) {
    out.push({
      key: "pro",
      title: p.isBusiness ? "Konto firmowe" : p.isProfessional ? "Konto twórcy" : "Kategoria",
      text: p.category || "konto profesjonalne bez podanej kategorii",
      tone: "neutral",
    })
  }
  out.push({
    key: "bio",
    title: p.bio ? "Bio wypełnione" : "Puste bio",
    text: p.externalUrl ? "w bio jest link zewnętrzny" : p.bio ? "bez linku zewnętrznego" : "brak opisu profilu",
    tone: p.bio ? "neutral" : "warn",
  })
  return out
}

export interface ContentSummary {
  count: number
  typeCounts: Record<"image" | "video" | "carousel", number>
  avgLikes: number | null
  avgComments: number | null
  medianLikes: number | null
  engagement: number | null
  topTags: { tag: string; count: number }[]
  topPost: Post | null
  cadenceDays: number | null
  span: { from: number; to: number } | null
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function contentSummary(data: ProfilePayload): ContentSummary | null {
  const posts = data.posts
  if (!posts?.length) return null
  const typeCounts = { image: 0, video: 0, carousel: 0 }
  const likes: number[] = []
  const comments: number[] = []
  let topPost: Post | null = null
  for (const p of posts) {
    typeCounts[p.type] = (typeCounts[p.type] || 0) + 1
    if (p.likes != null) likes.push(p.likes)
    if (p.comments != null) comments.push(p.comments)
    if (p.likes != null && (!topPost || p.likes > (topPost.likes ?? 0))) topPost = p
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
  const avgLikes = avg(likes)
  const avgComments = avg(comments)
  const f = data.profile.followers
  const engagement =
    avgLikes != null && avgComments != null && f ? ((avgLikes + avgComments) / f) * 100 : null
  const times = posts.map((p) => p.takenAt).filter((t): t is number => !!t).sort((a, b) => a - b)
  const span = times.length >= 2 ? { from: times[0], to: times[times.length - 1] } : null
  const cadenceDays = span ? (span.to - span.from) / 86_400_000 / (times.length - 1) : null
  return {
    count: posts.length,
    typeCounts,
    avgLikes,
    avgComments,
    medianLikes: median(likes),
    engagement,
    topTags: (data.hashtags ?? []).slice(0, 12),
    topPost,
    cadenceDays,
    span,
  }
}

export function engagementLabel(e: number | null): string {
  if (e == null) return "brak danych"
  if (e >= 6) return "bardzo wysokie"
  if (e >= 3) return "wysokie"
  if (e >= 1) return "przeciętne"
  return "niskie"
}

export function exportText(data: ProfilePayload): string {
  const p = data.profile
  const s = contentSummary(data)
  const a = data.audience
  const c = data.content
  const L: string[] = []
  L.push(`OSINT-IG · analiza @${p.username}`)
  if (p.fullName) L.push(`Nazwa: ${p.fullName}`)
  L.push(`Status: ${p.verified ? "zweryfikowany" : "niezweryfikowany"}, ${p.private ? "prywatny" : "publiczny"}`)
  if (p.category) L.push(`Kategoria IG: ${p.category}`)
  L.push(`Obserwujący: ${fmt(p.followers)} | Obserwuje: ${fmt(p.following)} | Posty: ${fmt(p.posts)}`)
  const r = ratio(p)
  if (r !== null) L.push(`Ratio: ${r.toFixed(2)}`)
  if (c?.classification)
    L.push(`Klasyfikacja: ${c.classification.primary} [${c.classification.labels.map((l) => l.label).join(", ")}]`)
  if (s) {
    L.push("")
    L.push(`Treści (${s.count} ost. postów): ${s.typeCounts.image} zdjęć, ${s.typeCounts.video} wideo, ${s.typeCounts.carousel} karuzel`)
    if (s.engagement != null) L.push(`Zaangażowanie: ${s.engagement.toFixed(2)}% (${engagementLabel(s.engagement)})`)
    if (s.cadenceDays != null) L.push(`Częstotliwość: co ~${s.cadenceDays.toFixed(1)} dnia`)
    if (s.topTags.length) L.push(`Hashtagi: ${s.topTags.map((t) => "#" + t.tag).join(" ")}`)
  }
  if (c?.topics?.topics?.length)
    L.push("", "Tematyka: " + c.topics.topics.map((t) => `${t.category} ${Math.round(t.share * 100)}%`).join(", "))
  if (c?.interests?.length) L.push("Zainteresowania: " + c.interests.map((i) => i.label).join(", "))
  if (c?.sentiment?.available) {
    const x = c.sentiment
    L.push(`Wydźwięk komentarzy (${x.sampleSize}): ${x.tone}, poz ${x.positivePct}% / neu ${x.neutralPct}% / neg ${x.negativePct}%`)
  }
  if (a?.available) L.push("", `Płeć odbiorców (szacunek, próbka ${a.sampleSize}): K ${a.female} / M ${a.male} / ? ${a.unknown}`)
  if (data.connections?.length)
    L.push("", "Powiązania: " + data.connections.slice(0, 15).map((x) => `@${x.username}(${x.count})`).join(" "))
  return L.join("\n")
}

export function downloadJson(name: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
