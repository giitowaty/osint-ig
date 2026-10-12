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

from .metrics import EngagementMetrics, MetricsEngine
from .models import AccountData, Post, Profile, extract_hashtags, extract_mentions
from .nlp_pipeline import (
    DEFAULT_LEXICON,
    LexiconTopicClassifier,
    TextClassifier,
    TopicScore,
    classify_posts,
)

__version__ = "0.1.0"

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
    "__version__",
]


# SocialGraph wymaga networkx — import „leniwy”, by brak zależności nie psuł
# importu całego pakietu (metrics/nlp działają bez networkx).
def __getattr__(name: str):  # noqa: D401 (PEP 562)
    if name == "SocialGraph":
        from .graph_schema import SocialGraph

        return SocialGraph
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
