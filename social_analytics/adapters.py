"""Uniwersalny adapter wczytujący surowe JSON-y do wewnętrznych struktur.

``JSONDataAdapter`` przyjmuje dane z pliku, łańcucha lub obiektu Pythona i mapuje
je na ``AccountData`` (dla ``MetricsEngine``/NLP) oraz buduje ``SocialGraph``.
Akceptuje elastyczne kształty:

* pojedyncze konto ``{"profile": {...}, "posts": [...]}`` lub płaskie,
* payload z części JS projektu (dodatkowo ``"connections": [{"username","count"}]``),
* listę kont ``[ {...}, {...} ]`` lub ``{"accounts": [ ... ]}``.

Jest odporny na brakujące klucze i puste wartości; błędy strukturalne zgłasza
jawnymi wyjątkami (``TypeError``/``ValueError``/``FileNotFoundError``).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping, Sequence

from .metrics import EngagementMetrics, MetricsEngine
from .models import AccountData

__all__ = ["JSONDataAdapter"]


def _as_count(value: Any) -> int:
    try:
        n = int(value)
        return n if n > 0 else 1
    except (TypeError, ValueError):
        return 1


class JSONDataAdapter:
    """Bridge między surowym JSON-em a modelami ``social_analytics``."""

    def __init__(self, data: Mapping[str, Any] | Sequence[Any]) -> None:
        self._raw_accounts: list[dict[str, Any]] = self._normalize(data)

    # ------------------------------------------------------------- konstruktory
    @classmethod
    def from_obj(cls, obj: Mapping[str, Any] | Sequence[Any]) -> "JSONDataAdapter":
        """Tworzy adapter z gotowego obiektu Pythona (dict/list)."""
        return cls(obj)

    @classmethod
    def from_string(cls, text: str) -> "JSONDataAdapter":
        """Tworzy adapter z łańcucha JSON.

        Raises:
            ValueError: gdy tekst nie jest poprawnym JSON-em.
        """
        if not isinstance(text, str):
            raise TypeError(f"from_string oczekuje str, otrzymano {type(text).__name__}")
        try:
            return cls(json.loads(text))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Niepoprawny JSON: {exc}") from exc

    @classmethod
    def from_file(cls, path: str | Path) -> "JSONDataAdapter":
        """Tworzy adapter z pliku ``.json``.

        Raises:
            FileNotFoundError: gdy pliku nie ma.
            ValueError: gdy zawartość nie jest poprawnym JSON-em.
        """
        p = Path(path)
        if not p.is_file():
            raise FileNotFoundError(f"Nie znaleziono pliku: {p}")
        return cls.from_string(p.read_text(encoding="utf-8"))

    # -------------------------------------------------------------- normalizacja
    @staticmethod
    def _normalize(data: Any) -> list[dict[str, Any]]:
        """Sprowadza dowolny z akceptowanych kształtów do listy słowników kont."""
        if isinstance(data, Mapping):
            accounts = data.get("accounts")
            if isinstance(accounts, Sequence) and not isinstance(accounts, (str, bytes)):
                source: Sequence[Any] = accounts
            else:
                source = [data]
        elif isinstance(data, Sequence) and not isinstance(data, (str, bytes)):
            source = data
        else:
            raise TypeError(
                "JSONDataAdapter oczekuje dict lub list; otrzymano "
                f"{type(data).__name__}"
            )
        result: list[dict[str, Any]] = []
        for item in source:
            if not isinstance(item, Mapping):
                raise TypeError("Każdy element danych musi być obiektem (dict).")
            result.append(dict(item))
        if not result:
            raise ValueError("Brak danych kont w wejściu.")
        return result

    # ------------------------------------------------------------------ mapowanie
    def accounts(self) -> list[AccountData]:
        """Zwraca listę ``AccountData`` (jeden na konto wejściowe)."""
        return [AccountData.from_json(raw) for raw in self._raw_accounts]

    def first(self) -> AccountData:
        """Pierwsze konto (wygoda dla wejścia jednoprofilowego)."""
        return AccountData.from_json(self._raw_accounts[0])

    @staticmethod
    def _connections(raw: Mapping[str, Any]) -> list[tuple[str, int]]:
        """Wyłuskuje powiązania ``[{"username","count"}]`` -> ``[(username, count)]``."""
        conns = raw.get("connections")
        out: list[tuple[str, int]] = []
        if isinstance(conns, Sequence) and not isinstance(conns, (str, bytes)):
            for c in conns:
                if isinstance(c, Mapping) and c.get("username"):
                    out.append((str(c["username"]).lower().lstrip("@"), _as_count(c.get("count"))))
        return out

    def to_social_graph(self) -> "Any":
        """Buduje ``SocialGraph`` ze wszystkich kont (posty + connections).

        Import ``SocialGraph`` jest leniwy — wymaga ``networkx``.
        """
        from .graph_schema import SocialGraph

        graph = SocialGraph()
        for raw in self._raw_accounts:
            account = AccountData.from_json(raw)
            graph.ingest_account(account)
            for target, weight in self._connections(raw):
                graph.add_mention(account.username, target, weight=weight)
        return graph

    def metrics(self) -> dict[str, EngagementMetrics]:
        """Metryki zaangażowania per konto (klucz = username)."""
        engine = MetricsEngine()
        return {acc.username: engine.compute_for_account(acc) for acc in self.accounts()}

    def __len__(self) -> int:
        return len(self._raw_accounts)
