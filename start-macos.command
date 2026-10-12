#!/bin/bash
# OSINT-IG — podwójne kliknięcie uruchamia serwer i otwiera przeglądarkę (macOS).
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  [!] Nie znaleziono Node.js."
  echo "      Zainstaluj z https://nodejs.org i uruchom plik ponownie."
  echo ""
  read -n 1 -s -r -p "Naciśnij dowolny klawisz, aby zamknąć..."
  exit 1
fi

echo ""
echo "  Uruchamiam OSINT-IG na http://localhost:8000 ..."
echo "  (zamknij to okno, aby zatrzymać program)"
echo ""
( sleep 2; open "http://localhost:8000" ) &
exec node api/server.js
