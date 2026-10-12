"""Eksport ``SocialGraph`` do zapytań Cypher / bazy grafowej Neo4j.

Mapowanie:

* węzły: ``(:Account {username, full_name?, followers?, category?})``,
  ``(:Hashtag {tag})``,
* relacje: ``-[:MENTIONS {weight}]->`` (account→account),
  ``-[:USES_HASHTAG {weight}]->`` (account→hashtag).

Generator produkuje idempotentne ``MERGE`` i udostępnia dwa tryby:

* **literalny** (``to_cypher``/``write``) — gotowy skrypt ``.cypher`` z wartościami
  wstawionymi i poprawnie zescapowanymi,
* **parametryzowany** (``parameterized``) — pary ``(zapytanie, parametry)`` do
  wykonania przez oficjalny sterownik ``neo4j`` (bez wstrzykiwania wartości).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .graph_schema import ACCOUNT, HASHTAG, REL_MENTION, REL_USES, SocialGraph

__all__ = ["Neo4jExporter"]

_REL_LABEL = {REL_MENTION: "MENTIONS", REL_USES: "USES_HASHTAG"}


def _cypher_literal(value: Any) -> str:
    """Zamienia wartość Pythona na literał Cypher (z escapingiem łańcuchów)."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    text = str(value).replace("\\", "\\\\").replace("'", "\\'")
    return f"'{text}'"


class Neo4jExporter:
    """Transformuje ``SocialGraph`` na Cypher (literalny lub parametryzowany)."""

    def __init__(self, graph: SocialGraph) -> None:
        if not isinstance(graph, SocialGraph):
            raise TypeError("Neo4jExporter oczekuje obiektu SocialGraph.")
        self._graph = graph
        self._g = graph.graph

    # ------------------------------------------------------- właściwości węzłów
    @staticmethod
    def _account_props(node: str, data: dict[str, Any]) -> dict[str, Any]:
        props: dict[str, Any] = {"username": node}
        for key in ("full_name", "followers", "category"):
            value = data.get(key)
            if value not in (None, "", []):
                props[key] = value
        return props

    # ------------------------------------------------------------ tryb literalny
    def statements(self) -> list[str]:
        """Lista instrukcji Cypher (węzły, potem relacje)."""
        lines: list[str] = []

        for node, data in self._g.nodes(data=True):
            kind = data.get("kind")
            if kind == ACCOUNT:
                props = self._account_props(node, data)
                assigns = ", ".join(f"a.{k} = {_cypher_literal(v)}" for k, v in props.items() if k != "username")
                stmt = f"MERGE (a:Account {{username: {_cypher_literal(node)}}})"
                if assigns:
                    stmt += f" SET {assigns}"
                lines.append(stmt)
            elif kind == HASHTAG:
                tag = data.get("tag", str(node).lstrip("#"))
                lines.append(f"MERGE (:Hashtag {{tag: {_cypher_literal(tag)}}})")

        for src, dst, data in self._g.edges(data=True):
            relation = data.get("relation")
            label = _REL_LABEL.get(relation)
            if label is None:
                continue
            weight = _cypher_literal(data.get("weight", 1))
            if relation == REL_MENTION:
                lines.append(
                    f"MATCH (s:Account {{username: {_cypher_literal(src)}}}), "
                    f"(t:Account {{username: {_cypher_literal(dst)}}}) "
                    f"MERGE (s)-[r:{label}]->(t) SET r.weight = {weight}"
                )
            elif relation == REL_USES:
                tag = self._g.nodes[dst].get("tag", str(dst).lstrip("#"))
                lines.append(
                    f"MATCH (a:Account {{username: {_cypher_literal(src)}}}), "
                    f"(h:Hashtag {{tag: {_cypher_literal(tag)}}}) "
                    f"MERGE (a)-[r:{label}]->(h) SET r.weight = {weight}"
                )
        return lines

    def to_cypher(self, *, statement_terminator: str = ";") -> str:
        """Pełny skrypt Cypher jako jeden łańcuch."""
        return "\n".join(f"{s}{statement_terminator}" for s in self.statements())

    def write(self, path: str | Path) -> Path:
        """Zapisuje skrypt ``.cypher`` do pliku; zwraca ścieżkę."""
        p = Path(path)
        p.write_text(self.to_cypher() + "\n", encoding="utf-8")
        return p

    # --------------------------------------------------- tryb parametryzowany
    def parameterized(self) -> list[tuple[str, dict[str, Any]]]:
        """Pary ``(zapytanie, parametry)`` do wykonania przez sterownik neo4j.

        Bezpieczniejsze niż literały — wartości jadą jako parametry, nie w tekście.
        """
        out: list[tuple[str, dict[str, Any]]] = []

        for node, data in self._g.nodes(data=True):
            kind = data.get("kind")
            if kind == ACCOUNT:
                props = self._account_props(node, data)
                extra = {k: v for k, v in props.items() if k != "username"}
                query = "MERGE (a:Account {username: $username})"
                if extra:
                    query += " SET " + ", ".join(f"a.{k} = ${k}" for k in extra)
                out.append((query, props))
            elif kind == HASHTAG:
                tag = data.get("tag", str(node).lstrip("#"))
                out.append(("MERGE (:Hashtag {tag: $tag})", {"tag": tag}))

        for src, dst, data in self._g.edges(data=True):
            relation = data.get("relation")
            label = _REL_LABEL.get(relation)
            if label is None:
                continue
            weight = data.get("weight", 1)
            if relation == REL_MENTION:
                out.append((
                    "MATCH (s:Account {username: $src}), (t:Account {username: $dst}) "
                    f"MERGE (s)-[r:{label}]->(t) SET r.weight = $weight",
                    {"src": src, "dst": dst, "weight": weight},
                ))
            elif relation == REL_USES:
                tag = self._g.nodes[dst].get("tag", str(dst).lstrip("#"))
                out.append((
                    "MATCH (a:Account {username: $src}), (h:Hashtag {tag: $tag}) "
                    f"MERGE (a)-[r:{label}]->(h) SET r.weight = $weight",
                    {"src": src, "tag": tag, "weight": weight},
                ))
        return out
