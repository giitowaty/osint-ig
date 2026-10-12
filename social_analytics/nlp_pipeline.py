"""Klasyfikacja tematyczna opisów i hashtagów.

Domyślny klasyfikator jest leksykalny (słowa kluczowe PL+EN per kategoria) i nie
wymaga żadnych zależności. Interfejs ``TextClassifier`` (Protocol) pozwala podmienić
go na dowolny model NLP (np. pipeline scikit-learn albo transformers), zachowując
tę samą sygnaturę.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, Mapping, Pattern, Protocol, runtime_checkable

from .models import Post, extract_hashtags

__all__ = [
    "TopicScore",
    "TextClassifier",
    "LexiconTopicClassifier",
    "classify_posts",
    "DEFAULT_LEXICON",
]


@dataclass(frozen=True, slots=True)
class TopicScore:
    """Pojedynczy wynik klasyfikacji: kategoria + znormalizowany udział 0..1."""

    category: str
    score: float
    hits: int


@runtime_checkable
class TextClassifier(Protocol):
    """Kontrakt klasyfikatora tekstu.

    Każda implementacja (leksykalna, ML, zewnętrzne API offline) musi zwracać
    listę ``TopicScore`` posortowaną malejąco po ``score``.
    """

    def classify(self, text: str) -> list[TopicScore]:
        ...


# Leksykon kategoria -> rdzenie słów (bez diakrytyków, małe litery).
DEFAULT_LEXICON: dict[str, tuple[str, ...]] = {
    "Technology": ("tech", "ai", "machine learning", "software", "programming",
                   "code", "developer", "startup", "gadget", "crypto", "data"),
    "Travel": ("travel", "trip", "vacation", "wanderlust", "explore", "podroz",
               "wakacj", "backpack", "destination", "roadtrip"),
    "Nature": ("nature", "natura", "wildlife", "forest", "mountain", "gory",
               "ocean", "sunset", "landscape", "hiking", "outdoor"),
    "Food": ("food", "foodie", "recipe", "jedzen", "przepis", "restaurant",
             "cooking", "baking", "coffee", "kawa"),
    "Fashion": ("fashion", "moda", "outfit", "ootd", "style", "streetwear",
                "clothing", "designer"),
    "Fitness": ("fitness", "gym", "workout", "training", "trening", "running",
                "yoga", "crossfit", "health", "zdrow"),
    "Music": ("music", "muzyka", "concert", "song", "band", "festival", "dj",
              "guitar", "album"),
    "Art": ("art", "sztuka", "drawing", "painting", "illustration", "design",
            "photography", "foto", "tattoo"),
    "Business": ("business", "biznes", "marketing", "entrepreneur", "sales",
                 "ecommerce", "finance", "investment"),
    "Sports": ("sport", "football", "soccer", "basketball", "nba", "tennis",
               "mma", "boxing"),
}


def _normalize(text: str) -> str:
    """Małe litery, usunięcie diakrytyków, rozbicie hashtagów ``#foo_bar``."""
    if not text:
        return ""
    text = text.replace("_", " ").replace("#", " ").replace("@", " ")
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return text


class LexiconTopicClassifier:
    """Prosty, deterministyczny klasyfikator oparty na słowach kluczowych.

    Zwraca wyłącznie kategorie z co najmniej jednym trafieniem (``score > 0``),
    więc nie produkuje „pustych” klas.
    """

    def __init__(self, lexicon: Mapping[str, Iterable[str]] | None = None) -> None:
        source = lexicon if lexicon is not None else DEFAULT_LEXICON
        if not source:
            raise ValueError("Leksykon nie może być pusty.")
        # Kompilujemy wzorce z dopasowaniem do granicy słowa (prefiks), aby łapać
        # odmiany (travel->travelling, podroz->podroze), ale nie trafień wewnątrz
        # innych słów (np. „ai” w „mountain”).
        self._patterns: dict[str, tuple[Pattern[str], ...]] = {
            cat: tuple(re.compile(r"\b" + re.escape(_normalize(kw))) for kw in kws)
            for cat, kws in source.items()
        }

    def classify(self, text: str) -> list[TopicScore]:
        """Klasyfikuje pojedynczy tekst. Pusty tekst -> pusta lista."""
        norm = _normalize(text)
        if not norm:
            return []
        hits: Counter[str] = Counter()
        for category, patterns in self._patterns.items():
            count = sum(len(p.findall(norm)) for p in patterns)
            if count:
                hits[category] = count
        total = sum(hits.values())
        if not total:
            return []
        return [
            TopicScore(category=cat, score=cnt / total, hits=cnt)
            for cat, cnt in hits.most_common()
        ]


def classify_posts(
    posts: Iterable[Post | Mapping[str, object]],
    classifier: TextClassifier | None = None,
) -> list[TopicScore]:
    """Agreguje klasyfikację po wielu postach (opis + hashtagi + alt).

    Args:
        posts: lista obiektów ``Post`` lub surowych dictów JSON.
        classifier: implementacja ``TextClassifier`` (domyślnie leksykalna).

    Returns:
        Lista ``TopicScore`` dla całego konta, posortowana malejąco.

    Raises:
        TypeError: gdy ``posts`` nie jest iterowalne.
    """
    clf: TextClassifier = classifier or LexiconTopicClassifier()
    try:
        iterator = iter(posts)
    except TypeError as exc:
        raise TypeError("classify_posts oczekuje iterowalnej kolekcji postów.") from exc

    aggregate: Counter[str] = Counter()
    for item in iterator:
        if isinstance(item, Post):
            text = f"{item.caption} {item.alt} " + " ".join(f"#{h}" for h in item.hashtags)
        elif isinstance(item, Mapping):
            caption = str(item.get("caption", ""))
            alt = str(item.get("alt", ""))
            tags = item.get("hashtags") or extract_hashtags(caption)
            text = f"{caption} {alt} " + " ".join(f"#{t}" for t in tags)
        else:  # pomijamy nieznane typy zamiast wysypywać cały potok
            continue
        for ts in clf.classify(text):
            aggregate[ts.category] += ts.hits

    total = sum(aggregate.values())
    if not total:
        return []
    return [
        TopicScore(category=cat, score=cnt / total, hits=cnt)
        for cat, cnt in aggregate.most_common()
    ]
