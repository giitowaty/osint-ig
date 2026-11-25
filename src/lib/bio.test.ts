import { describe, expect, it } from "vitest"

import { parseBio } from "./bio"

const bio = (text: string, extra: Partial<Parameters<typeof parseBio>[0]> = {}) => parseBio({ bio: text, externalUrl: "", ...extra })

describe("rozbiór bio", () => {
  it("typowe bio firmy: e-mail, telefon, link, wzmianka i hashtag", () => {
    const r = bio("📸 Fotograf ślubny | Kraków\n✉️ kontakt@studio-nova.pl\n☎️ +48 600 123 456\nwspółpraca: @ania.design\n#fotografiaslubna\nstudionova.pl/oferta")
    expect(r.emails).toEqual(["kontakt@studio-nova.pl"])
    expect(r.phones).toEqual(["+48 600 123 456"])
    expect(r.mentions).toEqual(["ania.design"])
    expect(r.hashtags).toEqual(["fotografiaslubna"])
    expect(r.links.map((l) => l.url)).toEqual(["https://studionova.pl/oferta"])
    expect(r.empty).toBe(false)
  })

  it("domena w adresie e-mail nie jest wzmianką ani osobnym linkiem", () => {
    const r = bio("pisz: biuro@firma.com.pl")
    expect(r.emails).toEqual(["biuro@firma.com.pl"])
    expect(r.mentions).toEqual([])
    expect(r.links).toEqual([])
  })

  it("zakamuflowane e-maile: [at] / (at) / [dot]", () => {
    expect(bio("kontakt [at] firma [dot] pl").emails).toEqual(["kontakt@firma.pl"])
    expect(bio("jan.kowalski (at) gmail.com").emails).toEqual(["jan.kowalski@gmail.com"])
  })

  it("nie myli dat, lat i liczb z telefonem", () => {
    const r = bio("od 2015 roku · 12.500 klientów · 2023-11-14 premiera · 50 000 obserwujących")
    expect(r.phones).toEqual([])
  })

  it("rozpoznaje telefony w różnych zapisach i nie dubluje tego samego numeru", () => {
    const r = bio("tel. 600-123-456 lub 0048 600 123 456; biuro (22) 123 45 67", { businessPhone: "+48600123456" })
    expect(r.phones).toEqual(["600-123-456", "(22) 123 45 67"])
  })

  it("nazwa konta z kropką bez @ nie jest uznawana za stronę WWW", () => {
    const r = bio("ania.design · kawiarnia_centrum")
    expect(r.links).toEqual([])
  })

  it("rozpoznaje platformy i łączy wszystkie źródła linków bez duplikatów", () => {
    const r = bio("👇 linktr.ee/studio_nova\nhttps://wa.me/48600123456", {
      externalUrl: "https://linktr.ee/studio_nova",
      bioLinks: [{ url: "https://www.youtube.com/@studionova", title: "YT" }],
    })
    expect(r.links).toEqual([
      { url: "https://linktr.ee/studio_nova", platform: "Linktree", source: "bio" },
      { url: "https://wa.me/48600123456", platform: "WhatsApp", source: "bio" },
      { url: "https://www.youtube.com/@studionova", platform: "YouTube", source: "bioLinks" },
    ])
    expect(r.phones).toEqual(["+48600123456"]) // numer z linku WhatsApp
    expect(r.mentions).toEqual([]) // @studionova w ścieżce URL to nie wzmianka
  })

  it("e-mail i telefon konta firmowego (przycisk Kontakt) trafiają do wyniku", () => {
    const r = bio("", { businessEmail: "Sklep@Example.com", businessPhone: "+48 500 600 700" })
    expect(r.emails).toEqual(["sklep@example.com"])
    expect(r.phones).toEqual(["+48 500 600 700"])
  })

  it("puste bio", () => {
    expect(bio("").empty).toBe(true)
    expect(bio("Kocham kawę ☕").empty).toBe(true)
  })

  it("interpunkcja na końcu nie trafia do linku, wzmianki ani e-maila", () => {
    const r = bio("Zobacz www.sklep.pl! Napisz: hej@sklep.pl. Partner: @marka_x.")
    expect(r.links[0].url).toBe("https://www.sklep.pl")
    expect(r.emails).toEqual(["hej@sklep.pl"])
    expect(r.mentions).toEqual(["marka_x"])
  })

  it("hashtagi z polskimi znakami, bez duplikatów wielkości liter", () => {
    expect(bio("#Kraków #kraków #ŚLUB").hashtags).toEqual(["kraków", "ślub"])
  })
})
