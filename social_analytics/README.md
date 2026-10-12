# social_analytics

Moduł Python do **analizy strukturalnej i klasyfikacji treści** publicznych
danych społecznościowych. Część open-source'owego narzędzia do *Public Data
Analytics & Network Graph Analysis*.

> **Zakres:** moduł operuje **wyłącznie na strukturach JSON** dostarczonych przez
> użytkownika (dict/list). Nie wykonuje żadnych zapytań sieciowych, nie loguje
> się nigdzie i nie obchodzi zabezpieczeń. To czysty potok przetwarzania danych.

## Instalacja

```bash
pip install -r social_analytics/requirements.txt   # networkx (dla grafu)
```

`metrics` i `nlp_pipeline` działają na samej bibliotece standardowej; `networkx`
jest potrzebny tylko dla `graph_schema`/`SocialGraph`.

## Komponenty

### 1. Struktura grafowa — `SocialGraph` (`graph_schema.py`, `centrality.py`)
Graf skierowany (NetworkX) relacji **@mentions** i **użycia hashtagów**:
- węzły: `kind="account"` oraz `kind="hashtag"`,
- krawędzie: `relation="mention"` (konto→konto) i `relation="uses"` (konto→hashtag),
  z akumulowaną wagą,
- `shared_hashtag_graph()` — nieskierowana projekcja konto–konto ważona liczbą
  wspólnych hashtagów,
- `to_node_link()` — serializacja do JSON (node-link).

```python
from social_analytics import SocialGraph
g = SocialGraph()
g.ingest_post("alice", "trip #travel with @bob", tagged=["gear_brand"])
g.most_mentioned(5)          # [('bob', 1), ('gear_brand', 1)]
g.shared_hashtag_graph()     # projekcja po wspólnych hashtagach
```

**Centralności i analiza wpływu** (`centrality.py`):
- `g.centralities()` → `{"pagerank": {...}, "betweenness": {...}, "degree": {...}, "eigenvector": {...}}`
- `g.rank_influential(top=10)` → lista `NodeInfluence` (ranking najważniejszych
  węzłów) z rodzajem wpływu: **hub** (duża waga/łączność), **bridge** (wysoka
  pośredniość przy niskim stopniu — łącznik skupisk), **connector**, **peripheral**.

```python
for n in g.rank_influential(top=5):
    print(n.node, n.influence, round(n.score, 3))
```

Miary niezbieżne na grafach zdegenerowanych/rozspójnych domyślnie zwracają zera
(`strict=False`); `strict=True` podnosi wyjątek. Pusty graf → `ValueError`.
PageRank w NetworkX 3.x korzysta ze `scipy` (patrz `requirements.txt`).

### 2. Klasyfikacja tematyczna — NLP pipeline (`nlp_pipeline.py`)
- `TextClassifier` (Protocol) — wspólny kontrakt; możesz podstawić własny model
  (scikit-learn, transformers) bez zmian w reszcie kodu.
- `LexiconTopicClassifier` — domyślny, deterministyczny klasyfikator leksykalny
  (słowa kluczowe PL+EN, dopasowanie na granicy słowa, bez diakrytyków).
- `classify_posts(posts, classifier=None)` — agregacja po wielu postach; zwraca
  listę `TopicScore(category, score, hits)` posortowaną malejąco, tylko kategorie
  faktycznie obecne.

```python
from social_analytics import classify_posts
classify_posts([{"caption": "#travel #nature mountains"}])
# [TopicScore(category='Travel', ...), TopicScore(category='Nature', ...)]
```

Podstawienie własnego modelu:
```python
class MyModel:
    def classify(self, text: str) -> list[TopicScore]: ...
classify_posts(posts, classifier=MyModel())
```

### 3. Silnik metryk — `MetricsEngine` (`metrics.py`)
Liczy m.in. **engagement rate** = śr.(lajki+komentarze) ÷ obserwujący, średnie i
medianę lajków, rozkład typów mediów i najpopularniejszy post. Odporny na braki
danych i dzielenie przez zero.

```python
from social_analytics import MetricsEngine
m = MetricsEngine().compute([{"likes": 100, "comments": 10}], followers=1000)
m.engagement_rate_pct     # 11.0
m.to_dict()               # pełny słownik gotowy do json.dumps
```

### 4. Adapter JSON — `JSONDataAdapter` (`adapters.py`)
Uniwersalny bridge wczytujący surowe JSON-y (z pliku, łańcucha lub obiektu) i
mapujący je na modele. Akceptuje pojedyncze konto, listę kont, `{"accounts":[…]}`
oraz payload z części JS projektu (dodatkowo `connections`). Odporny na brakujące
klucze; błędy strukturalne zgłasza jawnie (`TypeError`/`ValueError`/`FileNotFoundError`).

```python
from social_analytics import JSONDataAdapter
adapter = JSONDataAdapter.from_file("export.json")
accounts = adapter.accounts()            # list[AccountData]
graph = adapter.to_social_graph()        # SocialGraph (posty + connections)
metrics = adapter.metrics()              # {username: EngagementMetrics}
```

### 5. Eksport do Neo4j — `Neo4jExporter` (`neo4j_export.py`)
Transformuje `SocialGraph` na Cypher. Węzły `:Account`/`:Hashtag`, relacje
`:MENTIONS`/`:USES_HASHTAG` z właściwościami (wagi, opisy). Dwa tryby: literalny
(skrypt `.cypher`, wartości zescapowane) i parametryzowany (pary
`(zapytanie, params)` do sterownika `neo4j`, bez wstrzykiwania wartości).

```python
from social_analytics import Neo4jExporter
exporter = Neo4jExporter(graph)
exporter.write("graph.cypher")           # skrypt MERGE (idempotentny)
exporter.parameterized()                 # [("MERGE (a:Account {username:$username})", {...}), ...]
```

### 6. Dashboard webowy (`webapp/`, opcjonalny)
Lekka warstwa wizualna (FastAPI + Tailwind) nad silnikiem: ciemny panel z
engagement rate, paskami tematycznymi, rankingiem wpływu i interaktywnym grafem.
Logika spięcia jest w `pipeline.analyze(data)` (czysta funkcja JSON→JSON), a
serwer to cienka nakładka HTTP. Uruchomienie i API: `webapp/README.md`.

```bash
pip install -r social_analytics/webapp/requirements.txt
uvicorn social_analytics.webapp.server:app --port 8100
```

## Modele danych (`models.py`)
`Post`, `Profile`, `AccountData` — typowane dataclassy z metodami `from_json(...)`,
odporne na braki/śmieci w wejściu. Hashtagi i wzmianki są auto-wyłuskiwane z opisu.

## Jakość kodu
- Pełne typowanie (`from __future__ import annotations`, `typing`).
- Obsługa błędów: jawne `TypeError`/`ValueError` z czytelnymi komunikatami,
  bezpieczne konwersje, brak „cichych” wyjątków psujących potok.
- Testy: `python -m unittest discover -s social_analytics/tests -t .` (56 testów).
- Demo: `python -m social_analytics.examples.demo`.
