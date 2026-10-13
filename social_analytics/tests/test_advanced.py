"""Testy: centralności, JSONDataAdapter, Neo4jExporter.

Uruchomienie:
    python -m unittest discover -s social_analytics/tests -t .
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from social_analytics import JSONDataAdapter, MetricsEngine

try:
    from social_analytics import Neo4jExporter, SocialGraph
    from social_analytics.centrality import (
        MEASURES,
        NodeInfluence,
        compute_centralities,
        detect_communities,
        rank_influential,
    )
    HAS_NX = True
except ModuleNotFoundError:  # pragma: no cover
    HAS_NX = False


SAMPLE = {
    "profile": {"username": "alice", "followers": 1000, "full_name": "Alice A."},
    "posts": [
        {"caption": "trip #travel with @bob and @carol", "likes": 100, "comments": 10, "type": "image"},
        {"caption": "food #food @bob", "likes": 200, "comments": 20, "type": "carousel"},
    ],
    "connections": [{"username": "bob", "count": 3}, {"username": "dave", "count": 1}],
}


@unittest.skipUnless(HAS_NX, "networkx niezainstalowany")
class CentralityTest(unittest.TestCase):
    def _graph(self) -> "SocialGraph":
        g = SocialGraph()
        g.add_mention("a", "b", 2)
        g.add_mention("b", "c")
        g.add_mention("c", "d")
        g.add_mention("d", "e")
        return g

    def test_compute_all_measures(self) -> None:
        cents = compute_centralities(self._graph().graph)
        self.assertEqual(set(cents), set(MEASURES))
        for scores in cents.values():
            self.assertEqual(len(scores), 5)

    def test_empty_graph_raises(self) -> None:
        with self.assertRaises(ValueError):
            compute_centralities(SocialGraph().graph)

    def test_unknown_measure_raises(self) -> None:
        with self.assertRaises(ValueError):
            compute_centralities(self._graph().graph, measures=["nope"])

    def test_rank_sorted_and_labeled(self) -> None:
        ranking = rank_influential(self._graph().graph, top=5)
        self.assertEqual(len(ranking), 5)
        self.assertTrue(all(isinstance(r, NodeInfluence) for r in ranking))
        scores = [r.score for r in ranking]
        self.assertEqual(scores, sorted(scores, reverse=True))
        allowed = {"hub", "bridge", "connector", "peripheral"}
        self.assertTrue(all(r.influence in allowed for r in ranking))

    def test_bridge_detected(self) -> None:
        # Dwa trójkąty (gęste skupiska) połączone węzłem-łącznikiem 'g' o niskim
        # stopniu, ale najwyższej pośredniości -> klasyczny most.
        g = SocialGraph()
        triangles = [
            ("a", "b"), ("b", "a"), ("a", "c"), ("c", "a"), ("b", "c"), ("c", "b"),
            ("d", "e"), ("e", "d"), ("d", "f"), ("f", "d"), ("e", "f"), ("f", "e"),
        ]
        for s, t in triangles:
            g.add_mention(s, t)
        g.add_mention("c", "g")
        g.add_mention("g", "d")
        ranking = rank_influential(g.graph, top=20)
        by_node = {r.node: r.influence for r in ranking}
        self.assertEqual(by_node["g"], "bridge")

    def test_rank_top_must_be_positive(self) -> None:
        with self.assertRaises(ValueError):
            rank_influential(self._graph().graph, top=0)

    def test_detect_communities_two_clusters(self) -> None:
        # Dwa trójkąty połączone jednym łącznikiem -> co najmniej 2 społeczności,
        # a węzły z tego samego trójkąta powinny trafić do tej samej grupy.
        g = SocialGraph()
        for s, t in [("a", "b"), ("b", "c"), ("c", "a"), ("d", "e"), ("e", "f"), ("f", "d")]:
            g.add_mention(s, t)
        g.add_mention("c", "d")
        comm = detect_communities(g.graph)
        self.assertEqual(set(comm), {"a", "b", "c", "d", "e", "f"})
        self.assertGreaterEqual(max(comm.values()) + 1, 2)

    def test_detect_communities_empty(self) -> None:
        self.assertEqual(detect_communities(SocialGraph().graph), {})

    def test_node_influence_to_dict(self) -> None:
        r = rank_influential(self._graph().graph, top=1)[0]
        d = r.to_dict()
        self.assertIn("influence", d)
        self.assertIn("pagerank", d)


class JSONDataAdapterTest(unittest.TestCase):
    def test_from_obj_single_account(self) -> None:
        adapter = JSONDataAdapter.from_obj(SAMPLE)
        accounts = adapter.accounts()
        self.assertEqual(len(accounts), 1)
        self.assertEqual(accounts[0].username, "alice")

    def test_from_string(self) -> None:
        adapter = JSONDataAdapter.from_string(json.dumps(SAMPLE))
        self.assertEqual(adapter.first().username, "alice")

    def test_bad_json_raises(self) -> None:
        with self.assertRaises(ValueError):
            JSONDataAdapter.from_string("{not json")

    def test_missing_file_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            JSONDataAdapter.from_file("/nonexistent/path/data.json")

    def test_from_file_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "d.json"
            p.write_text(json.dumps(SAMPLE), encoding="utf-8")
            adapter = JSONDataAdapter.from_file(p)
            self.assertEqual(len(adapter), 1)

    def test_list_and_accounts_key(self) -> None:
        self.assertEqual(len(JSONDataAdapter.from_obj([SAMPLE, SAMPLE])), 2)
        self.assertEqual(len(JSONDataAdapter.from_obj({"accounts": [SAMPLE]})), 1)

    def test_wrong_type_raises(self) -> None:
        with self.assertRaises(TypeError):
            JSONDataAdapter.from_obj(42)  # type: ignore[arg-type]

    def test_empty_raises(self) -> None:
        with self.assertRaises(ValueError):
            JSONDataAdapter.from_obj([])

    def test_metrics_mapping(self) -> None:
        metrics = JSONDataAdapter.from_obj(SAMPLE).metrics()
        self.assertIn("alice", metrics)
        self.assertEqual(metrics["alice"].total_likes, 300)

    @unittest.skipUnless(HAS_NX, "networkx niezainstalowany")
    def test_to_social_graph_includes_connections(self) -> None:
        g = JSONDataAdapter.from_obj(SAMPLE).to_social_graph()
        self.assertIn("alice", g.accounts())
        self.assertIn("bob", g.accounts())
        # bob: 2x wzmianka w opisach + 3x z connections = 5
        self.assertEqual(dict(g.most_mentioned(10)).get("bob"), 5)


@unittest.skipUnless(HAS_NX, "networkx niezainstalowany")
class Neo4jExporterTest(unittest.TestCase):
    def _graph(self) -> "SocialGraph":
        g = SocialGraph()
        g.ingest_post("alice", "trip #travel with @bob", tagged=[])
        g.add_account("alice", full_name="Alice O'Brien", followers=1000)
        return g

    def test_statements_contain_nodes_and_rels(self) -> None:
        text = Neo4jExporter(self._graph()).to_cypher()
        self.assertIn("MERGE (a:Account {username: 'alice'})", text)
        self.assertIn(":Hashtag {tag: 'travel'}", text)
        self.assertIn("MENTIONS", text)
        self.assertIn("USES_HASHTAG", text)
        self.assertTrue(text.strip().endswith(";"))

    def test_string_escaping(self) -> None:
        text = Neo4jExporter(self._graph()).to_cypher()
        self.assertIn("O\\'Brien", text)  # apostrof zescapowany

    def test_parameterized(self) -> None:
        params = Neo4jExporter(self._graph()).parameterized()
        self.assertTrue(all(isinstance(q, str) and isinstance(p, dict) for q, p in params))
        # pierwsza instrukcja to MERGE konta z parametrem username
        node_q = [p for q, p in params if "username" in p]
        self.assertTrue(any(p.get("username") == "alice" for p in node_q))

    def test_write_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Neo4jExporter(self._graph()).write(Path(tmp) / "g.cypher")
            self.assertTrue(out.is_file())
            self.assertIn("MERGE", out.read_text(encoding="utf-8"))

    def test_wrong_type_raises(self) -> None:
        with self.assertRaises(TypeError):
            Neo4jExporter({"not": "a graph"})  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
