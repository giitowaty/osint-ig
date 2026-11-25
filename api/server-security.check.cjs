const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { server } = require("./server");

let port;
before(() => new Promise((resolve) => server.listen(0, "127.0.0.1", () => { port = server.address().port; resolve(); })));
after(() => new Promise((resolve) => server.close(resolve)));

/** Surowe zapytanie, żeby móc podrobić nagłówek Host (fetch na to nie pozwala). */
function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("loopback Host is accepted", async () => {
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) {
    const r = await get("/api/health", { Host: host });
    assert.equal(r.status, 200, host);
    assert.equal(JSON.parse(r.body).ok, true);
  }
});

test("foreign Host is rejected (DNS rebinding) for API, Firefox import and static files", async () => {
  for (const path of ["/api/health", "/api/import/firefox", "/", "/index.html"]) {
    const r = await get(path, { Host: `attacker.example:${port}` });
    assert.equal(r.status, 421, path);
    assert.doesNotMatch(r.body, /candidates/);
  }
});

test("cross-site Origin cannot trigger API side effects (CSRF)", async () => {
  for (const path of ["/api/cooldown/reset", "/api/cache/clear", "/api/import/firefox"]) {
    const r = await get(path, { Host: `127.0.0.1:${port}`, Origin: "https://attacker.example" });
    assert.equal(r.status, 403, path);
    assert.equal(JSON.parse(r.body).error.code, "FORBIDDEN_ORIGIN");
    assert.equal(r.headers["access-control-allow-origin"], undefined);
  }
  const sandboxed = await get("/api/cache/clear", { Host: `127.0.0.1:${port}`, Origin: "null" });
  assert.equal(sandboxed.status, 403);
});

test("same-origin and allowed app origins keep working", async () => {
  const same = await get("/api/health", { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` });
  assert.equal(same.status, 200);
  const dev = await get("/api/health", { Host: `127.0.0.1:${port}`, Origin: "http://localhost:5173" });
  assert.equal(dev.status, 200);
  assert.equal(dev.headers["access-control-allow-origin"], "http://localhost:5173");
});

test("malformed percent-encoding in a static path is a 400, not a server error", async () => {
  const r = await get("/%E0%A4%A", { Host: `127.0.0.1:${port}` });
  assert.equal(r.status, 400);
});
