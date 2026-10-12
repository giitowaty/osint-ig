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
    import httpx
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

# Opcjonalne pobieranie publicznego profilu (best-effort, jak w części JS).
# To warstwa wygody dashboardu — rdzeń silnika nadal działa tylko na JSON.
_IG_ENDPOINT = "https://www.instagram.com/api/v1/users/web_profile_info/?username="
_IG_APP_ID = "936619743392459"


def _normalize_ig_user(user: dict[str, Any]) -> dict[str, Any]:
    """Mapuje surowy obiekt web_profile_info na kształt {profile, posts}."""
    def media_type(node: dict[str, Any]) -> str:
        return {"GraphVideo": "video", "GraphSidecar": "carousel"}.get(node.get("__typename"), "image")

    edges = (user.get("edge_owner_to_timeline_media") or {}).get("edges") or []
    posts: list[dict[str, Any]] = []
    for edge in edges:
        node = edge.get("node") or {}
        cap_edges = (node.get("edge_media_to_caption") or {}).get("edges") or []
        caption = cap_edges[0]["node"].get("text", "") if cap_edges else ""
        likes = ((node.get("edge_liked_by") or node.get("edge_media_preview_like") or {}).get("count"))
        tagged_edges = (node.get("edge_media_to_tagged_user") or {}).get("edges") or []
        tagged = [((te.get("node") or {}).get("user") or {}).get("username") for te in tagged_edges]
        posts.append({
            "shortcode": node.get("shortcode", ""),
            "caption": caption,
            "alt": node.get("accessibility_caption") or "",
            "likes": likes,
            "comments": (node.get("edge_media_to_comment") or {}).get("count"),
            "type": media_type(node),
            "tagged": [t for t in tagged if t],
        })
    return {
        "profile": {
            "username": user.get("username"),
            "full_name": user.get("full_name", ""),
            "followers": (user.get("edge_followed_by") or {}).get("count"),
            "following": (user.get("edge_follow") or {}).get("count"),
            "posts": (user.get("edge_owner_to_timeline_media") or {}).get("count"),
            "category": user.get("category_name") or "",
            "verified": bool(user.get("is_verified")),
            "private": bool(user.get("is_private")),
        },
        "posts": posts,
    }

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


@app.get("/api/fetch")
async def fetch_profile(username: str) -> dict[str, Any]:
    """Pobiera publiczne dane profilu z IG i zwraca je w kształcie {profile, posts}.

    Best-effort: Instagram często wymaga logowania / limituje; przy niepowodzeniu
    zwraca jasny błąd, a użytkownik może wkleić dane ręcznie.
    """
    handle = (username or "").strip().lstrip("@")
    if not handle:
        raise HTTPException(status_code=400, detail="Podaj nazwę profilu.")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "x-ig-app-id": _IG_APP_ID,
        "Accept": "*/*",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(_IG_ENDPOINT + handle, headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Nie udało się połączyć z Instagramem: {exc}") from exc
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Nie znaleziono profilu.")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Instagram odpowiedział HTTP {resp.status_code}.")
    try:
        data = resp.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Instagram nie zwrócił danych (prawdopodobnie wymaga logowania).") from exc
    user = (data.get("data") or {}).get("user")
    if not user:
        raise HTTPException(status_code=404, detail="Nie znaleziono profilu.")
    return _normalize_ig_user(user)


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
