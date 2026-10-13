const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fetchProfileUser, resetCooldown, cooldownState } = require("./instagram");
const { buildPayload } = require("./normalize");
const { Trace } = require("./trace");

test("authenticated profile analysis uses current GraphQL and preserves media/statistics without viewer data", async () => {
  const previousFetch = global.fetch;
  const session = { cookie: "sessionid=123%3Asynthetic", csrf: "synthetic", userId: "123", names: ["sessionid"] };
  const trace = () => new Trace("profile-test");
  const html = '<script type="application/json">["DTSGInitialData",[],{"token":"synthetic-token"}],["LSD",[],{"token":"synthetic-lsd"}]</script>';
  const media = [1, 2, 8].map((type, i) => ({ node: {
    code: `post${i}`, media_type: type, user: { username: "test_account", pk: "456" },
    taken_at: 1700000000, like_count: i, comment_count: i + 1, view_count: type === 2 ? 77 : null,
    image_versions2: { candidates: [{ url: "https://cdn.example.com/image.jpg" }] },
    caption: { text: "#technology @partner" }, usertags: { in: [{ user: { username: "tagged" } }] },
    coauthor_producers: [{ username: "coauthor" }], organic_tracking_token: "discard-me",
  } }));
  const posts = { data: { xdt_api__v1__feed__user_timeline_graphql_connection: { edges: media },
    xdt_viewer: { user: { username: "private_viewer", secret: "discard-me" } } } };
  const details = { data: { user: { pk: "456", username: "test_account", full_name: "Test Account", biography: "Technology",
    follower_count: 100, following_count: 7, media_count: 30, category: "Technology", is_verified: true },
    viewer: { user: { username: "private_viewer" } } } };
  const response = (payload) => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  let requests = [];
  try {
    global.fetch = async (url, options) => {
      requests.push(url);
      assert.equal(options.headers.Cookie, session.cookie);
      if (url.endsWith("/test_account/")) return new Response(html, { headers: { "content-type": "text/html" } });
      assert.equal(url, "https://www.instagram.com/graphql/query");
      assert.equal(options.method, "POST");
      assert.equal(options.headers["X-CSRFToken"], session.csrf);
      assert.equal(options.body.get("fb_dtsg"), "synthetic-token");
      const name = options.body.get("fb_api_req_friendly_name");
      return response(name === "PolarisProfilePostsQuery" ? posts : details);
    };
    const user = await fetchProfileUser(trace(), "test_account", session);
    const payload = buildPayload(user, "test_account");
    assert.equal(requests.length, 3);
    assert.equal(payload.profile.followers, 100);
    assert.equal(payload.profile.following, 7);
    assert.equal(payload.profile.posts, 30);
    assert.equal(payload.profile.category, "Technology");
    assert.deepEqual(payload.posts.map((p) => p.type), ["image", "video", "carousel"]);
    assert.equal(payload.posts[0].likes, 0);
    assert.equal(payload.posts[1].views, 77);
    assert.equal(payload.posts[0].takenAt, 1700000000000);
    assert.ok(payload.posts.every((p) => p.caption && p.thumbnail));
    assert.ok(payload.connections.some((c) => c.username === "tagged"));
    assert.ok(payload.content.topics);
    assert.ok(!JSON.stringify(user).includes("discard-me"));
    assert.ok(!JSON.stringify(user).includes("private_viewer"));

    global.fetch = async (url, options) => url.endsWith("/test_account/")
      ? new Response(html, { headers: { "content-type": "text/html" } })
      : response(options.body.get("fb_api_req_friendly_name") === "PolarisProfilePostsQuery" ? posts
        : { data: { user: { ...details.data.user, username: "different_account" } } });
    await assert.rejects(fetchProfileUser(trace(), "test_account", session), (e) => e.code === "IG_BAD_RESPONSE");

    global.fetch = async (url) => url.endsWith("/test_account/")
      ? new Response(html, { headers: { "content-type": "text/html" } })
      : new Response('for (;;);{"error":1357054,"secret":"synthetic-token"}', { headers: { "content-type": "application/x-javascript" } });
    await assert.rejects(fetchProfileUser(trace(), "test_account", session), (e) => e.code === "IG_BAD_RESPONSE" && !e.upstream.body && e.upstream.method === "POST");

    requests = [];
    global.fetch = async (url) => {
      requests.push(url);
      return url.endsWith("/test_account/") ? new Response(html, { headers: { "content-type": "text/html" } })
        : new Response("", { status: 429, headers: { "retry-after": "60" } });
    };
    await assert.rejects(fetchProfileUser(trace(), "test_account", session), (e) => e.code === "IG_RATE_LIMITED");
    assert.equal(requests.length, 2);
    assert.equal(cooldownState().active, true);
    await assert.rejects(fetchProfileUser(trace(), "test_account", session), (e) => e.code === "IG_RATE_LIMITED");
    assert.equal(requests.length, 2);
  } finally { global.fetch = previousFetch; resetCooldown(); }
});
