# OSINT-IG — przegląd projektu (co mamy, co działa, jak działa)

Dokument-ściąga opisujący cały stan narzędzia. Szczegóły funkcji są w `README.md`.

---

## 1. Co to jest i jak odpalić

Narzędzie do **analizy profilu Instagram i mapowania powiązań między kontami**.
Front to **React + TypeScript + Vite** (shadcn/ui), ten sam w przeglądarce i w
aplikacji desktopowej **Tauri**. Dane dostarcza lekki **backend-proxy w Node**
(bez zależności w runtime), w Tauri uruchamiany jako sidecar.

```bash
npm install          # jednorazowo
npm run dev          # API :8000 + Vite :5173 (HMR) → http://127.0.0.1:5173
npm run serve        # build + serwer → http://localhost:8000
npm test             # backend (bez sieci) + bezpieczeństwo serwera + vitest
npm run desktop:dev  # aplikacja desktopowa (wymaga Rusta)
```

Wymagania: **Node ≥ 20**. Moduł Pythona `social_analytics` (osobny dashboard
FastAPI) wymaga `pip install -r social_analytics/requirements.txt`.

---

## 2. Architektura

```
src/               – front React: widoki (src/views), komponenty, logika (src/lib)
  lib/actions.ts   – analiza, kolejka kont, pula sesji, import z Firefoksa
  lib/store.ts     – stan aplikacji + pula kont (routing: jedno konto na profil)
  lib/graph.ts     – graf powiązań, centralności, społeczności
  lib/persist.ts   – zapis sesji badawczej i checkpointów kolejki (IndexedDB)
api/server.js      – backend: proxy do IG, SSE z krokami, serwowanie dist/
api/instagram.js   – zapytania do IG, cooldown per konto, losowe tempo list
api/normalize.js   – normalizacja profilu/postów, powiązania, szacunek płci
api/content.js     – kategorie treści, wydźwięk, zainteresowania
api/firefox-cookies.js – odczyt sesji IG z lokalnego profilu Firefoksa
api/extension-bridge.js – lokalny most z rozszerzeniem przeglądarki
extension/         – rozszerzenie Chrome/Edge (MV3)
src-tauri/         – powłoka desktopowa (Rust)
social_analytics/  – moduł Pythona: graf, NLP, metryki, eksport Neo4j, dashboard
```

**Zasada:** backend serwuje i front, i API z jednego procesu/portu. Przyjmuje
tylko nagłówek `Host` wskazujący na ten komputer i odrzuca zapytania z obcych
stron (ochrona przed DNS rebinding i CSRF).

### Endpointy API
| Endpoint | Rola |
|----------|------|
| `GET /api/profile?username=` | profil + posty + powiązania + analiza treści (SSE z `stream=1`) |
| `GET /api/whoami` (nagłówek `x-ig-session`/`x-ig-cookies`) | weryfikuje sesję, zwraca zalogowane konto |
| `GET /api/list?username=&type=followers\|following` | lista przez sesję IG (paginacja, losowe pauzy) |
| `GET /api/followers/page?username=&userId=` | jedna strona obserwujących (kolejka z checkpointami) |
| `GET /api/import/firefox` | sesja IG z lokalnego Firefoksa (tylko z tego komputera) |
| `GET /api/img?url=` | proxy miniatur z CDN IG |
| `GET /api/health`, `/api/cooldown/reset`, `/api/cache/clear` | stan silnika, blokada, pamięć podręczna |

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
2. **Bookmarklet** (`src/lib/collector.ts`) — przeciągany przycisk, uruchamiasz na
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
| Front (wszystkie widoki), kolejka, pula kont, eksport, zapis IndexedDB | ✅ testy vitest (33) + uruchomienie w przeglądarce |
| Backend: parsowanie, analiza treści, słownik, ciasteczka, fallback GraphQL | ✅ testy (54 + 4 + 6 + 8) na mockach IG |
| Bezpieczeństwo serwera (Host, Origin, import z Firefoksa) | ✅ testy `api/server-security.check.cjs` |
| Moduł Pythona `social_analytics` | ✅ 58 testów (z `networkx`); bez niego testy grafu są pomijane |
| Typecheck (`tsc -b`), lint (`eslint`), build produkcyjny | ✅ czyste |
| Pobieranie z żywego Instagrama (`/api/profile`, listy, `whoami`) | 🟡 do sprawdzenia u Ciebie — środowisko dev nie ma dostępu do IG |
| Rozszerzenie w prawdziwym Chrome, import z Firefoksa na Twoim PC | 🟡 kod i testy OK, nie odpalone na żywo |

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

- Test end-to-end z żywym Instagramem na osobnym koncie i aktualizacja
  identyfikatorów zapytań GraphQL (`doc_id`), gdy IG je zmieni.
- Podział paczki frontu (ok. 1,2 MB JS w jednym pliku) — leniwe ładowanie widoków
  grafu, wpływu i porównania przyspieszy start.
- Suwak opóźnienia/limitu w panelu kolejki i krótka notka opsec przy starcie.
- Przycisk w rozszerzeniu „wyślij prosto do OSINT-IG” (bez kopiuj-wklej).
- Eksport grafu do PNG/SVG.
- Integracja Graph API dla własnych kont (jedyna „czysta” droga do followersów).
- Test jednostkowy kolejki (`runQueue`): anulowanie, limit 429, wznowienie.
