#!/bin/bash
# OSINT-IG — uruchamia serwer i otwiera przeglądarkę (Linux).
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  [!] Nie znaleziono Node.js."
  echo "      Zainstaluj (np. 'sudo apt install nodejs') i uruchom plik ponownie."
  echo ""
  read -n 1 -s -r -p "Naciśnij dowolny klawisz, aby zamknąć..."
  exit 1
fi

if [ ! -f dist/index.html ]; then
  echo "  Pierwsze uruchomienie: instaluję zależności i buduję interfejs (1-2 min)..."
  if [ ! -d node_modules ]; then npm install --ignore-scripts --no-audit --no-fund || exit 1; fi
  npm run build || exit 1
fi

echo ""
echo "  Uruchamiam OSINT-IG na http://localhost:8000 ..."
echo "  (zamknij ten terminal, aby zatrzymać program)"
echo ""
( sleep 2; xdg-open "http://localhost:8000" >/dev/null 2>&1 ) &
exec node api/server.js
