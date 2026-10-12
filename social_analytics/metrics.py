"""Silnik metryk aktywności i zaangażowania.

Operuje na zagregowanych wartościach polubień i komentarzy z postów. Wszystkie
metryki są odporne na braki danych (``None``) i dzielenie przez zero.
"""

from __future__ import annotations

import statistics
from collections import Counter
from dataclasses import asdict, dataclass, field
from typing import Any, Mapping, Sequence

from .models import AccountData, Post

__all__ = ["EngagementMetrics", "MetricsEngine"]


@dataclass(slots=True)
class EngagementMetrics:
    """Wynik obliczeń metryk dla konta."""

    posts_analyzed: int = 0
    avg_likes: float | None = None
    avg_comments: float | None = None
    median_likes: float | None = None
    total_likes: int = 0
    total_comments: int = 0
    engagement_rate: float | None = None          # udział (0..1) względem obserwujących
    engagement_rate_pct: float | None = None       # to samo w procentach
    avg_engagement_per_post: float | None = None   # śr. (lajki+komentarze)
    media_type_distribution: dict[str, int] = field(default_factory=dict)
    top_post_shortcode: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Czysty słownik (gotowy do ``json.dumps``)."""
        return asdict(self)


def _mean(values: Sequence[float]) -> float | None:
    return statistics.fmean(values) if values else None


def _median(values: Sequence[float]) -> float | None:
    return statistics.median(values) if values else None


class MetricsEngine:
    """Liczy metryki zaangażowania z listy postów.

    Przykład:
        >>> eng = MetricsEngine()
        >>> m = eng.compute([{"likes": 100, "comments": 10}], followers=1000)
        >>> round(m.engagement_rate_pct, 2)
        11.0
    """

    def compute(
        self,
        posts: Sequence[Post | Mapping[str, Any]],
        followers: int | None = None,
    ) -> EngagementMetrics:
        """Oblicza metryki dla kolekcji postów.

        Args:
            posts: lista ``Post`` lub surowych dictów ``{"likes":..,"comments":..}``.
            followers: liczba obserwujących (do engagement rate); ``None`` lub 0
                skutkuje ``engagement_rate = None`` zamiast błędu.

        Raises:
            TypeError: gdy ``posts`` nie jest sekwencją.
        """
        if not isinstance(posts, Sequence) or isinstance(posts, (str, bytes)):
            raise TypeError("compute oczekuje listy/sekwencji postów.")

        normalized = [self._as_post(p) for p in posts]
        normalized = [p for p in normalized if p is not None]

        likes = [p.likes for p in normalized if p.likes is not None]
        comments = [p.comments for p in normalized if p.comments is not None]
        engagements = [
            p.engagement for p in normalized if p.likes is not None or p.comments is not None
        ]

        total_likes = sum(likes)
        total_comments = sum(comments)
        avg_eng = _mean(engagements)

        engagement_rate: float | None = None
        if avg_eng is not None and followers and followers > 0:
            engagement_rate = avg_eng / followers

        type_dist = Counter(p.media_type for p in normalized if p.media_type)
        top = max(
            (p for p in normalized if p.likes is not None),
            key=lambda p: p.likes or 0,
            default=None,
        )

        return EngagementMetrics(
            posts_analyzed=len(normalized),
            avg_likes=_mean(likes),
            avg_comments=_mean(comments),
            median_likes=_median(likes),
            total_likes=total_likes,
            total_comments=total_comments,
            engagement_rate=engagement_rate,
            engagement_rate_pct=None if engagement_rate is None else engagement_rate * 100.0,
            avg_engagement_per_post=avg_eng,
            media_type_distribution=dict(type_dist),
            top_post_shortcode=top.shortcode if top and top.shortcode else None,
        )

    def compute_for_account(self, account: AccountData) -> EngagementMetrics:
        """Wygodny wrapper: liczy metryki na podstawie ``AccountData``."""
        if not isinstance(account, AccountData):
            raise TypeError("compute_for_account oczekuje obiektu AccountData.")
        return self.compute(account.posts, followers=account.profile.followers)

    @staticmethod
    def _as_post(item: Any) -> Post | None:
        if isinstance(item, Post):
            return item
        if isinstance(item, Mapping):
            try:
                return Post.from_json(item)
            except (TypeError, ValueError):
                return None
        return None
