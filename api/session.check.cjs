const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fetchWhoami } = require("./instagram");
const { Trace } = require("./trace");

test("session verification uses authenticated viewer and keeps private response out of diagnostics", async () => {
  const originalFetch = global.fetch;
  const session = { cookie: "sessionid=123%3Asynthetic", csrf: "synthetic", userId: "123", names: ["sessionid"] };
  const response = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status, headers: { "content-type": "application/json", "x-ig-set-www-claim": "secret-claim" },
  });
  const trace = () => new Trace("session-test");
  try {
    global.fetch = async (url, options) => {
      assert.match(url, /graphql\/query\/\?query_hash=d6f4427fbe92d846298cf93df0b937d3/);
      assert.equal(options.headers.Cookie, session.cookie);
      assert.equal(options.headers["X-CSRFToken"], session.csrf);
      return response({ status: "ok", data: { user: { id: "123", username: "test_account", profile_pic_url: "", edge_web_feed_timeline: { private: true } } } });
    };
    const who = await fetchWhoami(trace(), session);
    assert.equal(who.username, "test_account");
    assert.equal(who.userId, "123");
    assert.equal(who.ok, true);
    assert.equal(who.edge_web_feed_timeline, undefined);
    global.fetch = async () => response({ status: "ok", data: { user: null } });
    await assert.rejects(fetchWhoami(trace(), session), (e) => e.code === "IG_SESSION_INVALID" && !e.upstream.body);
    global.fetch = async () => response({ status: "ok", data: { user: { id: "123", private: "sensitive" } } });
    await assert.rejects(fetchWhoami(trace(), session), (e) => e.code === "IG_BAD_RESPONSE" && !e.upstream.body && !e.upstream.headers["x-ig-set-www-claim"]);
    global.fetch = async () => response({ status: "fail", message: "challenge_required" }, 400);
    await assert.rejects(fetchWhoami(trace(), session), (e) => e.code === "IG_CHECKPOINT");
    global.fetch = async () => response({ status: "fail", message: "login_required" }, 401);
    await assert.rejects(fetchWhoami(trace(), session), (e) => e.code === "IG_SESSION_INVALID");
  } finally { global.fetch = originalFetch; }
});
