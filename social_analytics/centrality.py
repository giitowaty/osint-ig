"""Centralności grafowe i analiza wpływu węzłów (NetworkX).

Liczy PageRank, Betweenness, Degree i Eigenvector centrality, a następnie
klasyfikuje węzły wg rodzaju wpływu: ``hub``, ``bridge``, ``connector``,
``peripheral``.

Obsługa błędów: miary, które dla zdegenerowanych grafów (brak zbieżności,
rozspójność) nie dają się policzyć, domyślnie zwracają wartości zerowe
(``strict=False``). Z ``strict=True`` wyjątek jest podnoszony. Pusty graf zawsze
powoduje jawny ``ValueError``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Iterable

try:
    import networkx as nx
except ModuleNotFoundError as exc:  # pragma: no cover
    raise ModuleNotFoundError(
        "Moduł centrality wymaga pakietu 'networkx' (pip install networkx[default])."
    ) from exc

__all__ = ["NodeInfluence", "MEASURES", "compute_centralities", "rank_influential"]

MEASURES: tuple[str, ...] = ("pagerank", "betweenness", "degree", "eigenvector")


@dataclass(frozen=True, slots=True)
class NodeInfluence:
    """Zagregowany profil wpływu pojedynczego węzła."""

    node: str
    kind: str
    pagerank: float
    betweenness: float
    degree: float
    eigenvector: float
    score: float          # łączny wskaźnik ważności 0..1
    influence: str        # "hub" | "bridge" | "connector" | "peripheral"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _one_measure(graph: "nx.DiGraph[str]", measure: str, strict: bool) -> dict[str, float]:
    """Liczy pojedynczą miarę; przy degeneracji zwraca zera (chyba że ``strict``)."""
    if measure == "degree":
        return nx.degree_centrality(graph)  # czysto kombinatoryczne, nie zawodzi
    try:
        if measure == "pagerank":
            return nx.pagerank(graph, weight="weight")
        if measure == "betweenness":
            return nx.betweenness_centrality(graph, weight="weight", normalized=True)
        if measure == "eigenvector":
            return nx.eigenvector_centrality(graph, max_iter=1000, tol=1e-6, weight="weight")
    except Exception:
        if strict:
            raise
        return {node: 0.0 for node in graph.nodes()}
    raise ValueError(f"Nieznana miara centralności: {measure!r}")  # pragma: no cover


def compute_centralities(
    graph: "nx.DiGraph[str]",
    measures: Iterable[str] | None = None,
    *,
    strict: bool = False,
) -> dict[str, dict[str, float]]:
    """Zwraca słownik ``{miara: {węzeł: wartość}}``.

    Raises:
        ValueError: gdy graf jest pusty lub podano nieznaną miarę.
    """
    if graph.number_of_nodes() == 0:
        raise ValueError("Graf jest pusty — brak węzłów do analizy centralności.")
    selected = tuple(measures) if measures is not None else MEASURES
    unknown = [m for m in selected if m not in MEASURES]
    if unknown:
        raise ValueError(f"Nieznane miary centralności: {unknown}. Dozwolone: {list(MEASURES)}")
    return {m: _one_measure(graph, m, strict) for m in selected}


def _normalize(values: dict[str, float]) -> dict[str, float]:
    """Skaluje wartości do zakresu 0..1 względem maksimum."""
    top = max(values.values(), default=0.0)
    if top <= 0:
        return {k: 0.0 for k in values}
    return {k: v / top for k, v in values.items()}


def _label(score: float, betweenness_n: float, degree_n: float) -> str:
    """Przypisuje rodzaj wpływu na podstawie znormalizowanych miar."""
    if betweenness_n >= 0.60 and betweenness_n > degree_n:
        return "bridge"      # łącznik między skupiskami (wysoka pośredniość)
    if score >= 0.60:
        return "hub"         # węzeł o dużej wadze/liczbie połączeń
    if score <= 0.15:
        return "peripheral"  # węzeł peryferyjny
    return "connector"


def rank_influential(
    graph: "nx.DiGraph[str]",
    top: int = 10,
    *,
    strict: bool = False,
) -> list[NodeInfluence]:
    """Ranking top-N najważniejszych węzłów z rodzajem wpływu.

    ``score`` = 0.5·PageRank + 0.3·Degree + 0.2·Eigenvector (każda znormalizowana).

    Raises:
        ValueError: gdy ``top`` <= 0 lub graf jest pusty.
    """
    if top <= 0:
        raise ValueError("top musi być dodatnie.")
    cents = compute_centralities(graph, strict=strict)
    pr, bw, dg, ev = cents["pagerank"], cents["betweenness"], cents["degree"], cents["eigenvector"]
    prn, bwn, dgn, evn = _normalize(pr), _normalize(bw), _normalize(dg), _normalize(ev)

    results: list[NodeInfluence] = []
    for node, data in graph.nodes(data=True):
        score = 0.5 * prn[node] + 0.3 * dgn[node] + 0.2 * evn[node]
        results.append(
            NodeInfluence(
                node=node,
                kind=str(data.get("kind", "account")),
                pagerank=pr[node],
                betweenness=bw[node],
                degree=dg[node],
                eigenvector=ev[node],
                score=score,
                influence=_label(score, bwn[node], dgn[node]),
            )
        )
    results.sort(key=lambda r: r.score, reverse=True)
    return results[:top]
