const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { fetchWhoami, resetCooldown } = require("./instagram");
const { Trace } = require("./trace");

const session = { cookie: "sessionid=123%3Asynthetic", csrf: "synthetic", userId: "123", names: ["sessionid"] };
const response = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { "content-type": "application/json", "x-ig-set-www-claim": "secret-claim" },
});
const trace = () => new Trace("session-test");
const INFO = "https://www.instagram.com/api/v1/users/123/info/";
const CURRENT = "https://www.instagram.com/api/v1/accounts/current_user/?edit=true";
const VIEWER = /graphql\/query\/\?query_hash=/;

let originalFetch;
let seen;
/** Udawany Instagram: `routes` mapuje metodę → odpowiedź (domyślnie 404). */
function fakeIg(routes) {
  global.fetch = async (url, options) => {
    assert.equal(options.headers.Cookie, session.cookie);
    assert.equal(options.headers["X-CSRFToken"], session.csrf);
    const key = url === INFO ? "info" : url === CURRENT ? "current" : VIEWER.test(url) ? "viewer" : "other";
    seen.push(key);
    const r = routes[key];
    return r ? r() : response({ status: "fail", message: "Page not found" }, 404);
  };
}
beforeEach(() => { originalFetch = global.fetch; seen = []; resetCooldown(); });
afterEach(() => { global.fetch = originalFetch; });

test("weryfikacja przez users/{id}/info: jedno zapytanie, tylko publiczne pola konta", async () => {
  fakeIg({ info: () => response({ status: "ok", user: { pk: "123", username: "test_account", full_name: "Test", profile_pic_url: "https://cdn/x.jpg",
    email: "prywatny@example.com", phone_number: "+48600000000" } }) });
  const who = await fetchWhoami(trace(), session);
  assert.deepEqual(who, { ok: true, username: "test_account", fullName: "Test", avatar: "https://cdn/x.jpg", userId: "123", cookies: ["sessionid"], via: "users/info" });
  assert.deepEqual(seen, ["info"]);
});

test("stare zapytanie query_hash wycofane (pusta odpowiedź): poprawna sesja i tak zostaje zweryfikowana", async () => {
  fakeIg({
    info: () => response({ status: "fail", message: "Page not found" }, 404),
    current: () => response({ status: "ok", user: { pk: "123", username: "test_account" } }),
    viewer: () => response({ status: "ok", data: { user: null } }),
  });
  const who = await fetchWhoami(trace(), session);
  assert.equal(who.username, "test_account");
  assert.equal(who.via, "current_user");
  assert.deepEqual(seen, ["info", "current"]);
});

test("ostatnia deska ratunku: stare zapytanie viewer, gdy nowsze metody nie zwracają konta", async () => {
  fakeIg({
    info: () => response({ status: "ok" }),
    current: () => response({ status: "ok" }),
    viewer: () => response({ status: "ok", data: { user: { id: "123", username: "test_account", edge_web_feed_timeline: { private: true } } } }),
  });
  const who = await fetchWhoami(trace(), session);
  assert.equal(who.via, "viewer");
  assert.equal(who.edge_web_feed_timeline, undefined);
  assert.deepEqual(seen, ["info", "current", "viewer"]);
});

test("users/{id}/info z innym kontem niż w ciasteczku nie jest akceptowane", async () => {
  fakeIg({
    info: () => response({ status: "ok", user: { pk: "999", username: "ktos_inny" } }),
    current: () => response({ status: "ok", user: { pk: "123", username: "test_account" } }),
  });
  assert.equal((await fetchWhoami(trace(), session)).username, "test_account");
});

test("brak ID w ciasteczku: pomija users/{id}/info", async () => {
  fakeIg({ current: () => response({ status: "ok", user: { pk: "5", username: "bez_id" } }) });
  const who = await fetchWhoami(trace(), { ...session, userId: null });
  assert.equal(who.username, "bez_id");
  assert.deepEqual(seen, ["current"]);
});

test("wylogowanie (401 login_required) przerywa od razu: sesja odrzucona, bez kolejnych zapytań", async () => {
  fakeIg({ info: () => response({ status: "fail", message: "login_required" }, 401) });
  await assert.rejects(fetchWhoami(trace(), session), (e) => e.code === "IG_SESSION_INVALID");
  assert.deepEqual(seen, ["info"]);
});

test("checkpoint i limit przerywają od razu", async () => {
  fakeIg({ info: () => response({ status: "fail", message: "challenge_required" }, 400) });
  await assert.rejects(fetchWhoami(trace(), session), (e) => e.code === "IG_CHECKPOINT");
  assert.deepEqual(seen, ["info"]);
  seen = [];
  resetCooldown();
  fakeIg({ info: () => response({ status: "fail", message: "Please wait a few minutes" }, 429) });
  await assert.rejects(fetchWhoami(trace(), session), (e) => e.code === "IG_RATE_LIMITED");
  assert.deepEqual(seen, ["info"]);
});

test("żadna metoda nie zwraca konta: sesja nierozpoznana; prywatna odpowiedź nie trafia do diagnostyki", async () => {
  fakeIg({
    info: () => response({ status: "ok" }),
    current: () => response({ status: "ok" }),
    viewer: () => response({ status: "ok", data: { user: null } }),
  });
  await assert.rejects(fetchWhoami(trace(), session), (e) => e.code === "IG_SESSION_INVALID" && !e.upstream.body && !e.upstream.headers["x-ig-set-www-claim"]);
});

test("wszystkie metody zwracają błąd serwera: zgłaszany jest ten błąd, a nie „sesja odrzucona”", async () => {
  fakeIg({ info: () => response({}, 500), current: () => response({}, 500), viewer: () => response({}, 500) });
  await assert.rejects(fetchWhoami(trace(), session), (e) => e.code === "IG_HTTP_ERROR");
  assert.deepEqual(seen, ["info", "current", "viewer"]);
});
