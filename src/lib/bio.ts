/*
 * Rozbiór bio profilu: kontakty, odnośniki, wzmianki i hashtagi.
 *
 * Bio jest najgęstszym źródłem informacji o koncie (e-mail, telefon, inne
 * profile, link do sklepu czy Linktree), a do tej pory było tylko wyświetlane.
 * Liczy się po stronie frontu, więc działa też dla profili zapisanych wcześniej.
 */

import type { Profile } from "./types"

export interface BioLink {
  url: string
  /** Rozpoznana platforma, np. „Linktree”, „WhatsApp”; null gdy zwykła strona. */
  platform: string | null
  /** Skąd link: z tekstu bio, z pola „link w bio” albo z listy linków IG. */
  source: "bio" | "externalUrl" | "bioLinks"
}

export interface BioInfo {
  emails: string[]
  phones: string[]
  links: BioLink[]
  /** Konta wspomniane w bio (bez @, małe litery). */
  mentions: string[]
  hashtags: string[]
  /** Czy cokolwiek znaleziono. */
  empty: boolean
}

const PLATFORMS: [RegExp, string][] = [
  [/(^|\.)linktr\.ee$/, "Linktree"],
  [/(^|\.)(wa\.me|whatsapp\.com)$/, "WhatsApp"],
  [/(^|\.)(t\.me|telegram\.me)$/, "Telegram"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "Facebook"],
  [/(^|\.)(x\.com|twitter\.com)$/, "X / Twitter"],
  [/(^|\.)linkedin\.com$/, "LinkedIn"],
  [/(^|\.)threads\.net$/, "Threads"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(onlyfans\.com|patreon\.com|buymeacoffee\.com|ko-fi\.com|patronite\.pl)$/, "wsparcie / subskrypcja"],
  [/(^|\.)(beacons\.ai|linkin\.bio|bio\.link|lnk\.bio|campsite\.bio)$/, "strona z linkami"],
]

// Popularne domeny najwyższego poziomu: domenę bez http:// uznajemy za link tylko z nimi
// (inaczej np. „ania.design” z podpisu wyglądałoby jak adres strony).
const BARE_TLD = "com|pl|net|org|eu|io|me|ee|link|app|shop|store|info|co|tv|de|uk|fm|gg|ly|bio|page|site|online|art|studio"
const URL_RE = new RegExp(
  String.raw`(?:https?:\/\/|www\.)[^\s<>"']+|(?<![@\w.-])(?:[a-z0-9-]+\.)+(?:${BARE_TLD})(?![a-z0-9-])(?:\/[^\s<>"']*)?(?![\w.-]*@)`,
  "gi"
)
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
// Zakamuflowane: „kontakt [at] firma [dot] pl”, „kontakt (at) firma.pl”
const OBFUSCATED_EMAIL_RE = /([a-z0-9._%+-]+)\s*[[({]\s*(?:at|małpa)\s*[\])}]\s*([a-z0-9-]+(?:\s*(?:[[({]\s*dot\s*[\])}]|\.)\s*[a-z0-9-]+)+)/gi
const MENTION_RE = /(?<![\w.@])@([a-z0-9._]{2,30})/gi
const HASHTAG_RE = /(?<![\w#])#([\p{L}\p{N}_]{2,50})/gu
const PHONE_RE = /(?<![\w+(])(?:\+|00|\()?\d[\d\s().-]{7,20}\d(?![\w])/g

const trimPunct = (s: string) => s.replace(/[.,;:!?)\]}>'"…]+$/, "")
const uniq = (list: string[]) => [...new Map(list.map((v) => [v.toLowerCase(), v])).values()]

function platformOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
    return PLATFORMS.find(([re]) => re.test(host))?.[1] ?? null
  } catch {
    return null
  }
}

function normalizeUrl(raw: string): string | null {
  const s = trimPunct(raw.trim())
  if (!s) return null
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    if (!u.hostname.includes(".")) return null
    return u.href.replace(/\/$/, "")
  } catch {
    return null
  }
}

/** Telefon: 9–15 cyfr (krótsze to zwykle daty, kody, liczby obserwujących). */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "")
  if (digits.length < 9 || digits.length > 15) return null
  if (/^(19|20)\d{2}[\s./-]?\d{1,2}[\s./-]?\d{1,2}$/.test(raw.trim())) return null // data
  return raw.trim().replace(/\s+/g, " ")
}

/** Rozbiera bio i pola kontaktowe profilu. */
export function parseBio(profile: Pick<Profile, "bio" | "externalUrl"> & Partial<Pick<Profile, "bioLinks" | "businessEmail" | "businessPhone">>): BioInfo {
  let text = profile.bio || ""

  // 1. E-maile (zwykłe i zakamuflowane) — przed wzmiankami, żeby „@domena” nie było kontem.
  const emails: string[] = []
  text = text.replace(OBFUSCATED_EMAIL_RE, (_m, user: string, domain: string) => {
    const d = domain.replace(/\s*[[({]\s*dot\s*[\])}]\s*/gi, ".").replace(/\s+/g, "")
    emails.push(`${user}@${d}`.toLowerCase())
    return " "
  })
  text = text.replace(EMAIL_RE, (m) => {
    emails.push(trimPunct(m).toLowerCase())
    return " "
  })
  if (profile.businessEmail) emails.push(profile.businessEmail.toLowerCase())

  // 2. Linki — przed telefonami i hashtagami (ścieżki URL zawierają cyfry i #).
  const links: BioLink[] = []
  const addLink = (raw: string, source: BioLink["source"]) => {
    const url = normalizeUrl(raw)
    if (url && !links.some((l) => l.url.toLowerCase() === url.toLowerCase())) links.push({ url, platform: platformOf(url), source })
  }
  text = text.replace(URL_RE, (m) => {
    addLink(m, "bio")
    return " "
  })
  if (profile.externalUrl) addLink(profile.externalUrl, "externalUrl")
  for (const l of profile.bioLinks ?? []) if (l?.url) addLink(l.url, "bioLinks")

  // 3. Wzmianki i hashtagi.
  const mentions = uniq([...text.matchAll(MENTION_RE)].map((m) => m[1].replace(/\.+$/, "").toLowerCase()))
  const hashtags = uniq([...text.matchAll(HASHTAG_RE)].map((m) => m[1].toLowerCase()))
  text = text.replace(MENTION_RE, " ").replace(HASHTAG_RE, " ")

  // 4. Telefony z pozostałego tekstu + numer konta firmowego. WhatsApp z linku wa.me też jest telefonem.
  const phones: string[] = []
  for (const m of text.matchAll(PHONE_RE)) {
    const p = normalizePhone(m[0])
    if (p) phones.push(p)
  }
  if (profile.businessPhone) phones.push(profile.businessPhone.trim())
  for (const l of links) {
    const wa = l.platform === "WhatsApp" ? new URL(l.url).pathname.match(/\/(\d{9,15})/)?.[1] : undefined
    if (wa) phones.push(`+${wa}`)
  }
  const phoneKey = (p: string) => p.replace(/\D/g, "").replace(/^00/, "").slice(-9)
  // Ten sam numer w kilku zapisach: zostaje pierwszy (tak, jak stoi w bio).
  const byKey = new Map<string, string>()
  for (const p of phones) if (!byKey.has(phoneKey(p))) byKey.set(phoneKey(p), p)
  const uniquePhones = [...byKey.values()]

  const info = { emails: uniq(emails), phones: uniquePhones, links, mentions, hashtags }
  return { ...info, empty: !info.emails.length && !info.phones.length && !info.links.length && !info.mentions.length && !info.hashtags.length }
}
