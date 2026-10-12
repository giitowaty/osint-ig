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
(wersja **LTS**). Jeśli go brak, launcher powie o tym i da link.

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
- **Port zajęty / strona się nie otwiera** — odczekaj 2–3 sekundy i odśwież
  przeglądarkę; serwer potrzebuje chwili na start.
- Obie części można odpalić naraz (główna apka na porcie 8000, dashboard na 8100).
