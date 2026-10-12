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
- **Układ z boczną nawigacją** — wyniki podzielone na sekcje *Przegląd*
  (statystyki, analiza, klasyfikacja), *Treści* (posty, tematyka,
  zainteresowania) i *Odbiorcy* (wydźwięk komentarzy, płeć); treść w dwóch
  kolumnach dla czytelności. Na wąskich ekranach nawigacja przechodzi na górę,
  kolumny układają się jedna pod drugą; w PDF drukują się wszystkie sekcje.
- **Klasyfikacja konta** — archetyp (fotograf, muzyk, sportowiec, marka,
  influencer, osoba prywatna…) wnioskowany z **kategorii nadanej w IG** oraz
  sygnałów (zasięg, ratio, weryfikacja, dominująca tematyka), z uzasadnieniem.
- **Tematyka treści** — dominujące kategorie postów wykrywane z opisów,
  hashtagów i opisów zdjęć. Leksykon PL+EN obejmuje ~50 kategorii (m.in.
  podróże, jedzenie, kawa, moda, streetwear, uroda, wellness, fitness,
  bieganie, joga, rowery, sporty walki, piłka nożna, narty, wspinaczka, góry,
  natura, rośliny, zwierzęta, fotografia, sztuka, tatuaże, muzyka, taniec, film,
  książki, gry, tech/AI, krypto, nauka, historia, biznes, nieruchomości,
  wnętrza, DIY, rodzina, motoryzacja, motorsport, lotnictwo, żeglarstwo,
  religia, edukacja, anime, k-pop, imprezy, śluby, memy). Pokazywane są
  **tylko kategorie faktycznie obecne** na profilu — bez pustych pasków.
- **Zainteresowania** — ranking (słupki + udziały %) z tego, co konto publikuje
  i udostępnia: kategorie, konkretne hashtagi oraz **oznaczane/wzmiankowane
  konta** (partnerzy, współautorzy collab/regramów, @wzmianki), z kolorowym
  oznaczeniem rodzaju. *Relacje (stories) nie są dostępne z publicznego API bez
  logowania.*
- **Wydźwięk komentarzy** — sentyment (pozytywny / neutralny / negatywny) z
  próbki podglądowych komentarzy, na bazie leksykonu słów i emoji; z ogólnym
  tonem i przykładami.
- **Płeć odbiorców (szacunek)** — patrz niżej.
- **Sieć powiązań** (zakładka *Sieć*, `network.js`) — jedna wspólna lista kont
  zasila dwa widoki przełączane jednym kliknięciem:
  - **Graf** — interaktywna mapa sieci (SVG, własna symulacja sił); krawędzie to
    oznaczenia/współautorstwo/@wzmianki oraz ręcznie wczytane listy
    obserwujących/obserwowanych z rozróżnieniem kierunku (niebieskie „obserwuje →”,
    zielone „obserwujący →”). Węzły można przeciągać.
  - **Bąbelki** — pakowane koła powiązanych kont; wielkość = liczba wystąpień.

  Konto wskazywane przez ≥2 profile jest w obu widokach wyróżnione jako
  **wspólne (pośrednie) powiązanie**. **Panel sterowania** nad widokiem pozwala
  jednym przyciskiem **pobrać listy obserwujących/obserwowanych wszystkich kont
  z sesji IG** (patrz niżej) albo wkleić/pobrać listę dla pojedynczego konta.
- **Auto-pobieranie listy przez sesję IG (opcjonalne)** — w panelu wklejania
  możesz podać własny `sessionid` (cookie z Twojej zalogowanej przeglądarki);
  wtedy przycisk „⤓ Pobierz z sesji IG” automatycznie zaciąga listę
  obserwujących/obserwowanych wybranego konta (backend `/api/list`, paginacja z
  opóźnieniami). Cookie trzymane jest **tylko w Twoim `localStorage`**
  (`session.js`), wysyłane do backendu nagłówkiem `x-ig-session` wyłącznie na
  czas zapytania i **nigdzie nie zapisywane**. ⚠ To scraping przez zalogowaną
  sesję — przeciw ToS IG i **może skutkować blokadą konta**; panel wyświetla
  wyraźne ostrzeżenie, by **nie używać głównego konta**, tylko osobnego „do zadań
  specjalnych”. Po zapisaniu cookie aplikacja weryfikuje sesję (`/api/whoami`) i
  **pokazuje, z jakiego konta korzysta** („Zalogowano jako @…”). Nie obsługujemy
  logowania loginem/hasłem (ryzyko, 2FA) — tylko cookie sesji.
- **Zbieracz listy (bookmarklet)** — alternatywa bez podawania cookie do
  narzędzia: przeciągany bookmarklet (`collector.js`), który uruchamiasz **sam,
  we własnej przeglądarce**, na otwartej liście obserwujących: przewija ją,
  zbiera nazwy i kopiuje do schowka (nic nie trafia na serwer).
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
| `network.js`     | zakładka Sieć: graf + bąbelki + panel sterowania  |
| `collector.js`   | bookmarklet zbierający listę kont w przeglądarce  |
| `session.js`     | opcjonalna sesja IG (cookie) do auto-pobierania    |
| `api/server.js`     | backend-proxy + serwowanie frontu             |
| `api/content.js`    | kategorie tematyczne + wydźwięk komentarzy     |
| `api/names.js`      | heurystyka imię → płeć (ładuje słownik)       |
| `api/names-data.json` | wygenerowany słownik imion (runtime)        |
| `api/build-names.mjs` | generator słownika z otwartych zbiorów      |
| `api/data/pesel/`     | źródłowe CSV z rejestru PESEL (build-time)  |
| `api/test.js`       | testy parsowania i heurystyki (bez sieci)     |
