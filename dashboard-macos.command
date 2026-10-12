#!/bin/bash
# OSINT-IG Dashboard (Python/FastAPI) — macOS.
cd "$(dirname "$0")" || exit 1

PY="python3"
command -v "$PY" >/dev/null 2>&1 || PY="python"
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "  [!] Nie znaleziono Pythona. Zainstaluj z https://python.org i uruchom ponownie."
  read -n 1 -s -r -p "Naciśnij dowolny klawisz..."
  exit 1
fi

echo "  Instaluję zależności (tylko za pierwszym razem)..."
"$PY" -m pip install -q -r social_analytics/requirements.txt
"$PY" -m pip install -q -r social_analytics/webapp/requirements.txt

echo "  Uruchamiam dashboard na http://localhost:8100 ..."
( sleep 3; open "http://localhost:8100" ) &
exec "$PY" -m uvicorn social_analytics.webapp.server:app --port 8100
