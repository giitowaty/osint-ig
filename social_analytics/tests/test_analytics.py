"""Testy jednostkowe pakietu social_analytics (biblioteka standardowa + unittest).

Uruchomienie:
    python -m unittest discover -s social_analytics/tests
"""

from __future__ import annotations

import unittest

from social_analytics import (
    AccountData,
    LexiconTopicClassifier,
    MetricsEngine,
    Post,
    Profile,
    classify_posts,
    extract_hashtags,
    extract_mentions,
)

try:
    from social_analytics import SocialGraph
    HAS_NX = True
except ModuleNotFoundError:  # pragma: no cover
    HAS_NX = False


class ModelsTest(unittest.TestCase):
    def test_extract_hashtags_and_mentions(self) -> None:
        text = "Góry o wschodzie #travel #Nature z @mountain_guide i @foo.bar"
        self.assertEqual(extract_hashtags(text), ["travel", "nature"])
        self.assertEqual(extract_mentions(text), ["mountain_guide", "foo.bar"])

    def test_extract_empty(self) -> None:
        self.assertEqual(extract_hashtags(None), [])
        self.assertEqual(extract_mentions(""), [])

    def test_post_autofills_from_caption(self) -> None:
        p = Post(caption="hello #sun #sea @alice", likes=10, comments=2)
        self.assertEqual(p.hashtags, ["sun", "sea"])
        self.assertEqual(p.mentions, ["alice"])
        self.assertEqual(p.engagement, 12)

    def test_post_from_json_handles_missing(self) -> None:
        p = Post.from_json({"caption": "x #ab", "likes": "oops"})
        self.assertIsNone(p.likes)  # „oops” -> None, bez wyjątku
        self.assertEqual(p.hashtags, ["ab"])

    def test_post_from_json_type_error(self) -> None:
        with self.assertRaises(TypeError):
            Post.from_json(["not", "a", "dict"])  # type: ignore[arg-type]

    def test_profile_requires_username(self) -> None:
        with self.assertRaises(ValueError):
            Profile.from_json({"full_name": "no username"})

    def test_account_data_from_json(self) -> None:
        acc = AccountData.from_json({
            "profile": {"username": "@Demo", "followers": 1000},
            "posts": [{"caption": "a #x", "likes": 5, "comments": 1}],
        })
        self.assertEqual(acc.username, "demo")
        self.assertEqual(len(acc.posts), 1)


class NlpTest(unittest.TestCase):
    def test_lexicon_classify_basic(self) -> None:
        clf = LexiconTopicClassifier()
        scores = clf.classify("Amazing #travel trip, exploring nature and mountains")
        cats = [s.category for s in scores]
        self.assertIn("Travel", cats)
        self.assertIn("Nature", cats)

    def test_classify_empty_text(self) -> None:
        self.assertEqual(LexiconTopicClassifier().classify(""), [])

    def test_scores_sum_to_one(self) -> None:
        scores = LexiconTopicClassifier().classify("tech ai startup #travel")
        self.assertAlmostEqual(sum(s.score for s in scores), 1.0, places=6)

    def test_classify_posts_aggregate(self) -> None:
        posts = [
            Post(caption="#travel #nature mountains"),
            Post(caption="#food foodie recipe"),
        ]
        cats = [s.category for s in classify_posts(posts)]
        self.assertIn("Travel", cats)
        self.assertIn("Food", cats)

    def test_classify_posts_accepts_dicts(self) -> None:
        res = classify_posts([{"caption": "gym workout fitness #health"}])
        self.assertTrue(res and res[0].category == "Fitness")

    def test_custom_lexicon(self) -> None:
        clf = LexiconTopicClassifier({"Cats": ("cat", "kitten")})
        res = clf.classify("my cat and a kitten")
        self.assertEqual(res[0].category, "Cats")
        self.assertEqual(res[0].hits, 2)

    def test_empty_lexicon_raises(self) -> None:
        with self.assertRaises(ValueError):
            LexiconTopicClassifier({})


class MetricsTest(unittest.TestCase):
    def test_engagement_rate(self) -> None:
        m = MetricsEngine().compute([{"likes": 100, "comments": 10}], followers=1000)
        self.assertAlmostEqual(m.engagement_rate_pct, 11.0, places=6)
        self.assertEqual(m.total_likes, 100)
        self.assertEqual(m.posts_analyzed, 1)

    def test_no_followers_no_rate(self) -> None:
        m = MetricsEngine().compute([{"likes": 10, "comments": 1}], followers=0)
        self.assertIsNone(m.engagement_rate)  # brak dzielenia przez zero

    def test_missing_values(self) -> None:
        m = MetricsEngine().compute([{"likes": None, "comments": None}], followers=100)
        self.assertEqual(m.posts_analyzed, 1)
        self.assertIsNone(m.avg_likes)

    def test_media_type_distribution_and_top(self) -> None:
        m = MetricsEngine().compute([
            {"shortcode": "A", "likes": 50, "comments": 5, "type": "image"},
            {"shortcode": "B", "likes": 90, "comments": 3, "type": "video"},
        ], followers=1000)
        self.assertEqual(m.media_type_distribution, {"image": 1, "video": 1})
        self.assertEqual(m.top_post_shortcode, "B")

    def test_type_error(self) -> None:
        with self.assertRaises(TypeError):
            MetricsEngine().compute("not a list")  # type: ignore[arg-type]

    def test_compute_for_account(self) -> None:
        acc = AccountData.from_json({
            "profile": {"username": "x", "followers": 2000},
            "posts": [{"likes": 200, "comments": 20}],
        })
        m = MetricsEngine().compute_for_account(acc)
        self.assertAlmostEqual(m.engagement_rate_pct, 11.0, places=6)


@unittest.skipUnless(HAS_NX, "networkx niezainstalowany")
class GraphTest(unittest.TestCase):
    def test_mentions_and_accounts(self) -> None:
        g = SocialGraph()
        g.add_mention("alice", "bob", weight=2)
        g.add_mention("alice", "bob")  # akumulacja wagi
        self.assertEqual(g.number_of_accounts, 2)
        self.assertEqual(g.most_mentioned(1), [("bob", 3)])

    def test_self_mention_ignored(self) -> None:
        g = SocialGraph()
        g.add_mention("alice", "alice")
        self.assertEqual(g.most_mentioned(5), [])

    def test_hashtag_usage_and_projection(self) -> None:
        g = SocialGraph()
        g.add_hashtag_usage("alice", "travel")
        g.add_hashtag_usage("bob", "travel")
        g.add_hashtag_usage("bob", "food")
        proj = g.shared_hashtag_graph()
        self.assertTrue(proj.has_edge("alice", "bob"))
        self.assertEqual(proj.edges["alice", "bob"]["weight"], 1)

    def test_ingest_post_extracts(self) -> None:
        g = SocialGraph()
        g.ingest_post("alice", "trip #travel with @bob", tagged=["brand"])
        self.assertIn("bob", g.accounts())
        self.assertIn("travel", g.hashtags())
        self.assertEqual(dict(g.most_mentioned(5)).get("bob"), 1)

    def test_node_link_serializable(self) -> None:
        import json
        g = SocialGraph()
        g.ingest_post("alice", "#x with @bob")
        payload = g.to_node_link()
        json.dumps(payload)  # nie rzuca
        self.assertIn("nodes", payload)

    def test_add_account_empty_raises(self) -> None:
        with self.assertRaises(ValueError):
            SocialGraph().add_account("")


if __name__ == "__main__":
    unittest.main()
