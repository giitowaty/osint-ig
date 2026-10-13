"""CLI-most między backendem Node a silnikiem ``social_analytics``.

Czyta JSON ze standardowego wejścia (graf zbudowany w przeglądarce w kształcie
akceptowanym przez :class:`JSONDataAdapter`), uruchamia :func:`pipeline.analyze`
i wypisuje wynik jako JSON na standardowe wyjście. Całość przez stdin/stdout —
żadnych argumentów ani ścieżek, dzięki czemu wywołanie z Node jest proste i
bezpieczne (nie da się nim sięgnąć po pliki systemu).

Uruchomienie:  python3 -m social_analytics.bridge   (dane na stdin)

Format wyjścia:
    {"ok": true,  "result": {...}}         — sukces
    {"ok": false, "error": "...", ...}     — błąd (zawsze poprawny JSON, kod 0)
"""

from __future__ import annotations

import json
import sys


def run(raw: str) -> dict:
    """Przetwarza surowy tekst JSON i zwraca słownik odpowiedzi (bez I/O)."""
    try:
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        return {"ok": False, "error": f"Niepoprawny JSON wejściowy: {exc}"}
    try:
        from .pipeline import analyze
        return {"ok": True, "result": analyze(data)}
    except ModuleNotFoundError as exc:
        # Brak np. networkx — metryki grafowe niedostępne.
        return {"ok": False, "error": f"Brak zależności Pythona: {exc}", "need": "networkx"}
    except (ValueError, TypeError) as exc:
        return {"ok": False, "error": str(exc)}


def main() -> int:
    raw = sys.stdin.read()
    out = run(raw)
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
