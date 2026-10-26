#!/bin/bash
# OSINT-IG — uruchamia aplikację i otwiera przeglądarkę (Linux).
# Całą pracę (wersja Node, instalacja, przebudowa po aktualizacji, port) robi
# scripts/launch.mjs — wspólny dla Windows/macOS/Linux.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  [!] Nie znaleziono Node.js."
  echo "      Zainstaluj wersję LTS (20.19+ albo 22.12+), np. z https://nodejs.org,"
  echo "      i uruchom plik ponownie."
  echo ""
  read -n 1 -s -r -p "Naciśnij dowolny klawisz, aby zamknąć..."
  exit 1
fi

node scripts/launch.mjs
code=$?
if [ $code -ne 0 ]; then
  echo ""
  read -n 1 -s -r -p "Coś poszło nie tak (szczegóły wyżej). Naciśnij dowolny klawisz, aby zamknąć..."
fi
exit $code
