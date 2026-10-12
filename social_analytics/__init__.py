"""social_analytics — analiza strukturalna i klasyfikacja publicznych danych społecznościowych.

Moduł pracuje wyłącznie na czystych strukturach JSON (dict/list) dostarczonych
przez użytkownika. Nie wykonuje zapytań sieciowych ani nie obchodzi zabezpieczeń.

Publiczne API:
    - models:       Post, Profile, AccountData
    - graph_schema: SocialGraph
    - nlp_pipeline: LexiconTopicClassifier, classify_posts, TopicScore, TextClassifier
    - metrics:      MetricsEngine, EngagementMetrics
"""

from __future__ import annotations

from .adapters import JSONDataAdapter
from .metrics import EngagementMetrics, MetricsEngine
from .pipeline import analyze
from .models import AccountData, Post, Profile, extract_hashtags, extract_mentions
from .nlp_pipeline import (
    DEFAULT_LEXICON,
    LexiconTopicClassifier,
    TextClassifier,
    TopicScore,
    classify_posts,
)

__version__ = "0.2.0"

__all__ = [
    "AccountData",
    "Post",
    "Profile",
    "extract_hashtags",
    "extract_mentions",
    "LexiconTopicClassifier",
    "TextClassifier",
    "TopicScore",
    "classify_posts",
    "DEFAULT_LEXICON",
    "MetricsEngine",
    "EngagementMetrics",
    "JSONDataAdapter",
    "analyze",
    # leniwe (wymagają networkx):
    "SocialGraph",
    "NodeInfluence",
    "compute_centralities",
    "rank_influential",
    "Neo4jExporter",
    "__version__",
]


# Elementy zależne od networkx importujemy „leniwo”, by brak zależności nie psuł
# importu całego pakietu (metrics/nlp/adapter działają bez networkx).
def __getattr__(name: str):  # noqa: D401 (PEP 562)
    if name == "SocialGraph":
        from .graph_schema import SocialGraph

        return SocialGraph
    if name in ("NodeInfluence", "compute_centralities", "rank_influential"):
        from . import centrality

        return getattr(centrality, name)
    if name == "Neo4jExporter":
        from .neo4j_export import Neo4jExporter

        return Neo4jExporter
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
