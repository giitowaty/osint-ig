"""Przykład użycia pakietu social_analytics na czystym JSON-ie.

Uruchomienie:
    python -m social_analytics.examples.demo
"""

from __future__ import annotations

import json
from pathlib import Path

from social_analytics import (
    JSONDataAdapter,
    MetricsEngine,
    Neo4jExporter,
    classify_posts,
)


def main() -> None:
    raw = (Path(__file__).parent / "sample_data.json").read_text(encoding="utf-8")

    # JSONDataAdapter wczytuje surowy JSON i mapuje na modele wewnętrzne.
    adapter = JSONDataAdapter.from_string(raw)
    account = adapter.first()
    print(f"Konto: @{account.username}  ({len(account.posts)} postów)\n")

    # 1) Metryki
    metrics = MetricsEngine().compute_for_account(account)
    print("== Metryki ==")
    print(json.dumps(metrics.to_dict(), indent=2, ensure_ascii=False))

    # 2) Klasyfikacja tematyczna
    print("\n== Tematyka ==")
    for ts in classify_posts(account.posts):
        print(f"  {ts.category:12s} {ts.score:5.0%}  ({ts.hits} trafień)")

    # 3) Graf + centralności / ranking wpływu
    graph = adapter.to_social_graph()
    print("\n== Graf ==")
    print(f"  konta: {graph.accounts()}")
    print(f"  hashtagi: {graph.hashtags()}")

    print("\n== Ranking wpływu (centralności) ==")
    for infl in graph.rank_influential(top=6):
        print(f"  {infl.node:16s} {infl.influence:10s} "
              f"score={infl.score:.3f}  pr={infl.pagerank:.3f}  btw={infl.betweenness:.3f}")

    # 4) Eksport do Neo4j (Cypher)
    print("\n== Eksport Neo4j (fragment Cypher) ==")
    cypher = Neo4jExporter(graph).to_cypher()
    for line in cypher.splitlines()[:6]:
        print("  " + line)
    print("  …")


if __name__ == "__main__":
    main()
