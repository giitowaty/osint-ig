"""Testy warstwy webowej (FastAPI TestClient) oraz potoku anal+integracji.

Uruchomienie:
    python -m unittest discover -s social_analytics/tests -t .
"""

from __future__ import annotations

import unittest

from social_analytics import analyze

try:
    from fastapi.testclient import TestClient

    from social_analytics.webapp.server import app
    HAS_WEB = True
except ModuleNotFoundError:  # pragma: no cover
    HAS_WEB = False


SAMPLE = {
    "profile": {"username": "alice", "followers": 1000, "full_name": "Alice A.", "category": "Travel"},
    "posts": [
        {"caption": "trip #travel with @bob", "likes": 100, "comments": 10, "type": "image"},
        {"caption": "food #food @carol", "likes": 200, "comments": 20, "type": "carousel"},
    ],
    "connections": [{"username": "bob", "count": 2}],
}


class PipelineTest(unittest.TestCase):
    def test_analyze_shape(self) -> None:
        res = analyze(SAMPLE)
        self.assertIn("primary", res)
        self.assertEqual(res["primary"]["profile"]["username"], "alice")
        self.assertAlmostEqual(res["primary"]["metrics"]["engagement_rate_pct"], 16.5, places=3)
        self.assertTrue(res["primary"]["topics"])  # Travel/Food wykryte
        self.assertTrue(res["graph_available"])
        self.assertIn("nodes", res["graph"])
        self.assertTrue(res["influence"])

    def test_analyze_invalid_input(self) -> None:
        with self.assertRaises(TypeError):
            analyze(42)  # type: ignore[arg-type]


@unittest.skipUnless(HAS_WEB, "FastAPI niezainstalowany")
class WebAppTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_index_html(self) -> None:
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("social_analytics", r.text)

    def test_sample_endpoint(self) -> None:
        r = self.client.get("/api/sample")
        self.assertEqual(r.status_code, 200)
        self.assertIn("profile", r.json())

    def test_analyze_endpoint(self) -> None:
        r = self.client.post("/api/analyze", json=SAMPLE)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["primary"]["profile"]["username"], "alice")
        self.assertTrue(body["graph_available"])

    def test_analyze_wrapped_in_data(self) -> None:
        r = self.client.post("/api/analyze", json={"data": SAMPLE})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["primary"]["profile"]["username"], "alice")

    def test_analyze_bad_payload(self) -> None:
        r = self.client.post("/api/analyze", json=42)
        self.assertEqual(r.status_code, 422)

    def test_static_js_served(self) -> None:
        r = self.client.get("/static/app.js")
        self.assertEqual(r.status_code, 200)
        self.assertIn("renderGraph", r.text)

    def test_fetch_requires_username(self) -> None:
        # pusty username -> 400 (zanim ruszy jakiekolwiek zapytanie sieciowe)
        r = self.client.get("/api/fetch?username=")
        self.assertEqual(r.status_code, 400)

    def test_normalize_ig_user(self) -> None:
        from social_analytics.webapp.server import _normalize_ig_user
        user = {
            "username": "demo", "full_name": "Demo", "is_verified": True,
            "category_name": "Photographer",
            "edge_followed_by": {"count": 500}, "edge_follow": {"count": 100},
            "edge_owner_to_timeline_media": {"count": 1, "edges": [
                {"node": {
                    "__typename": "GraphVideo", "shortcode": "AAA",
                    "edge_liked_by": {"count": 42}, "edge_media_to_comment": {"count": 7},
                    "edge_media_to_caption": {"edges": [{"node": {"text": "hi #travel @bob"}}]},
                    "accessibility_caption": "a photo",
                    "edge_media_to_tagged_user": {"edges": [{"node": {"user": {"username": "brand"}}}]},
                }},
            ]},
        }
        out = _normalize_ig_user(user)
        self.assertEqual(out["profile"]["username"], "demo")
        self.assertEqual(out["profile"]["followers"], 500)
        self.assertEqual(out["posts"][0]["type"], "video")
        self.assertEqual(out["posts"][0]["likes"], 42)
        self.assertEqual(out["posts"][0]["tagged"], ["brand"])
        self.assertIn("#travel", out["posts"][0]["caption"])


if __name__ == "__main__":
    unittest.main()
