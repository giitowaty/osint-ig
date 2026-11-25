const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadQueries, DEFAULTS } = require("./ig-queries");
const { resetCooldown } = require("./instagram");
const { runSelftest } = require("./selftest");
const { Trace } = require("./trace");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osint-igq-"));
const cfgFile = path.join(dir, "ig-queries.json");
const session = { cookie: "sessionid=1%3Asynthetic", csrf: "synthetic", userId: "1", names: ["sessionid"] };
const html = '<script>["DTSGInitialData",[],{"token":"t1"}],["LSD",[],{"token":"t2"}]</script>';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const page = () => new Response(html, { headers: { "content-type": "text/html" } });

let realFetch;
let seen;
beforeEach(() => {
  process.env.OSINT_IG_QUERIES = cfgFile;
  fs.rmSync(cfgFile, { force: true });
  resetCooldown();
  realFetch = global.fetch;
  seen = [];
});
afterEach(() => { global.fetch = realFetch; delete process.env.OSINT_IG_QUERIES; });

/** Udawany Instagram; `broken` = nazwy zapytań GraphQL, które IG „odrzuca”. */
function fakeIg({ broken = [], rateLimitPublic = false } = {}) {
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("web_profile_info")) {
      seen.push("public");
      if (rateLimitPublic) return json({ message: "Please wait a few minutes" }, 429);
      return json({ data: { user: { id: "25025320", username: "instagram", edge_followed_by: { count: 1000 } } } });
    }
    if (u.includes("query_hash=")) {
      seen.push(`viewer:${new URL(u).searchParams.get("query_hash")}`);
      return json({ data: { user: { id: "1", username: "pomocnicze" } } });
    }
    if (u === "https://www.instagram.com/instagram/") { seen.push("page"); return page(); }
    if (u === "https://www.instagram.com/graphql/query") {
      const name = opts.body.get("fb_api_req_friendly_name");
      seen.push(`${name}:${opts.body.get("doc_id")}`);
      if (broken.includes(name)) return json({ errors: [{ message: "document not found" }] });
      if (name === "PolarisProfilePostsQuery") {
        return json({ data: { xdt_api__v1__feed__user_timeline_graphql_connection: { edges: [{ node: { user: { username: "instagram", pk: "25025320" } } }] } } });
      }
      return json({ data: { user: { username: "instagram", follower_count: 1000 } } });
    }
    throw new Error("nieoczekiwany adres " + u);
  };
}

test("konfiguracja: bez pliku obowiązują wartości domyślne", () => {
  const q = loadQueries();
  assert.equal(q.source, "default");
  assert.deepEqual(q.values, DEFAULTS);
  assert.equal(q.path, cfgFile);
});

test("konfiguracja: poprawne nadpisanie działa, błędne wpisy są odrzucane z opisem", () => {
  fs.writeFileSync(cfgFile, JSON.stringify({ profilePosts: "99999999999", viewerQueryHash: "NIE-HEX", foo: "1" }));
  const q = loadQueries();
  assert.equal(q.values.profilePosts, "99999999999");
  assert.equal(q.values.viewerQueryHash, DEFAULTS.viewerQueryHash); // błędna wartość nie przechodzi
  assert.deepEqual(q.overrides, ["profilePosts"]);
  assert.equal(q.errors.length, 2);
  assert.match(q.errors.join(" "), /viewerQueryHash/);
  assert.match(q.errors.join(" "), /nieznany klucz „foo”/);
});

test("konfiguracja: zmiana pliku działa bez restartu; uszkodzony JSON nie psuje programu", () => {
  fs.writeFileSync(cfgFile, JSON.stringify({ profilePosts: "11111111111" }));
  assert.equal(loadQueries().values.profilePosts, "11111111111");
  fs.writeFileSync(cfgFile, JSON.stringify({ profilePosts: "2222222222222" }));
  assert.equal(loadQueries().values.profilePosts, "2222222222222");
  fs.writeFileSync(cfgFile, "{ to nie json");
  const q = loadQueries();
  assert.equal(q.values.profilePosts, DEFAULTS.profilePosts);
  assert.match(q.errors[0], /nie da się odczytać/);
});

test("autotest bez sesji: sprawdza zapytanie publiczne, resztę pomija z wyjaśnieniem", async () => {
  fakeIg();
  const r = await runSelftest(new Trace("t"), "instagram", null);
  assert.equal(r.ok, true);
  assert.deepEqual(r.checks.map((c) => [c.id, c.status]), [["public", "ok"], ["session", "skipped"]]);
  assert.match(r.checks[0].message, /@instagram · 1\s?000 obserwujących/);
});

test("autotest z sesją: wszystkie zapytania sprawne", async () => {
  fakeIg();
  const r = await runSelftest(new Trace("t"), "instagram", session);
  assert.equal(r.ok, true);
  assert.deepEqual(r.checks.map((c) => [c.id, c.status]),
    [["public", "ok"], ["whoami", "ok"], ["tokens", "ok"], ["posts", "ok"], ["details", "ok"]]);
});

test("autotest: zmieniony doc_id postów wskazuje klucz profilePosts i plik do poprawy, reszta działa dalej", async () => {
  fakeIg({ broken: ["PolarisProfilePostsQuery"] });
  const r = await runSelftest(new Trace("t"), "instagram", session);
  assert.equal(r.ok, false);
  const posts = r.checks.find((c) => c.id === "posts");
  assert.equal(posts.status, "fail");
  assert.equal(posts.configKey, "profilePosts");
  assert.match(posts.hint, /profilePosts/);
  assert.ok(posts.hint.includes(cfgFile));
  assert.equal(r.checks.find((c) => c.id === "details").status, "ok"); // ID z zapytania publicznego
});

test("autotest używa identyfikatorów z pliku nadpisań (bez przebudowy programu)", async () => {
  fs.writeFileSync(cfgFile, JSON.stringify({ profilePosts: "123456789012", viewerQueryHash: "0123456789abcdef0123456789abcdef" }));
  fakeIg();
  const r = await runSelftest(new Trace("t"), "instagram", session);
  assert.equal(r.ok, true);
  assert.ok(seen.includes("PolarisProfilePostsQuery:123456789012"));
  assert.ok(seen.includes("viewer:0123456789abcdef0123456789abcdef"));
  assert.deepEqual(r.config.overrides.sort(), ["profilePosts", "viewerQueryHash"]);
});

test("autotest: limit 429 przerywa sprawdzanie, kolejne zapytania nie są wysyłane", async () => {
  fakeIg({ rateLimitPublic: true });
  const r = await runSelftest(new Trace("t"), "instagram", session);
  assert.equal(r.checks[0].status, "fail");
  assert.equal(r.checks[0].code, "IG_RATE_LIMITED");
  assert.match(r.checks[0].hint, /nie błąd konfiguracji/);
  assert.ok(r.checks.slice(1).every((c) => c.status === "skipped"));
  assert.deepEqual(seen, ["public"]);
});
