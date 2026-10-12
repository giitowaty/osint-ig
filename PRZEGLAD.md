# OSINT-IG — przegląd projektu (co mamy, co działa, jak działa)

Dokument-ściąga opisujący cały stan narzędzia. Szczegóły funkcji są w `README.md`.

---

## 1. Co to jest i jak odpalić

Narzędzie do **analizy profilu Instagram i mapowania powiązań między kontami**.
Front to czysty HTML/CSS/JS, dane dostarcza lekki **backend-proxy w Node** (bez
zależności w runtime).

```bash
npm start        # = node api/server.js  → http://localhost:8000
npm test         # 54 testy (bez sieci)
npm run build:names   # regeneracja słownika imion (wymaga devDependencies)
```

Wymagania: **Node ≥ 18** (wbudowany `fetch`). Zwykłe użycie nie wymaga
`npm install` — runtime nie ma zależności.

---

## 2. Architektura

```
index.html        – struktura + ładowanie skryptów
styles.css        – wygląd (ciemny motyw)
app.js            – front: analiza profilu, zakładki, render, eksport, historia
network.js        – zakładka „Sieć”: graf + bąbelki + panel sterowania
collector.js      – bookmarklet zbierający listę kont w przeglądarce
session.js        – opcjonalna sesja IG (cookie) do auto-pobierania
api/server.js     – backend: proxy do IG + serwowanie frontu + API
api/content.js    – kategorie treści, wydźwięk, zainteresowania, klasyfikacja
api/names.js      – heurystyka imię→płeć (ładuje słownik)
api/names-data.json   – wygenerowany słownik imion (runtime)
api/build-names.mjs   – generator słownika z otwartych zbiorów
api/data/pesel/       – źródłowe CSV z rejestru PESEL (build-time)
api/test.js       – testy (bez sieci)
extension/        – rozszerzenie Chrome/Edge (MV3) działające w sesji IG
```

**Zasada:** backend serwuje i front, i API z jednego procesu/portu. Runtime
ładuje tylko gotowe pliki — paczki npm są wyłącznie devDependencies do budowy
słownika imion.

### Endpointy API
| Endpoint | Rola |
|----------|------|
| `GET /api/profile?username=` | pobiera i normalizuje profil + posty + powiązania + analizę treści |
| `GET /api/whoami` (nagłówek `x-ig-session`) | weryfikuje cookie sesji, zwraca zalogowane konto |
| `GET /api/list?username=&type=followers\|following` (nagłówek `x-ig-session`) | pobiera listę obserwujących/obserwowanych przez sesję IG (paginacja, opóźnienia) |

---

## 3. Funkcje i jak działają

### Zakładka „Przegląd”
- **Statystyki** (obserwujący / obserwowani / posty / ratio) z `web_profile_info`.
- **Analiza** — wnioski heurystyczne: skala konta, interpretacja ratio,
  aktywność, zasięg na post, status (zweryfikowany/prywatny), bio/link.
- **Klasyfikacja konta** — archetyp (fotograf, muzyk, marka, influencer, osoba
  prywatna…) z **kategorii nadanej przez IG** + sygnałów (zasięg, ratio,
  weryfikacja, tematyka). Kategoria IG to sygnał autorytatywny.

### Zakładka „Treści”
- **Ostatnie posty** — miniatury z typem i licznikami ♥/💬.
- **Podsumowanie** — formaty, **engagement** = śr.(lajki+komentarze)÷obserwujący,
  śr. lajki, top hashtagi.
- **Tematyka** — ~50 kategorii wykrywanych z opisów/hashtagów/alt-textów
  (leksykon PL+EN). Pokazywane tylko kategorie faktycznie obecne.
- **Zainteresowania** — ranking (słupki + %) z kategorii, hashtagów i
  **oznaczanych/wzmiankowanych kont** (collaby, @wzmianki).

### Zakładka „Odbiorcy”
- **Wydźwięk komentarzy** — sentyment (poz./neutr./neg.) z próbki podglądowych
  komentarzy, leksykon słów + emoji; ogólny ton + przykłady.
- **Płeć odbiorców (szacunek)** — z próbki komentujących/lajkujących, zgadywanie
  płci z imienia. **Nie jest to demografia obserwujących** (tego IG nie udostępnia)
  — jawnie oznaczone jako szacunek.

### Zakładka „Sieć” (graf + bąbelki)
- Jedna wspólna lista kont, przełącznik **Graf ⇄ Bąbelki**.
- **Graf** — mapa sieci (SVG, własna symulacja sił), węzły przeciągalne.
  Krawędzie: publiczne powiązania (szare) + ręczne/pobrane listy z kierunkiem
  (niebieskie „obserwuje →”, zielone „obserwujący →”).
- **Bąbelki** — pakowane koła; wielkość = liczba wystąpień.
- Konto wskazywane przez **≥2 profile** jest wyróżnione (wspólne powiązanie).
- **Panel sterowania**: „Pobierz listy wszystkich kont z sesji IG” (batch),
  ręczne wklejanie/pobieranie per konto, oraz przełącznik
  „Auto-pobieraj listy przy dodaniu konta”.

### Wspólne
- **Eksport** — Kopiuj (schowek), JSON, Drukuj/PDF (drukuje wszystkie sekcje).
- **Historia** — ostatnie profile w localStorage.
- **Tryb ręczny** — gdy pobranie padnie, kafelki są edytowalne, analiza liczy się
  na żywo.

---

## 4. Skąd dane i jak zdobywamy listy (kluczowe!)

Instagram **publicznie nie udostępnia list obserwujących/obserwowanych** — tylko
liczby. Dlatego są trzy drogi zdobycia list, w kolejności od najbezpieczniejszej:

1. **Rozszerzenie przeglądarki** (`extension/`) — działa w Twojej zalogowanej
   sesji, Twoim IP; pobiera listę i kopiuje do schowka, kopiuje też `sessionid`.
   Najbezpieczniejsze dla IP/konta (wygląda jak normalne użycie).
2. **Bookmarklet** (`collector.js`) — przeciągany przycisk, uruchamiasz na
   stronie listy obserwujących; przewija i kopiuje nazwy. Też Twoja sesja/IP.
3. **Backend `/api/list` z cookie sesji** — wklejasz `sessionid`, backend sam
   pobiera listy (także batch dla wszystkich kont). Wygodne, ale zapytania idą
   z IP serwera — **odpalaj lokalnie, nie na VPS**.

Co robi skrypt sam: po jednorazowym podaniu sesji **backend pobiera listy
automatycznie**. Czego nie zrobi: samo **zdobycie** cookie (jest chronione w
przeglądarce) — ten jeden krok zawsze jest „Twój”.

---

## 5. Słownik imion (płeć)

`api/names-data.json` (~24 tys. żeńskich + ~30 tys. męskich) generowany przez
`api/build-names.mjs` z: **rejestru PESEL** (osoby żyjące, `api/data/pesel/`),
`gender-detection`, `human-names`, `@stdlib`, `imieniny` + suplement PL. Płeć
rozstrzygana głosowaniem źródeł (PESEL najwyższa waga). Runtime ładuje tylko JSON.

---

## 6. Status weryfikacji

| Element | Status |
|---------|--------|
| Front, zakładki, render, eksport, historia, sieć (graf/bąbelki) | ✅ zweryfikowane (zrzuty + testy) |
| Logika backendu: parsowanie, słownik, analiza treści, powiązania | ✅ testy (54) |
| Słownik imion / PESEL | ✅ zweryfikowane |
| `/api/profile` pobieranie z żywego IG | 🟡 niesprawdzone w sandboxie (IG nieosiągalny) — u Ciebie powinno działać |
| `/api/list`, `/api/whoami` z żywym IG | 🟡 hydraulika sprawdzona na mockach, realny IG do testu u Ciebie |
| Rozszerzenie (`extension/`) w prawdziwym Chrome | 🟡 składnia/manifest OK, nie odpalone na żywo |
| Bookmarklet na żywej stronie IG | 🟡 kod OK, selektory DOM IG bywają zmienne |

🟡 = środowisko dev nie ma dostępu do Instagrama, więc testów end-to-end z żywym
IG nie dało się wykonać tutaj.

---

## 7. Ograniczenia i ryzyka

- **Listy followersów / relacje (stories)** — publicznie niedostępne bez
  logowania; stąd tryb sesji / rozszerzenie / bookmarklet.
- **Scraping przez sesję** — przeciw ToS Instagrama; **może skutkować blokadą
  konta**. Używaj osobnego konta „do zadań specjalnych”, nie głównego.
- **IP** — z rozszerzenia/bookmarkletu (Twoje IP) ryzyko minimalne; backend na
  obcym VPS z Twoim `sessionid` = sygnał do flagowania. Odpalaj backend lokalnie.
- **Analizy heurystyczne** (płeć, sentyment, tematyka) to **szacunki** z małych
  próbek — nie traktować jak twardych danych.
- Instagram zmienia API/DOM — pobieranie jest **best-effort**.

---

## 8. Pomysły na dalej (niezrobione)

- Notka opsec i suwak opóźnienia/limitu w panelu sterowania.
- Przycisk w rozszerzeniu „wyślij prosto do OSINT-IG” (bez kopiuj-wklej).
- Eksport grafu/bąbli do PNG.
- Integracja Graph API dla kont własnych (jedyna „czysta” droga do followersów).
