"""Przykład użycia pakietu social_analytics na czystym JSON-ie.

Uruchomienie:
    python -m social_analytics.examples.demo
"""

from __future__ import annotations

import json
from pathlib import Path

from social_analytics import (
    AccountData,
    MetricsEngine,
    SocialGraph,
    classify_posts,
)


def main() -> None:
    data = json.loads((Path(__file__).parent / "sample_data.json").read_text(encoding="utf-8"))
    account = AccountData.from_json(data)

    print(f"Konto: @{account.username}  ({len(account.posts)} postów)\n")

    # 1) Metryki
    metrics = MetricsEngine().compute_for_account(account)
    print("== Metryki ==")
    print(json.dumps(metrics.to_dict(), indent=2, ensure_ascii=False))

    # 2) Klasyfikacja tematyczna
    print("\n== Tematyka ==")
    for ts in classify_posts(account.posts):
        print(f"  {ts.category:12s} {ts.score:5.0%}  ({ts.hits} trafień)")

    # 3) Graf powiązań
    graph = SocialGraph()
    graph.ingest_account(account)
    print("\n== Graf ==")
    print(f"  konta: {graph.accounts()}")
    print(f"  hashtagi: {graph.hashtags()}")
    print(f"  najczęściej wspominani: {graph.most_mentioned(5)}")


if __name__ == "__main__":
    main()
