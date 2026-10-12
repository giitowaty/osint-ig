"""Struktura danych grafowych dla relacji w sieci społecznościowej.

Model grafu (skierowany, ``networkx.DiGraph``):

* **Węzły** mają atrybut ``kind``:
  - ``"account"`` — konto (``@username``),
  - ``"hashtag"`` — hashtag (``#tag``).
* **Krawędzie** mają atrybut ``relation`` oraz ``weight`` (akumulowany):
  - ``"mention"`` — ``account -> account`` (A wspomina B),
  - ``"uses"``    — ``account -> hashtag`` (konto użyło hashtagu).

Dodatkowo ``shared_hashtag_graph()`` zwraca nieskierowaną projekcję
konto–konto, w której waga krawędzi = liczba wspólnych hashtagów.

Zależność: ``networkx`` (patrz ``requirements.txt``).
"""

from __future__ import annotations

from typing import Any, Iterable

try:
    import networkx as nx
except ModuleNotFoundError as exc:  # pragma: no cover - zależność opcjonalna przy imporcie
    raise ModuleNotFoundError(
        "Moduł graph_schema wymaga pakietu 'networkx' (pip install networkx)."
    ) from exc

from .models import AccountData, Post, extract_hashtags, extract_mentions

__all__ = ["SocialGraph"]

ACCOUNT = "account"
HASHTAG = "hashtag"
REL_MENTION = "mention"
REL_USES = "uses"


def _norm(name: str) -> str:
    return str(name or "").strip().lower().lstrip("@#")


class SocialGraph:
    """Graf relacji oznaczeń (@mentions) i użycia hashtagów.

    Przykład:
        >>> g = SocialGraph()
        >>> g.add_mention("alice", "bob", weight=2)
        >>> g.add_hashtag_usage("alice", "travel")
        >>> g.number_of_accounts
        2
    """

    def __init__(self) -> None:
        self._g: "nx.DiGraph[str]" = nx.DiGraph()

    # ------------------------------------------------------------------ węzły
    def add_account(self, username: str, **meta: Any) -> str:
        """Dodaje (lub aktualizuje) węzeł konta. Zwraca znormalizowany id."""
        uid = _norm(username)
        if not uid:
            raise ValueError("username nie może być pusty.")
        if self._g.has_node(uid):
            self._g.nodes[uid].update(meta)
        else:
            self._g.add_node(uid, kind=ACCOUNT, **meta)
        return uid

    def _add_hashtag_node(self, tag: str) -> str:
        tid = _norm(tag)
        if not tid:
            raise ValueError("hashtag nie może być pusty.")
        node = f"#{tid}"
        if not self._g.has_node(node):
            self._g.add_node(node, kind=HASHTAG, tag=tid)
        return node

    # --------------------------------------------------------------- krawędzie
    def _bump_edge(self, src: str, dst: str, relation: str, weight: int) -> None:
        if self._g.has_edge(src, dst):
            data = self._g.edges[src, dst]
            if data.get("relation") == relation:
                data["weight"] = data.get("weight", 0) + weight
                return
        self._g.add_edge(src, dst, relation=relation, weight=weight)

    def add_mention(self, source: str, target: str, weight: int = 1) -> None:
        """Dodaje relację ``source -> target`` (źródło wspomina cel)."""
        if weight <= 0:
            raise ValueError("weight musi być dodatnie.")
        s, t = self.add_account(source), self.add_account(target)
        if s == t:
            return  # pomijamy autowzmianki
        self._bump_edge(s, t, REL_MENTION, weight)

    def add_hashtag_usage(self, username: str, hashtag: str, weight: int = 1) -> None:
        """Dodaje relację ``account -> hashtag`` (konto użyło hashtagu)."""
        if weight <= 0:
            raise ValueError("weight musi być dodatnie.")
        u = self.add_account(username)
        h = self._add_hashtag_node(hashtag)
        self._bump_edge(u, h, REL_USES, weight)

    # ---------------------------------------------------------------- ingest
    def ingest_post(
        self,
        username: str,
        caption: str | None = None,
        *,
        hashtags: Iterable[str] | None = None,
        mentions: Iterable[str] | None = None,
        tagged: Iterable[str] | None = None,
    ) -> None:
        """Dokłada do grafu jeden post: wzmianki, oznaczenia i hashtagi.

        Jeśli ``hashtags``/``mentions`` nie podano, są wyłuskane z ``caption``.
        """
        u = self.add_account(username)
        tags = list(hashtags) if hashtags is not None else extract_hashtags(caption)
        ments = list(mentions) if mentions is not None else extract_mentions(caption)
        for m in ments:
            self.add_mention(u, m)
        for t in tagged or []:
            self.add_mention(u, t)  # oznaczenie na zdjęciu traktujemy jak wzmiankę
        for tag in tags:
            self.add_hashtag_usage(u, tag)

    def ingest_account(self, account: AccountData) -> None:
        """Dokłada całe konto wraz z jego postami."""
        self.add_account(
            account.username,
            full_name=account.profile.full_name,
            followers=account.profile.followers,
            category=account.profile.category,
        )
        for post in account.posts:
            self._ingest_post_obj(account.username, post)

    def _ingest_post_obj(self, username: str, post: Post) -> None:
        for m in post.mentions:
            self.add_mention(username, m)
        for t in post.tagged:
            self.add_mention(username, t)
        for tag in post.hashtags:
            self.add_hashtag_usage(username, tag)

    # ---------------------------------------------------------------- projekcje
    def shared_hashtag_graph(self) -> "nx.Graph[str]":
        """Nieskierowana projekcja konto–konto po wspólnych hashtagach.

        Waga krawędzi = liczba wspólnych hashtagów między dwoma kontami.
        """
        proj: "nx.Graph[str]" = nx.Graph()
        # mapa hashtag -> {konta, które go użyły}
        users_by_tag: dict[str, set[str]] = {}
        for src, dst, data in self._g.edges(data=True):
            if data.get("relation") == REL_USES:
                users_by_tag.setdefault(dst, set()).add(src)
        for account in self.accounts():
            proj.add_node(account)
        for accounts in users_by_tag.values():
            accs = sorted(accounts)
            for i in range(len(accs)):
                for j in range(i + 1, len(accs)):
                    a, b = accs[i], accs[j]
                    if proj.has_edge(a, b):
                        proj.edges[a, b]["weight"] += 1
                    else:
                        proj.add_edge(a, b, weight=1)
        return proj

    # ---------------------------------------------------------------- odczyt
    @property
    def graph(self) -> "nx.DiGraph[str]":
        """Surowy obiekt ``networkx.DiGraph`` (do dalszej analizy)."""
        return self._g

    def accounts(self) -> list[str]:
        return [n for n, d in self._g.nodes(data=True) if d.get("kind") == ACCOUNT]

    def hashtags(self) -> list[str]:
        return [d["tag"] for _, d in self._g.nodes(data=True) if d.get("kind") == HASHTAG]

    @property
    def number_of_accounts(self) -> int:
        return len(self.accounts())

    def most_mentioned(self, top: int = 10) -> list[tuple[str, int]]:
        """Konta najczęściej wspominane, wg sumy wag krawędzi ``mention``."""
        if top <= 0:
            raise ValueError("top musi być dodatnie.")
        scores: dict[str, int] = {}
        for _, dst, data in self._g.edges(data=True):
            if data.get("relation") == REL_MENTION:
                scores[dst] = scores.get(dst, 0) + data.get("weight", 0)
        return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:top]

    def to_node_link(self) -> dict[str, Any]:
        """Serializacja do formatu node-link (gotowe do ``json.dumps``)."""
        return nx.node_link_data(self._g, edges="links")

    # ---------------------------------------------------------------- centralności
    def centralities(
        self,
        measures: Iterable[str] | None = None,
        *,
        strict: bool = False,
    ) -> dict[str, dict[str, float]]:
        """Centralności węzłów (PageRank/Betweenness/Degree/Eigenvector).

        Zob. :mod:`social_analytics.centrality`. Podnosi ``ValueError`` dla pustego
        grafu lub nieznanej miary.
        """
        from .centrality import compute_centralities

        return compute_centralities(self._g, measures, strict=strict)

    def rank_influential(self, top: int = 10, *, strict: bool = False) -> list[Any]:
        """Ranking top-N najważniejszych węzłów z rodzajem wpływu (hub/bridge/…).

        Zwraca listę ``social_analytics.centrality.NodeInfluence``.
        """
        from .centrality import rank_influential

        return rank_influential(self._g, top, strict=strict)

    def __len__(self) -> int:
        return self._g.number_of_nodes()
