"""Typowane modele danych wejściowych.

Moduł pracuje wyłącznie na strukturach JSON dostarczonych przez użytkownika
(np. wyeksportowanych z aplikacji analitycznej). Nie wykonuje żadnych zapytań
sieciowych ani nie obchodzi zabezpieczeń — wejściem jest czysty `dict`/`list`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

__all__ = ["Post", "Profile", "AccountData", "extract_hashtags", "extract_mentions"]

_HASHTAG_RE = re.compile(r"#([\wÀ-ɏ]{2,50})", re.UNICODE)
_MENTION_RE = re.compile(r"@([A-Za-z0-9._]{2,30})")


def extract_hashtags(text: str | None) -> list[str]:
    """Wyłuskuje hashtagi (bez znaku ``#``, małymi literami) z tekstu."""
    if not text:
        return []
    return [m.group(1).lower() for m in _HASHTAG_RE.finditer(text)]


def extract_mentions(text: str | None) -> list[str]:
    """Wyłuskuje wzmianki ``@konto`` (bez ``@``, małymi literami) z tekstu."""
    if not text:
        return []
    return [m.group(1).lower() for m in _MENTION_RE.finditer(text)]


def _as_int(value: Any) -> int | None:
    """Bezpieczna konwersja na ``int`` (zwraca ``None`` dla braku/śmieci)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_str(value: Any) -> str:
    return "" if value is None else str(value)


@dataclass(slots=True)
class Post:
    """Pojedynczy post: tekst, zasięg i powiązania.

    Hashtagi i wzmianki są wyliczane z opisu, jeśli nie podano ich wprost.
    """

    shortcode: str = ""
    caption: str = ""
    alt: str = ""
    likes: int | None = None
    comments: int | None = None
    media_type: str = "image"  # "image" | "video" | "carousel"
    tagged: list[str] = field(default_factory=list)
    hashtags: list[str] = field(default_factory=list)
    mentions: list[str] = field(default_factory=list)
    timestamp: int | None = None  # epoch (sekundy), opcjonalnie

    def __post_init__(self) -> None:
        text = f"{self.caption} {self.alt}"
        if not self.hashtags:
            self.hashtags = extract_hashtags(text)
        if not self.mentions:
            self.mentions = extract_mentions(text)
        self.tagged = [t.lower().lstrip("@") for t in self.tagged if t]

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> "Post":
        """Tworzy ``Post`` z elastycznego słownika JSON.

        Raises:
            TypeError: gdy ``data`` nie jest mapowaniem.
        """
        if not isinstance(data, Mapping):
            raise TypeError(f"Post.from_json oczekuje dict, otrzymano {type(data).__name__}")
        tagged = data.get("tagged") or data.get("tagged_users") or []
        if not isinstance(tagged, Sequence) or isinstance(tagged, (str, bytes)):
            tagged = []
        return cls(
            shortcode=_as_str(data.get("shortcode") or data.get("id")),
            caption=_as_str(data.get("caption")),
            alt=_as_str(data.get("alt") or data.get("accessibility_caption")),
            likes=_as_int(data.get("likes")),
            comments=_as_int(data.get("comments")),
            media_type=_as_str(data.get("type") or data.get("media_type") or "image"),
            tagged=[_as_str(t) for t in tagged],
            hashtags=[h.lower() for h in (data.get("hashtags") or []) if h],
            mentions=[m.lower() for m in (data.get("mentions") or []) if m],
            timestamp=_as_int(data.get("timestamp") or data.get("taken_at")),
        )

    @property
    def engagement(self) -> int:
        """Suma lajków i komentarzy (brakujące traktowane jako 0)."""
        return (self.likes or 0) + (self.comments or 0)


@dataclass(slots=True)
class Profile:
    """Metadane konta."""

    username: str
    full_name: str = ""
    followers: int | None = None
    following: int | None = None
    posts_count: int | None = None
    category: str = ""
    verified: bool = False
    is_private: bool = False

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> "Profile":
        if not isinstance(data, Mapping):
            raise TypeError(f"Profile.from_json oczekuje dict, otrzymano {type(data).__name__}")
        username = _as_str(data.get("username")).lower().lstrip("@")
        if not username:
            raise ValueError("Profile wymaga niepustego pola 'username'.")
        return cls(
            username=username,
            full_name=_as_str(data.get("fullName") or data.get("full_name")),
            followers=_as_int(data.get("followers")),
            following=_as_int(data.get("following")),
            posts_count=_as_int(data.get("posts") or data.get("posts_count")),
            category=_as_str(data.get("category") or data.get("category_name")),
            verified=bool(data.get("verified") or data.get("is_verified")),
            is_private=bool(data.get("private") or data.get("is_private")),
        )


@dataclass(slots=True)
class AccountData:
    """Pełny rekord konta: profil + posty."""

    profile: Profile
    posts: list[Post] = field(default_factory=list)

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> "AccountData":
        """Buduje ``AccountData`` z JSON-a o kształcie ``{"profile": {...}, "posts": [...]}``.

        Akceptuje też płaski kształt, gdzie pola profilu są na najwyższym poziomie.
        """
        if not isinstance(data, Mapping):
            raise TypeError(f"AccountData.from_json oczekuje dict, otrzymano {type(data).__name__}")
        profile_src = data.get("profile") if isinstance(data.get("profile"), Mapping) else data
        posts_src: Iterable[Any] = data.get("posts") or []
        if not isinstance(posts_src, Sequence) or isinstance(posts_src, (str, bytes)):
            raise TypeError("Pole 'posts' musi być listą obiektów.")
        posts = [Post.from_json(p) for p in posts_src if isinstance(p, Mapping)]
        return cls(profile=Profile.from_json(profile_src), posts=posts)

    @property
    def username(self) -> str:
        return self.profile.username
