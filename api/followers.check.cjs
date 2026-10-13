const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fetchFollowersPage, fetchProfileUser, resetCooldown } = require("./instagram");
const { Trace } = require("./trace");
const { buildPayload } = require("./normalize");

test("followers pages preserve IDs/cursors, report restricted lists and reject stalled pagination", async () => {
  const original = global.fetch;
  const session = { cookie: "sessionid=synthetic", csrf: "synthetic", userId: "9", names: ["sessionid"] };
  const trace = () => new Trace("followers-test");
  const response = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  try {
    global.fetch = async (url, options) => {
      assert.match(url, /friendships\/123\/followers\/\?count=50/);
      assert.equal(options.headers.Cookie, session.cookie);
      return response({ status: "ok", users: [{ pk: "456", username: "First_User", email: "discard-me" }, null], next_max_id: "next page" });
    };
    const first = await fetchFollowersPage(trace(), "source", "123", session, "", 100);
    assert.deepEqual(first.users, [{ username: "first_user", id: "456" }]);
    assert.equal(first.nextCursor, "next page");
    assert.equal(first.limited, false);
    global.fetch = async (url) => {
      assert.match(url, /max_id=next%20page/);
      return response({ status: "ok", users: [], has_more: false, should_limit_list_of_followers: true });
    };
    const last = await fetchFollowersPage(trace(), "source", "123", session, first.nextCursor);
    assert.equal(last.nextCursor, null);
    assert.equal(last.limited, true);
    global.fetch = async () => response({ users: [{ pk: "456", username: "first_user" }], next_max_id: "same" });
    await assert.rejects(fetchFollowersPage(trace(), "source", "123", session, "same"), (e) => e.code === "IG_BAD_RESPONSE");
    global.fetch = async () => response({ status: "fail", users: [] });
    await assert.rejects(fetchFollowersPage(trace(), "source", "123", session), (e) => e.code === "IG_BAD_RESPONSE");
    global.fetch = async () => new Response("", { status: 429 });
    await assert.rejects(fetchFollowersPage(trace(), "source", "123", session), (e) => e.code === "IG_RATE_LIMITED");
  } finally { global.fetch = original; resetCooldown(); }
});

test("known follower IDs allow public metadata analysis of private or empty accounts without fetching inaccessible posts", async () => {
  const original = global.fetch;
  const session = { cookie: "sessionid=synthetic", csrf: "synthetic", userId: "9", names: ["sessionid"] };
  let requests = 0;
  try {
    global.fetch = async (url, options) => {
      requests++;
      if (url.endsWith("/private_test/")) return new Response("<html></html>", { headers: { "content-type": "text/html" } });
      assert.equal(options.body.get("fb_api_req_friendly_name"), "PolarisProfilePageContentQuery");
      assert.equal(JSON.parse(options.body.get("variables")).id, "456");
      return new Response(JSON.stringify({ data: { user: { pk: "456", username: "private_test", is_private: true,
        media_count: 30, follower_count: 100, following_count: 50, friendship_status: { following: false } } } }),
      { headers: { "content-type": "application/json" } });
    };
    const user = await fetchProfileUser(new Trace("private-test"), "private_test", session, "456");
    const payload = buildPayload(user, "private_test");
    assert.equal(requests, 2);
    assert.equal(payload.profile.private, true);
    assert.equal(payload.profile.followers, 100);
    assert.equal(payload.profile.posts, 30);
    assert.deepEqual(payload.posts, []);
  } finally { global.fetch = original; }
});
