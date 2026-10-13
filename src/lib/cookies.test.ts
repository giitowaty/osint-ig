import { describe, expect, it } from "vitest"

import { CookieParseError, looksLikeIgCookies, parseCookieInput, toHeader } from "./cookies"

const SID = "123456%3AabcDEF%3A9%3AAYf"
const future = Math.floor(Date.now() / 1000) + 90 * 86400

/** Kodowanie identyczne z extension/popup.js. */
function extensionBundle(cookies: object[], account = "pomocnicze") {
  const json = JSON.stringify({ v: 1, source: "osint-ig-extension", account, cookies })
  return "OSINTIG1:" + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

describe("import ciasteczek", () => {
  it("paczka z rozszerzenia: konto, wygaśnięcie, nagłówek", () => {
    const b = parseCookieInput(
      extensionBundle([
        { name: "sessionid", value: SID, domain: ".instagram.com", expirationDate: future },
        { name: "csrftoken", value: "tokTOK", domain: ".instagram.com" },
        { name: "ds_user_id", value: "123456", domain: ".instagram.com" },
      ])
    )
    expect(b.format).toBe("osintig")
    expect(b.account).toBe("pomocnicze")
    expect(b.expires.sessionid).toBe(future * 1000)
    expect(toHeader(b)).toBe(`sessionid=${SID}; csrftoken=tokTOK; ds_user_id=123456`)
    expect(b.warnings).toHaveLength(0)
  })

  it("nagłówek Cookie z DevTools (z prefiksem, z obcymi ciasteczkami)", () => {
    const b = parseCookieInput(`Cookie: mid=Zz1; _ga=GA1.2; sessionid=${SID}; csrftoken=t`)
    expect(b.format).toBe("header")
    expect(Object.keys(b.cookies)).toEqual(["mid", "sessionid", "csrftoken"])
    expect(b.ignored).toEqual(["_ga"])
  })

  it("JSON z Cookie-Editor: tylko domena instagram.com", () => {
    const b = parseCookieInput(
      JSON.stringify([
        { domain: ".instagram.com", name: "sessionid", value: SID, expirationDate: future },
        { domain: ".facebook.com", name: "csrftoken", value: "fb" },
        { domain: "www.instagram.com", name: "csrftoken", value: "ig" },
      ])
    )
    expect(b.format).toBe("json")
    expect(b.cookies.csrftoken).toBe("ig")
  })

  it("cookies.txt (Netscape, z #HttpOnly_)", () => {
    const txt = [
      "# Netscape HTTP Cookie File",
      `#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t${future}\tsessionid\t${SID}`,
      `.instagram.com\tTRUE\t/\tTRUE\t${future}\tcsrftoken\tabc`,
      `.youtube.com\tTRUE\t/\tTRUE\t${future}\tSID\tnope`,
    ].join("\n")
    const b = parseCookieInput(txt)
    expect(b.format).toBe("netscape")
    expect(Object.keys(b.cookies)).toEqual(["sessionid", "csrftoken"])
  })

  it("sama wartość sessionid", () => {
    const b = parseCookieInput(SID)
    expect(b.format).toBe("sessionid")
    expect(b.warnings.some((w) => w.includes("csrftoken"))).toBe(true)
  })

  it("odrzuca: brak sessionid, wygasłe, wstrzyknięcie", () => {
    expect(() => parseCookieInput("csrftoken=a; mid=b")).toThrow(CookieParseError)
    expect(() =>
      parseCookieInput(JSON.stringify([{ domain: ".instagram.com", name: "sessionid", value: SID, expirationDate: 1000 }]))
    ).toThrow(/wygasło/)
    // Wstrzyknięta linia nagłówka nie przechodzi: nagłówek odbudowujemy tylko z białej listy.
    expect(toHeader(parseCookieInput("sessionid=abc\r\nX-Evil: 1"))).toBe("sessionid=abc")
    expect(() => parseCookieInput("sessionid=a b")).toThrow(CookieParseError)
  })

  it("ostrzega, gdy ds_user_id nie pasuje do sessionid", () => {
    const b = parseCookieInput(`sessionid=${SID}; ds_user_id=999; csrftoken=t`)
    expect(b.warnings.some((w) => w.includes("dwóch różnych kont"))).toBe(true)
  })

  it("wykrywanie przy globalnym Ctrl+V", () => {
    expect(looksLikeIgCookies(extensionBundle([{ name: "sessionid", value: SID }]))).toBe(true)
    expect(looksLikeIgCookies(`sessionid=${SID}; csrftoken=x`)).toBe(true)
    expect(looksLikeIgCookies("zwykły tekst o sessionid bez wartości")).toBe(false)
    expect(looksLikeIgCookies("@konto_a konto_b")).toBe(false)
  })
})
