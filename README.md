# OSINT-IG — analiza profili Instagram i mapa powiązań

Narzędzie badawcze do analizy publicznych profili Instagram i powiązań między
kontami. Działa jako **aplikacja web** (Vite + React + TypeScript + shadcn/ui,
styl Sera) oraz **aplikacja desktop** (Tauri 2) z wbudowanym silnikiem. Dane
pobiera lokalny **backend w Node bez zależności runtime**, który obchodzi CORS,
dokłada nagłówki wymagane przez Instagram i strumieniuje postęp na żywo.

## Nowe w 0.5

- **Sesja zapisywana lokalnie** (IndexedDB): profile, listy, notatki i tagi wracają po odświeżeniu i restarcie.
  Import i eksport całej sesji w *Narzędziach*.
- **Kolejka wielu kont** (`Ctrl Shift K`): wklejasz listę, analiza idzie po kolei z pauzą (±30% rozrzutu),
  a przy limicie IG kolejka sama czeka i wznawia.
- **Ochrona przed limitem**: po odpowiedzi 429 serwer przez 60 s → 2 → 5 → 10 min nie pyta IG
  (każde kolejne zapytanie przedłuża blokadę). Stan i ręczne zdjęcie blokady w *Aktywności*.
- **Pamięć podręczna serwera** (15 min): ponowne otwarcie profilu nie pyta IG; *Odśwież* pobiera na nowo.
- **Porównanie profili**: metryki obok siebie, wykres zaangażowania, macierz wspólnych powiązań par.
- **Eksport sieci**: PNG, CSV (węzły + krawędzie), GEXF (Gephi), Cypher (Neo4j), JSON node-link.
- **Rytm publikacji**: mapa dzień tygodnia × godzina.
- **Notatki badawcze i tagi** przy każdym profilu (widoczne w sidebarze i porównaniu).

## Nowe w 0.4

- Przebudowa na React + shadcn/ui, układ na cały ekran z sidebarem i paletą poleceń (`Ctrl K`).
- **Podgląd na żywo** (`Ctrl J`): każdy krok zadania (zapytanie do IG, normalizacja, analiza) z czasem i wynikiem.
- **Szczegółowe błędy**: kod, etap, podpowiedź, odpowiedź IG (status, nagłówki, treść), przebieg zadania, kopiowanie diagnostyki.
- **Graf powiązań** na canvasie (fizyka na żywo, zoom, przeciąganie, inspektor) dla wszystkich profili w sesji.
- **Wpływ i centralność**: PageRank, pośredniość, stopień, wektor własny, ranking hubów i mostów (port z `social_analytics`).
- Desktop: Tauri + silnik Node jako sidecar (jeden plik SEA), instalatory MSI/NSIS.

## Funkcje (analiza profilu)

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
- **Rozszerzenie przeglądarki** (`extension/`, Chrome/Edge, Manifest V3) — działa
  bezpośrednio w Twojej **zalogowanej sesji IG**: pokazuje konto, pobiera listę
  obserwujących/obserwowanych dowolnego profilu i kopiuje do schowka, a także
  kopiuje `sessionid` jednym kliknięciem. Zapytania idą tylko z Twojej
  przeglądarki do IG — nic nie trafia na zewnętrzny serwer. Instalacja i uwagi:
  `extension/README.md`. ⚠ To scraping — nie używaj głównego konta.
- **Eksport** — kopiuj podsumowanie do schowka, pobierz JSON, drukuj do PDF.
- **Historia** — ostatnio analizowane profile (localStorage), szybkie ponowienie.
- **Tryb ręczny** — gdy pobranie zawiedzie, kafelki statystyk stają się
  edytowalne, a analiza przelicza się na żywo.

## Uruchomienie

Wymagany **Node ≥ 20**. Desktop wymaga dodatkowo **Rust** (rustup) i, na Windows, WebView2 (jest w Windows 11).

```bash
npm install            # jednorazowo
npm run dev            # serwer API :8000 + Vite :5173 (HMR) → http://127.0.0.1:5173
npm run serve          # produkcja web: build + serwer → http://localhost:8000
npm run desktop:dev    # aplikacja desktop w trybie deweloperskim
npm run desktop:build  # instalatory → src-tauri/target/release/bundle/{msi,nsis}
npm run build:exe      # pełny proces: testy + build + test .exe + release/ (lub dwuklik build-exe.bat)
npm test               # testy backendu (bez sieci) + vitest (graf, eksport)
```

Launchery `start-windows.bat` / `start-macos.command` / `start-linux.sh` przy pierwszym
uruchomieniu same instalują zależności (bez skryptów instalacyjnych) i budują front.

Serwer słucha tylko na `127.0.0.1` (zmienne: `PORT`, `HOST`, `OSINT_CACHE_TTL_MS`,
`OSINT_IG_TIMEOUT_MS`, `OSINT_ALLOWED_ORIGINS`).

### Endpointy API

Analiza z połączoną sesją pobiera profil i 12 postów aktualnymi zapytaniami web GraphQL.
Nie używa blokowanego `web_profile_info` dla zalogowanych kont. Rzeczywiste limity 429
nadal zatrzymują zapytania. Komentarze i demografia są dostępne wyłącznie, gdy odpowiedź
zawiera odpowiednią próbkę; aplikacja nie tworzy ich z brakujących danych.

| Endpoint | Rola |
|----------|------|
| `GET /api/profile?username=[&fresh=1][&stream=1]` | analiza profilu; `stream=1` → SSE z krokami na żywo |
| `GET /api/list?username=&type=followers\|following` | lista przez sesję IG (nagłówek `x-ig-session`) |
| `GET /api/whoami` | weryfikacja cookie sesji |
| `GET /api/img?url=` | proxy miniatur (tylko CDN IG) |
| `GET /api/health` | stan silnika, blokada IG, pamięć podręczna |
| `GET /api/cooldown/reset`, `GET /api/cache/clear` | ręczne zdjęcie blokady / wyczyszczenie pamięci |

## Automatyczna analiza obserwujących

Otwórz publiczny profil w aplikacji i kliknij **Analizuj obserwujących**.
Wybierz **Wszyscy dostępni** albo liczbę kont i uruchom analizę. Aplikacja pobiera
kolejne strony obserwujących i analizuje konta po kolei, z ustawioną pauzą.
Wyniki trafiają do sesji i grafu; gotowe profile i duplikaty są pomijane.

Kolejkę można wstrzymać, wznowić lub wyczyścić. Jej postęp i kursor listy zapisują
się lokalnie; po restarcie kliknij **Wznów**. Po 429 aplikacja czeka, a po utracie
sesji zatrzymuje pracę. Prywatne konta mają analizę dostępnych danych profilu,
bez postów, których sesja nie może zobaczyć. Analiza nie uruchamia kolejnych
analiz obserwujących znalezionych kont.

Instagram może ograniczyć widoczną listę niezależnie od liczby obserwujących.
Panel oznacza taki wynik jako częściowy; **Wszyscy dostępni** obejmuje konta,
które Instagram rzeczywiście udostępnił połączonej sesji.

## Podłączenie konta Instagram (ciasteczka)

Zakładka **Sesja IG → Połącz konto**. Najprościej:

1. Zainstaluj rozszerzenie z folderu `extension/` (chrome://extensions lub edge://extensions → tryb dewelopera → „Załaduj rozpakowane”).
2. Zaloguj się na instagram.com na **koncie pomocniczym** (nie głównym: to scraping, grozi blokadą).
3. Uruchom aktualną aplikację OSINT-IG. Kliknij ikonę rozszerzenia → **„Połącz z aplikacją OSINT-IG”**.
4. Aplikacja automatycznie odbierze sesję i sprawdzi konto. Wtyczka potwierdzi połączenie po udanej weryfikacji.

Po aktualizacji odśwież rozszerzenie w chrome://extensions / edge://extensions.
Połączenie korzysta z lokalnego portu `17654`; uruchom tylko jedną instancję aplikacji.
Ręczny import przez schowek nadal jest dostępny.

Działa też bez rozszerzenia (zakładki **Wklej** i **Plik**): nagłówek `Cookie:` z DevTools, JSON z Cookie-Editor /
EditThisCookie, plik `cookies.txt` (Netscape) albo sama wartość `sessionid`. Format rozpoznaje się sam; zostają tylko
ciasteczka instagram.com z białej listy (`sessionid`, `csrftoken`, `ds_user_id`, `mid`, …), a token CSRF trafia do
nagłówka zapytań jak w przeglądarce.

Ciasteczka leżą tylko na tym urządzeniu (localStorage / magazyn aplikacji), nie trafiają do zapisu sesji ani eksportów,
serwer ich nie zapisuje ani nie loguje (w diagnostyce widać wyłącznie nazwy). „Odłącz i usuń” kasuje je od razu.

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

| Ścieżka | Rola |
|---------|------|
| `src/App.tsx`, `src/views/` | powłoka aplikacji i widoki (przegląd, treści, odbiorcy, graf, wpływ, porównanie, aktywność, sesja, narzędzia) |
| `src/components/` | sidebar, dok aktywności, panel błędu, graf (canvas), kolejka, notatki, mapa publikacji; `ui/` = shadcn |
| `src/lib/api.ts` | klient API: strumień SSE przez fetch, błędy z diagnostyką |
| `src/lib/store.ts`, `actions.ts` | stan aplikacji, zadania, log, kolejka |
| `src/lib/persist.ts` | zapis sesji w IndexedDB, import |
| `src/lib/graph.ts` | model sieci + centralności i ranking wpływu |
| `src/lib/exporters.ts` | CSV, GEXF, Cypher, JSON node-link |
| `api/server.js` | routing, SSE, cache, proxy obrazków, statyczny front |
| `api/instagram.js` | zapytania do IG z diagnostyką i ochroną przed limitem |
| `api/errors.js`, `api/trace.js` | ustrukturyzowane błędy i kroki zadań |
| `api/normalize.js`, `api/content.js`, `api/names.js` | normalizacja, tematyka/wydźwięk, heurystyka płci |
| `src-tauri/` | powłoka desktop (Rust): start sidecara, log silnika do UI |
| `scripts/` | `dev.mjs`, `build-sidecar.mjs` (Node SEA), `make-icon.mjs` |
| `extension/` | rozszerzenie Chrome/Edge (MV3) |
| `social_analytics/` | moduł Python (dashboard :8100), funkcje grafu przeniesione do aplikacji |


### Duże zbiory kont

- W kolejce można wkleić nazwy albo użyć **Importuj konta z TXT / CSV** (do 32 MB). Plik zawiera jedną nazwę lub link IG na wiersz, bez nagłówka. Gotowe wyniki i duplikaty są pomijane.
- Kolejka i lista zapisanych profili pokazują po 50 pozycji na stronie. Pasek boczny pozwala wyszukiwać po nazwie konta, nazwie profilu lub tagu oraz filtrować po stanie analizy. Paleta Ctrl K pokazuje do 50 pasujących kont.
- Profil i checkpoint kolejki są zapisywane razem w IndexedDB. Zapis przyrostowy dotyczy tylko zmienionych profili; po każdym ukończonym koncie kolejka czeka na zatwierdzenie zapisu. Stary zapis sesji migruje automatycznie. Po restarcie kolejka wraca wstrzymana — kliknij **Wznów**.
- Po przejściowym błędzie połączenia kolejka ponawia konto z odstępami 5, 10 i 20 sekund, a przy utrzymującej się awarii zatrzymuje się bez usuwania oczekujących kont. HTTP 429 respektuje czas oczekiwania serwera. Błąd zapisu zatrzymuje pracę i pokazuje **Ponów zapis**. Ciasteczka i logi nie trafiają do checkpointu.
- Graf pokazuje maksymalnie 400 węzłów i 4000 relacji, z pierwszeństwem otoczenia wybranego konta. Wyszukiwanie działa w całej sieci. Eksport JSON/CSV/GEXF/Cypher zawiera całą sieć; PNG przedstawia aktualny widok. Dla dużych sieci CSV/GEXF pomijają kosztowny ranking centralności. Ranking w interfejsie wyraźnie podaje zakres fragmentu.
- Porównanie obejmuje do 6 profili na stronie; filtr i przyciski stron pozwalają przejść przez cały zbiór. Wspólne powiązania dotyczą wyświetlanych kont.

Testy obciążeniowe obejmują 100 000 oczekujących nazw i 10 000 zapisanych profili syntetycznych, również po ponownym otwarciu interfejsu. Nie oznacza to wykonania 100 000 rzeczywistych analiz ani gwarancji dostępu do wszystkich obserwujących: tempo i dostępność danych nadal zależą od Instagrama, a pamięć i dysk od urządzenia. Wyniki pozostają lokalne; eksport i usunięcie sesji są dostępne w **Narzędziach**.
