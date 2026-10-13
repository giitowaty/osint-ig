/* ----------------------------------------------------------------------------
 * Import ciasteczek Instagrama w dowolnym popularnym formacie:
 *  • paczka z rozszerzenia OSINT-IG ("OSINTIG1:…"),
 *  • nagłówek "Cookie: a=b; c=d" (np. z DevTools → Network),
 *  • JSON z Cookie-Editor / EditThisCookie / Puppeteer (tablica {name, value, domain, expirationDate}),
 *  • cookies.txt (format Netscape, np. z yt-dlp / „Get cookies.txt”),
 *  • sama wartość sessionid.
 * Zostają tylko ciasteczka instagram.com z białej listy (jak na serwerze).
 * -------------------------------------------------------------------------- */

export const ALLOWED = [
  "sessionid", "ds_user_id", "csrftoken", "mid", "ig_did", "ig_nrcb", "rur", "datr", "shbid", "shbts", "wd", "dpr",
] as const

const VALUE_RE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E"\\]{1,1024}$/

export type CookieFormat = "osintig" | "header" | "json" | "netscape" | "sessionid"

export const FORMAT_LABEL: Record<CookieFormat, string> = {
  osintig: "paczka z rozszerzenia OSINT-IG",
  header: "nagłówek Cookie",
  json: "JSON (Cookie-Editor / EditThisCookie)",
  netscape: "cookies.txt (Netscape)",
  sessionid: "sama wartość sessionid",
}

export interface CookieBundle {
  cookies: Record<string, string>
  /** Wygaśnięcie w ms (gdy format je podaje). */
  expires: Record<string, number>
  format: CookieFormat
  account?: string
  ignored: string[]
  warnings: string[]
}

export class CookieParseError extends Error {}

function isIgDomain(d: unknown) {
  return typeof d !== "string" || d === "" || /(^|\.)instagram\.com$/i.test(d.replace(/^\./, ""))
}

function add(b: CookieBundle, name: string, value: string, exp?: number) {
  const n = name.trim()
  const v = value.trim().replace(/^"(.*)"$/, "$1")
  if (!(ALLOWED as readonly string[]).includes(n)) {
    if (n && !b.ignored.includes(n)) b.ignored.push(n)
    return
  }
  if (!VALUE_RE.test(v)) throw new CookieParseError(`Ciasteczko ${n} ma niedozwolone znaki (spacje, średnik albo znaki sterujące).`)
  b.cookies[n] = v
  if (exp && Number.isFinite(exp)) b.expires[n] = exp < 1e12 ? exp * 1000 : exp
}

function fromJson(b: CookieBundle, data: unknown) {
  const list: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { cookies?: unknown[] }).cookies)
      ? (data as { cookies: unknown[] }).cookies
      : []
  if (list.length) {
    for (const c of list) {
      if (!c || typeof c !== "object") continue
      const o = c as Record<string, unknown>
      if (!isIgDomain(o.domain)) continue
      add(b, String(o.name ?? ""), String(o.value ?? ""), Number(o.expirationDate ?? o.expires ?? o.expiry) || undefined)
    }
    return
  }
  // Prosta mapa {"sessionid": "...", "csrftoken": "..."}
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) if (typeof v === "string") add(b, k, v)
  }
}

export function parseCookieInput(input: string): CookieBundle {
  const text = input.trim()
  if (!text) throw new CookieParseError("Pusto: wklej ciasteczka albo przeciągnij plik.")
  const b: CookieBundle = { cookies: {}, expires: {}, format: "header", ignored: [], warnings: [] }

  if (/^OSINTIG1:/.test(text)) {
    b.format = "osintig"
    let json: { account?: string; cookies?: unknown[] }
    try {
      const b64 = text.slice(9).replace(/-/g, "+").replace(/_/g, "/")
      json = JSON.parse(decodeURIComponent(escape(atob(b64))))
    } catch {
      throw new CookieParseError("Paczka z rozszerzenia jest uszkodzona (skopiuj ją ponownie).")
    }
    b.account = json.account
    fromJson(b, json.cookies ?? [])
  } else if (/^[[{]/.test(text)) {
    b.format = "json"
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch (e) {
      throw new CookieParseError(`To wygląda na JSON, ale się nie parsuje: ${e instanceof Error ? e.message : e}`)
    }
    fromJson(b, data)
  } else if (/\t/.test(text) || /^# (Netscape )?HTTP Cookie File/im.test(text)) {
    b.format = "netscape"
    for (const line of text.split(/\r?\n/)) {
      const l = line.replace(/^#HttpOnly_/, "")
      if (!l.trim() || l.startsWith("#")) continue
      const f = l.split("\t")
      if (f.length < 7) continue
      if (!isIgDomain(f[0])) continue
      add(b, f[5], f.slice(6).join("\t"), Number(f[4]) || undefined)
    }
  } else if (text.includes("=")) {
    b.format = "header"
    const body = text.replace(/^cookie:\s*/i, "")
    for (const part of body.split(/;\s*|\r?\n/)) {
      const eq = part.indexOf("=")
      if (eq > 0) add(b, part.slice(0, eq), part.slice(eq + 1))
    }
  } else {
    b.format = "sessionid"
    add(b, "sessionid", text)
  }

  if (!b.cookies.sessionid) {
    throw new CookieParseError(
      Object.keys(b.cookies).length || b.ignored.length
        ? "Nie ma wśród nich sessionid. Wyeksportuj ciasteczka z karty, na której jesteś zalogowany na instagram.com."
        : "Nie rozpoznano żadnych ciasteczek Instagrama w tym tekście."
    )
  }
  const now = Date.now()
  const exp = b.expires.sessionid
  if (exp && exp < now) throw new CookieParseError(`Ciasteczko sessionid wygasło ${new Date(exp).toLocaleString("pl-PL")}. Zaloguj się ponownie na IG i wyeksportuj świeże.`)
  if (exp && exp - now < 7 * 86_400_000) b.warnings.push(`sessionid wygasa ${new Date(exp).toLocaleDateString("pl-PL")}: niedługo trzeba będzie odświeżyć ciasteczka.`)
  if (!b.cookies.csrftoken) b.warnings.push("Brak csrftoken: część zapytań (np. listy) może być odrzucana.")
  const sidUser = decodeURIComponent(b.cookies.sessionid).split(":")[0]
  if (b.cookies.ds_user_id && /^\d+$/.test(sidUser) && sidUser !== b.cookies.ds_user_id) {
    b.warnings.push("ds_user_id nie pasuje do sessionid: ciasteczka mogą pochodzić z dwóch różnych kont.")
  }
  if (b.ignored.length) b.warnings.push(`Pominięto ${b.ignored.length} ciasteczek spoza Instagrama lub zbędnych (${b.ignored.slice(0, 4).join(", ")}${b.ignored.length > 4 ? "…" : ""}).`)
  return b
}

export function toHeader(b: Pick<CookieBundle, "cookies">): string {
  return Object.entries(b.cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
}

export function mask(v: string): string {
  return v.length <= 10 ? "•".repeat(v.length) : `${v.slice(0, 4)}…${v.slice(-3)}`
}

/** Szybkie sprawdzenie, czy wklejony tekst to (prawdopodobnie) ciasteczka IG — do globalnego wklejania. */
export function looksLikeIgCookies(text: string): boolean {
  const t = text.trim()
  return /^OSINTIG1:/.test(t) || (/sessionid/.test(t) && (/instagram\.com/i.test(t) || /=|\t|"name"/.test(t)))
}
