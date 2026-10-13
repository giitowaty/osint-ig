const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createExtensionBridge } = require("./extension-bridge");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("local extension hand-off: origins, claim once, validation and verified acknowledgement", async () => {
  const bridge = createExtensionBridge({
    allowedOrigins: new Set(["tauri://localhost"]),
    sendJson: (_req, res, status, body) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    },
  });
  const app = http.createServer((req, res) => void bridge.handle(req, res));
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  await new Promise((r) => bridge.listener.listen(0, "127.0.0.1", r));
  const appBase = `http://127.0.0.1:${app.address().port}/api/extension`;
  const extBase = `http://127.0.0.1:${bridge.listener.address().port}/api/extension`;
  const ext = { "x-osint-bridge": "1", "x-osint-extension": "a".repeat(32) };
  const ui = { "x-osint-bridge": "1", origin: "tauri://localhost" };
  const text = "OSINTIG1:" + Buffer.from(JSON.stringify({ cookies: [
    { name: "sessionid", value: "123%3Atest", domain: ".instagram.com" },
  ] })).toString("base64url");
  const send = (base, path, headers, method = "GET", body) => new Promise((resolve, reject) => {
    const req = http.request(base + path, { method, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, json: async () => JSON.parse(data) }));
    });
    req.on("error", reject);
    req.end(body);
  });
  try {
    assert.equal((await send(extBase, "/connect", ext, "POST", text)).status, 409);
    assert.equal((await send(appBase, "/pending", { ...ui, origin: "https://evil.example" })).status, 403);
    assert.equal((await send(appBase, "/pending", { ...ui, host: "evil.example" })).status, 403);
    assert.equal((await send(appBase, "/pending", { origin: "tauri://localhost" })).status, 403);
    assert.equal((await send(extBase, "/pending", ext)).status, 405);
    assert.equal((await send(appBase, "/pending", ui)).status, 200);
    assert.equal((await send(extBase, "/connect", ext, "POST", "bad")).status, 400);
    assert.equal((await send(extBase, "/connect", ext, "POST", "x".repeat(32769))).status, 413);
    const { id } = await (await send(extBase, "/connect", ext, "POST", text)).json();
    assert.ok(id);
    assert.equal((await send(extBase, "/connect", ext, "POST", text)).status, 409);
    const pending = await (await send(appBase, "/pending", ui)).json();
    assert.deepEqual(pending.pending, { id, text });
    assert.equal((await (await send(appBase, "/pending", ui)).json()).pending, null);
    const statusHeaders = { ...ext, "x-osint-transfer": id };
    const status = await (await send(extBase, "/status", statusHeaders)).json();
    assert.deepEqual(status, { ok: true, state: "checking" });
    assert.equal((await send(appBase, "/ack", { ...ui, "x-osint-transfer": "wrong" }, "POST")).status, 409);
    assert.equal((await send(appBase, "/ack", { ...ui, "x-osint-transfer": id, "x-osint-result": "connected" }, "POST")).status, 200);
    assert.deepEqual(await (await send(extBase, "/status", statusHeaders)).json(), { ok: true, state: "connected" });
    const next = await (await send(extBase, "/connect", { ...ext, origin: "chrome-extension://" + "a".repeat(32) }, "POST", text)).json();
    await send(appBase, "/pending", ui);
    await send(appBase, "/ack", { ...ui, "x-osint-transfer": next.id, "x-osint-result": "failed" }, "POST");
    assert.equal((await (await send(extBase, "/status", { ...ext, "x-osint-transfer": next.id })).json()).state, "failed");
  } finally {
    await Promise.all([new Promise((r) => app.close(r)), new Promise((r) => bridge.listener.close(r))]);
  }
});

test("popup Connect sends a session locally, confirms verification and explains failures", async () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: "", disabled: false,
      addEventListener(_event, handler) { this.click = handler; } });
    return elements.get(id);
  };
  let mode = "success";
  let posted = false;
  const context = vm.createContext({
    document: { getElementById: element },
    chrome: { runtime: { id: "a".repeat(32) }, cookies: {
      get: async () => ({ value: "test" }),
      getAll: async () => mode === "missing" ? [] : [{ name: "sessionid", value: "123%3Atest", domain: ".instagram.com" }],
    } },
    navigator: { clipboard: { writeText: () => { throw new Error("Connect must not copy credentials"); } } },
    fetch: async (url, options) => {
      if (url.startsWith("https://www.instagram.com/")) return { ok: true, json: async () => ({ data: { user: { username: "osint_test" } } }) };
      assert.ok(url.startsWith("http://127.0.0.1:17654/api/extension/"));
      if (mode === "unreachable") throw new Error("offline");
      if (url.endsWith("/connect")) {
        assert.equal(options.method, "POST");
        assert.equal(options.headers["x-osint-extension"], "a".repeat(32));
        assert.ok(options.body.startsWith("OSINTIG1:"));
        posted = true;
        return { ok: true, json: async () => ({ id: "test-transfer" }) };
      }
      assert.equal(options.headers["x-osint-transfer"], "test-transfer");
      return { ok: true, json: async () => ({ state: mode === "failed" ? "failed" : "connected" }) };
    },
    setTimeout: (fn) => setTimeout(fn, 0), AbortSignal, Date, btoa,
    encodeURIComponent, unescape,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/popup.js"), "utf8"), context);
  await element("connect").click();
  assert.ok(posted);
  assert.match(element("status").textContent, /Połączono/);
  assert.equal(element("connect").disabled, false);
  for (const [value, message] of [["missing", /Brak sessionid/], ["unreachable", /Uruchom aktualną aplikację/], ["failed", /Nie udało się potwierdzić sesji/]]) {
    mode = value;
    await element("connect").click();
    assert.match(element("status").textContent, message);
    assert.equal(element("connect").disabled, false);
  }
});
