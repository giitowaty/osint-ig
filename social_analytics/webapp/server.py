"""Lekka warstwa webowa (FastAPI) nad silnikiem ``social_analytics``.

Serwuje dashboard (HTML + Tailwind) oraz API JSON spinające potok ``analyze()``.

Uruchomienie:
    uvicorn social_analytics.webapp.server:app --reload
    # lub:  python -m social_analytics.webapp
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import HTMLResponse
    from fastapi.staticfiles import StaticFiles
except ModuleNotFoundError as exc:  # pragma: no cover
    raise ModuleNotFoundError(
        "Warstwa webowa wymaga FastAPI (pip install -r social_analytics/webapp/requirements.txt)."
    ) from exc

from ..pipeline import analyze

_BASE = Path(__file__).parent
_SAMPLE = _BASE.parent / "examples" / "sample_data.json"

app = FastAPI(title="social_analytics · dashboard", version="0.1.0")
app.mount("/static", StaticFiles(directory=str(_BASE / "static")), name="static")


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    """Serwuje stronę dashboardu."""
    return (_BASE / "templates" / "dashboard.html").read_text(encoding="utf-8")


@app.get("/api/sample")
def sample() -> dict[str, Any]:
    """Zwraca przykładowe dane (do szybkiego demo w UI)."""
    return json.loads(_SAMPLE.read_text(encoding="utf-8"))


@app.post("/api/analyze")
async def api_analyze(request: Request) -> dict[str, Any]:
    """Uruchamia potok analityczny na przesłanym JSON-ie.

    Body: surowe dane (``{"profile":..,"posts":..}`` lub lista), ewentualnie
    opakowane w ``{"data": ...}``.
    """
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="Body musi być poprawnym JSON-em.")

    payload: Any = body["data"] if isinstance(body, dict) and "data" in body else body
    try:
        return analyze(payload)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def main() -> None:  # pragma: no cover - uruchomienie serwera
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8100)


if __name__ == "__main__":  # pragma: no cover
    main()
