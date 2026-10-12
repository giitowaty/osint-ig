# OSINT-IG — analiza profilu Instagram

Strona do analizy pojedynczego profilu Instagram: statystyki, ostatnie posty,
podsumowanie treści oraz **szacunek płci odbiorców**. Front to czysty
HTML/CSS/JS, a dane pobiera lekki **backend-proxy w Node** (bez zależności
zewnętrznych), który obchodzi CORS i dokłada nagłówek wymagany przez Instagram.

## Funkcje

- **Statystyki**: obserwujący, obserwowani, posty, ratio (obs. ÷ obserwuje).
- **Analiza** — wnioski z danych: skala konta, interpretacja ratio, aktywność,
  orientacyjny zasięg na post, status (zweryfikowany / prywatny), bio/link.
- **Ostatnie posty** — siatka miniatur z typem (zdjęcie / wideo / karuzela)
  oraz liczbą lajków i komentarzy.
- **Podsumowanie treści** — rozkład formatów, **wskaźnik zaangażowania**
  (engagement = śr. (lajki + komentarze) ÷ obserwujący), średnie lajki,
  najczęstsze hashtagi.
- **Zakładki** — wyniki podzielone na *Przegląd* (statystyki, analiza,
  klasyfikacja), *Treści* (posty, tematyka, zainteresowania) i *Odbiorcy*
  (wydźwięk komentarzy, płeć). W PDF drukują się wszystkie naraz.
- **Klasyfikacja konta** — archetyp (fotograf, muzyk, sportowiec, marka,
  influencer, osoba prywatna…) wnioskowany z **kategorii nadanej w IG** oraz
  sygnałów (zasięg, ratio, weryfikacja, dominująca tematyka), z uzasadnieniem.
- **Tematyka treści** — dominujące kategorie postów (podróże, jedzenie, moda,
  fitness, zwierzęta, sztuka, muzyka, biznes…) wykrywane z opisów, hashtagów i
  opisów zdjęć (leksykon PL+EN).
- **Zainteresowania** — ważona chmura z tego, co konto publikuje i udostępnia:
  kategorie, konkretne hashtagi oraz **oznaczane/wzmiankowane konta** (partnerzy,
  współautorzy collab/regramów, @wzmianki). *Relacje (stories) nie są dostępne
  z publicznego API bez logowania.*
- **Wydźwięk komentarzy** — sentyment (pozytywny / neutralny / negatywny) z
  próbki podglądowych komentarzy, na bazie leksykonu słów i emoji; z ogólnym
  tonem i przykładami.
- **Płeć odbiorców (szacunek)** — patrz niżej.
- **Eksport** — kopiuj podsumowanie do schowka, pobierz JSON, drukuj do PDF.
- **Historia** — ostatnio analizowane profile (localStorage), szybkie ponowienie.
- **Tryb ręczny** — gdy pobranie zawiedzie, kafelki statystyk stają się
  edytowalne, a analiza przelicza się na żywo.

## Uruchomienie

Wymagany Node ≥ 18 (ma wbudowany `fetch`). Zero `npm install`.

```bash
npm start           # albo: node api/server.js
# otwórz http://localhost:8000
```

Serwer serwuje jednocześnie front (`index.html`, `styles.css`, `app.js`) oraz
API (`/api/profile`).

Testy logiki backendu (bez sieci):

```bash
npm test
```

## Płeć odbiorców — jak to działa i czego NIE pokazuje

**To nie jest demografia obserwujących.** Prawdziwego rozkładu płci followersów
nie da się zdobyć dla cudzego profilu — Instagram udostępnia go wyłącznie
właścicielowi konta (Insights, konto Pro/Creator, przez oficjalne Graph API z
jego tokenem).

Zamiast tego moduł robi **uczciwy szacunek**: z danych profilu bierze
**podglądową próbkę** osób komentujących i lajkujących ostatnie posty (kilka–
kilkadziesiąt nazw, bez dodatkowych zapytań do IG) i **zgaduje płeć z imienia**
w nazwie użytkownika / nazwie wyświetlanej. Osoby bez rozpoznanego imienia
trafiają do kategorii „nieokreślona". Wynik jest obarczony dużym błędem i
wyraźnie tak oznaczony w UI.

### Słownik imion

Dopasowanie korzysta ze słownika `api/names-data.json` (~24 tys. imion żeńskich
i ~30 tys. męskich, z diakrytykami i w formie ASCII). **Runtime nie ma żadnych
zależności** — ładuje tylko gotowy JSON. Słownik jest generowany skryptem
`api/build-names.mjs` z otwartych zbiorów:

- **oficjalny rejestr PESEL** (osoby żyjące, stan 2021) — autorytatywne źródło
  dla polskich imion wraz z liczbą wystąpień; pliki w `api/data/pesel/`
  (patrz [PROVENANCE](api/data/pesel/PROVENANCE.md)),
- [`gender-detection`](https://www.npmjs.com/package/gender-detection) — wielojęzyczny słownik imię→płeć,
- [`human-names`](https://www.npmjs.com/package/human-names) — imiona EN/IT/FR/DE/ES/NL,
- [`@stdlib/datasets-*-first-names-en`](https://www.npmjs.com/package/@stdlib/datasets-female-first-names-en) — angielskie (dane SSA),
- [`imieniny`](https://www.npmjs.com/package/imieniny) — polski kalendarz imienin (z heurystyką płci PL),
- kuratorski suplement najpopularniejszych polskich imion i zdrobnień.

Płeć każdego imienia rozstrzygana jest **głosowaniem** źródeł (PESEL ma
najwyższą wagę); imiona faktycznie uniseks (remis / uniseks w PESEL) są
pomijane. Dzięki PESEL poprawnie rozpoznawane są też przypadki łamiące regułę
końcówki (męskie na -a: Barnaba, Kosma; żeńskie nie na -a: Noemi, Ingrid) oraz
rzadkie imiona obce. Regeneracja:

```bash
npm install          # instaluje devDependencies (tylko do budowy słownika)
npm run build:names  # nadpisuje api/names-data.json
```

## Skąd dane / ograniczenia

- Działa dla **profili publicznych**. Prywatne nie udostępniają treści i próbki.
- Pobieranie jest **best-effort** — Instagram bywa kapryśny (limity, zmiany,
  prośba o logowanie). Przy niepowodzeniu wchodzi tryb ręczny.
- Backend chodzi bez logowania do IG. Dla większej niezawodności komentarzy /
  polubień trzeba by dołożyć sesję zalogowanego konta — świadomie tego nie
  robimy (ToS, ryzyko blokady).
- Korzystaj zgodnie z [regulaminem Instagrama](https://help.instagram.com/581066165581870)
  i obowiązującym prawem.

## Pliki

| Plik             | Rola                                             |
|------------------|--------------------------------------------------|
| `index.html`     | struktura strony                                 |
| `styles.css`     | wygląd (ciemny motyw)                             |
| `app.js`         | front: render, analiza, eksport, historia        |
| `api/server.js`     | backend-proxy + serwowanie frontu             |
| `api/content.js`    | kategorie tematyczne + wydźwięk komentarzy     |
| `api/names.js`      | heurystyka imię → płeć (ładuje słownik)       |
| `api/names-data.json` | wygenerowany słownik imion (runtime)        |
| `api/build-names.mjs` | generator słownika z otwartych zbiorów      |
| `api/data/pesel/`     | źródłowe CSV z rejestru PESEL (build-time)  |
| `api/test.js`       | testy parsowania i heurystyki (bez sieci)     |
