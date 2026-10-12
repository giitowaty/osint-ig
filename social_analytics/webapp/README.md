# social_analytics · dashboard (FastAPI)

Lekka warstwa wizualna nad silnikiem `social_analytics`. Serwuje ciemny
dashboard i API JSON spinające potok `analyze()`. Styling jest **samodzielny**
(`static/dashboard.css`) — bez żadnego CDN, więc działa w pełni offline.

## Uruchomienie

```bash
pip install -r social_analytics/requirements.txt          # silnik (networkx, scipy)
pip install -r social_analytics/webapp/requirements.txt   # fastapi, uvicorn

uvicorn social_analytics.webapp.server:app --reload --port 8100
# lub:  python -m social_analytics.webapp
```

Otwórz <http://127.0.0.1:8100>. Kliknij „Przykład”, potem „Analizuj”.

## API

| Endpoint | Metoda | Rola |
|----------|--------|------|
| `/` | GET | dashboard (HTML) |
| `/api/sample` | GET | przykładowe dane do UI |
| `/api/analyze` | POST | uruchamia potok na przesłanym JSON-ie |

`POST /api/analyze` przyjmuje surowe dane (`{"profile":…,"posts":…}` lub listę,
ewentualnie `{"data": …}`) i zwraca wynik `pipeline.analyze()`:
statystyki/engagement, rozkład tematyczny, graf (node-link) i ranking wpływu.

## Co pokazuje dashboard

- **Statystyki**: obserwujący, engagement rate, śr. lajki, liczba postów.
- **Rozkład tematyczny**: paski postępu z udziałami kategorii (NLP).
- **Ranking wpływu**: najważniejsze węzły z etykietą hub/bridge/connector.
- **Graf powiązań**: interaktywna wizualizacja SVG (węzły przeciągalne,
  kolorowane wg rodzaju i wpływu).

## Integracja z silnikiem

Cała logika liczenia jest w `social_analytics.pipeline.analyze(data)` — czysta
funkcja zwracająca JSON, niezależna od warstwy web. Serwer jest tylko cienką
nakładką HTTP; ten sam `analyze()` można wołać z CLI, notatnika czy testów.
