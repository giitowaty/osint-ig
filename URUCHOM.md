# ▶ Jak uruchomić OSINT-IG (podwójne kliknięcie)

Nie musisz nic wpisywać w terminal — wystarczy kliknąć odpowiedni plik.
Serwer sam wystartuje, a przeglądarka otworzy się automatycznie.

## Główna aplikacja (analiza profilu + sieć)

| System | Kliknij dwukrotnie |
|--------|--------------------|
| 🪟 Windows | **`start-windows.bat`** |
| 🍎 macOS | **`start-macos.command`** |
| 🐧 Linux | **`start-linux.sh`** |

→ otworzy się **http://localhost:8000**

Potrzebujesz zainstalowanego **Node.js** (jednorazowo): https://nodejs.org
(wersja **LTS**, czyli 20.19+ albo 22.12+). Jeśli go brak lub jest za stary,
launcher powie o tym i da link.

Launcher jest „inteligentny": przy pierwszym razie instaluje zależności i buduje
interfejs, a **po każdej aktualizacji kodu** (np. `git pull`) sam wykrywa zmianę
i przebudowuje — nigdy nie pokaże starej wersji. Jeśli port 8000 jest zajęty,
sam wybierze kolejny wolny i wypisze adres.

Aby **zatrzymać** program — zamknij okno/terminal serwera, które się pojawiło.

## Dashboard analityczny (Python, wykresy i graf)

| System | Kliknij dwukrotnie |
|--------|--------------------|
| 🪟 Windows | **`dashboard-windows.bat`** |
| 🍎 macOS | **`dashboard-macos.command`** |
| 🐧 Linux | **`dashboard-linux.sh`** |

→ otworzy się **http://localhost:8100**

Potrzebujesz **Pythona 3.10+** (https://python.org — na Windowsie zaznacz
„Add Python to PATH"). Przy **pierwszym** uruchomieniu launcher sam doinstaluje
biblioteki (chwilę to potrwa), kolejne razy startuje od razu.

## Wskazówki

- **macOS** może przy pierwszym razie zapytać o zgodę: kliknij plik prawym
  przyciskiem → *Otwórz* → *Otwórz*. Gdyby plik się nie uruchamiał, nadaj mu
  prawa: w Terminalu `chmod +x start-macos.command`.
- **Linux**: jeśli dwuklik nie działa, kliknij plik prawym → *Właściwości* →
  *Uprawnienia* → zaznacz „Pozwól na wykonywanie", albo uruchom z menu
  „Uruchom w terminalu".
- **Strona się nie otwiera** — odczekaj 2–3 sekundy i odśwież; serwer potrzebuje
  chwili na start. Jeśli przeglądarka nie wyskoczy sama, wejdź ręcznie na adres,
  który launcher wypisał w oknie (domyślnie http://localhost:8000).
- Obie części można odpalić naraz (główna apka na porcie 8000, dashboard na 8100).

## Wersja 0.4: web + desktop (Tauri)

| Co | Polecenie |
|----|-----------|
| Tryb deweloperski (serwer + Vite z HMR) | `npm run dev`, potem http://127.0.0.1:5173 |
| Produkcja web | `npm run serve` (build + serwer), potem http://localhost:8000 |
| Desktop w trybie dev | `npm run desktop:dev` (wymaga Rust) |
| Instalator desktop | `npm run desktop:build` → `src-tauri/target/release/bundle/` |
| Testy | `npm test` |

Desktop uruchamia wbudowany silnik (serwer Node jako jeden plik, sidecar) na losowym porcie 127.0.0.1.

## Budowanie aplikacji .exe (jedno polecenie)

Dwuklik **`build-exe.bat`** albo `npm run build:exe`. Skrypt `scripts/build-exe.mjs`:

1. sprawdza wymagania (Node ≥ 20, Rust, Tauri CLI, WebView2) i w razie potrzeby instaluje zależności npm (bez skryptów instalacyjnych),
2. uruchamia typecheck, lint i testy,
3. buduje silnik (sidecar Node SEA), front i aplikację Tauri w trybie release,
4. **testuje zbudowany `.exe`**: start silnika, API (walidacja, proxy obrazków, 404), CORS, strumień SSE z IG,
   interfejs w WebView2 (render, połączenie z silnikiem, formularz, nawigacja, log silnika, paleta `Ctrl K`,
   brak błędów konsoli, zrzut ekranu), zamknięcie aplikacji razem z silnikiem,
5. kopiuje do `release/`: instalatory MSI i NSIS, wersję przenośną (`OSINT-IG-<wersja>-portable/`), `SHA256SUMS.txt`, `RAPORT.md`, `test-ui.png`.

Opcje: `--skip-tests`, `--skip-build` (sam test gotowej aplikacji), `--offline` (bez zapytania do IG), `--no-ui`.
Kod wyjścia ≠ 0, gdy którykolwiek krok zawiedzie.

## Podłączenie konta Instagram (ciasteczka)

Zakładka **Sesja IG → Połącz konto**. Najprościej:

1. Zainstaluj rozszerzenie z folderu `extension/` (chrome://extensions lub edge://extensions → tryb dewelopera → „Załaduj rozpakowane”).
2. Zaloguj się na instagram.com na **koncie pomocniczym** (nie głównym: to scraping, grozi blokadą).
3. Uruchom aktualną aplikację OSINT-IG i kliknij ikonę rozszerzenia → **„Połącz z aplikacją OSINT-IG”**.
4. Konto połączy się i sprawdzi automatycznie. Po aktualizacji odśwież wtyczkę w chrome://extensions / edge://extensions.

Działa też bez rozszerzenia (zakładki **Wklej** i **Plik**): nagłówek `Cookie:` z DevTools, JSON z Cookie-Editor /
EditThisCookie, plik `cookies.txt` (Netscape) albo sama wartość `sessionid`. Format rozpoznaje się sam; zostają tylko
ciasteczka instagram.com z białej listy (`sessionid`, `csrftoken`, `ds_user_id`, `mid`, …), a token CSRF trafia do
nagłówka zapytań jak w przeglądarce.

Ciasteczka leżą tylko na tym urządzeniu (localStorage / magazyn aplikacji), nie trafiają do zapisu sesji ani eksportów,
serwer ich nie zapisuje ani nie loguje (w diagnostyce widać wyłącznie nazwy). „Odłącz i usuń” kasuje je od razu.
