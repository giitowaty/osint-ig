"""Warstwa integracyjna: spina silnik ``social_analytics`` w jeden wynik JSON.

``analyze()`` przyjmuje surowe dane (dict/list), uruchamia metryki, klasyfikację
tematyczną oraz analizę grafową i zwraca strukturę gotową do serializacji JSON i
wyświetlenia w dashboardzie. Nie zależy od warstwy webowej — można jej używać w
CLI, notatniku czy testach.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Mapping, Sequence

from .adapters import JSONDataAdapter
from .metrics import MetricsEngine
from .nlp_pipeline import TextClassifier, classify_posts

__all__ = ["analyze"]


def _profile_dict(account: Any) -> dict[str, Any]:
    p = account.profile
    return {
        "username": p.username,
        "full_name": p.full_name,
        "followers": p.followers,
        "following": p.following,
        "posts_count": p.posts_count,
        "category": p.category,
        "verified": p.verified,
        "is_private": p.is_private,
    }


def analyze(
    data: Mapping[str, Any] | Sequence[Any],
    *,
    classifier: TextClassifier | None = None,
    top_nodes: int = 15,
) -> dict[str, Any]:
    """Uruchamia pełny potok analityczny i zwraca wynik jako czysty słownik.

    Args:
        data: surowe dane (jak przyjmuje ``JSONDataAdapter``).
        classifier: opcjonalny klasyfikator tematyczny (domyślnie leksykalny).
        top_nodes: ile węzłów zwrócić w rankingu wpływu.

    Returns:
        Słownik z kluczami: ``accounts``, ``primary``, ``graph``, ``influence``,
        ``summary``, ``graph_available``.

    Raises:
        ValueError / TypeError: przy niepoprawnych danych wejściowych (z adaptera).
    """
    adapter = JSONDataAdapter.from_obj(data)
    engine = MetricsEngine()

    accounts_out: list[dict[str, Any]] = []
    for account in adapter.accounts():
        metrics = engine.compute_for_account(account)
        topics = [asdict(t) for t in classify_posts(account.posts, classifier=classifier)]
        accounts_out.append({
            "profile": _profile_dict(account),
            "metrics": metrics.to_dict(),
            "topics": topics,
            "posts_preview": [
                {
                    "shortcode": post.shortcode,
                    "likes": post.likes,
                    "comments": post.comments,
                    "media_type": post.media_type,
                    "hashtags": post.hashtags,
                }
                for post in account.posts[:12]
            ],
        })

    result: dict[str, Any] = {
        "accounts": accounts_out,
        "primary": accounts_out[0] if accounts_out else None,
        "graph": {"nodes": [], "links": []},
        "influence": [],
        "graph_available": False,
    }

    # Warstwa grafowa jest opcjonalna (wymaga networkx) — brak zależności nie
    # powinien wywracać metryk i tematyki.
    try:
        graph = adapter.to_social_graph()
        node_link = graph.to_node_link()
        influence = [n.to_dict() for n in graph.rank_influential(top=top_nodes)]
        influence_by_node = {item["node"]: item for item in influence}
        for node in node_link.get("nodes", []):
            info = influence_by_node.get(node.get("id"))
            node["influence"] = info["influence"] if info else "peripheral"
            node["score"] = info["score"] if info else 0.0
        result.update({
            "graph": node_link,
            "influence": influence,
            "graph_available": True,
            "summary": {
                "accounts": len(graph.accounts()),
                "hashtags": len(graph.hashtags()),
                "nodes": len(node_link.get("nodes", [])),
                "edges": len(node_link.get("links", [])),
            },
        })
    except ModuleNotFoundError as exc:
        result["graph_error"] = f"Warstwa grafowa niedostępna: {exc}"

    return result
