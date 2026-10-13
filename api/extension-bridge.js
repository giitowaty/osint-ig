"use strict";

const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { sessionFromHeaders } = require("./cookies");

// Local hand-off only. Secrets live in memory for at most 60 seconds and are
// removed as soon as the application claims them. No clipboard or disk writes.
function createExtensionBridge({ allowedOrigins, sendJson }) {
  let activeAt = 0;
  let transfer = null;
  let expiry;
  const extensionOrigin = (origin) => /^chrome-extension:\/\/[a-p]{32}$/.test(origin || "");
  const reply = (req, res, status, body) => {
    if (extensionOrigin(req.headers.origin)) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
      res.setHeader("Access-Control-Allow-Headers", "content-type, x-osint-bridge, x-osint-transfer, x-osint-extension");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Vary", "Origin");
    }
    return sendJson(req, res, status, body);
  };
  async function handle(req, res, discovery = false) {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (!pathname.startsWith("/api/extension/")) return false;
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || "")) {
      reply(req, res, 403, { ok: false }); return true;
    }
    const origin = req.headers.origin;
    const isExtension = extensionOrigin(origin) || (!origin && /^[a-p]{32}$/.test(req.headers["x-osint-extension"] || ""));
    const isApp = !discovery && !isExtension && (!origin || allowedOrigins.has(origin) ||
      origin === `http://127.0.0.1:${req.socket.localPort}` || origin === `http://localhost:${req.socket.localPort}`);
    if (!isExtension && !isApp) {
      reply(req, res, 403, { ok: false, message: "Niedozwolone źródło połączenia." }); return true;
    }
    if (req.method === "OPTIONS") {
      reply(req, res, 204, {}); return true;
    }
    if (req.headers["x-osint-bridge"] !== "1") {
      reply(req, res, 403, { ok: false, message: "Brak nagłówka połączenia." }); return true;
    }
    if (transfer && Date.now() > transfer.expires) transfer = null;
    if (pathname === "/api/extension/pending" && isApp && req.method === "GET") {
      activeAt = Date.now();
      const pending = transfer?.text ? { id: transfer.id, text: transfer.text } : null;
      if (pending) { transfer.text = ""; transfer.state = "checking"; }
      reply(req, res, 200, { ok: true, pending }); return true;
    }
    if (pathname === "/api/extension/connect" && isExtension && req.method === "POST") {
      if (Date.now() - activeAt > 15000) {
        reply(req, res, 409, { ok: false, message: "Otwórz aplikację OSINT-IG i kliknij Połącz ponownie." }); return true;
      }
      if (transfer && ["pending", "checking"].includes(transfer.state)) {
        reply(req, res, 409, { ok: false, message: "Poprzednie połączenie jest jeszcze sprawdzane." }); return true;
      }
      let text = "";
      for await (const chunk of req) {
        text += chunk.toString();
        if (text.length > 32768) {
          reply(req, res, 413, { ok: false, message: "Paczka ciasteczek jest za duża." }); return true;
        }
      }
      try {
        if (!/^OSINTIG1:[A-Za-z0-9_-]+$/.test(text)) throw new Error();
        const bundle = JSON.parse(Buffer.from(text.slice(9), "base64url").toString());
        if (!Array.isArray(bundle.cookies)) throw new Error();
        const cookies = bundle.cookies.filter((c) => c && typeof c.name === "string" && typeof c.value === "string" &&
          typeof c.domain === "string" && /(^|\.)instagram\.com$/.test(c.domain));
        sessionFromHeaders({ "x-ig-cookies": cookies.map((c) => `${c.name}=${c.value}`).join("; ") });
        if (!cookies.some((c) => c.name === "sessionid")) throw new Error();
      } catch {
        reply(req, res, 400, { ok: false, message: "Niepoprawna paczka ciasteczek Instagrama." }); return true;
      }
      transfer = { id: randomUUID(), text, state: "pending", expires: Date.now() + 60000 };
      clearTimeout(expiry);
      expiry = setTimeout(() => { transfer = null; }, 60000);
      expiry.unref();
      reply(req, res, 200, { ok: true, id: transfer.id }); return true;
    }
    if (pathname === "/api/extension/status" && isExtension && req.method === "GET") {
      reply(req, res, 200, { ok: true, state: transfer?.id === req.headers["x-osint-transfer"] ? transfer.state : "expired" }); return true;
    }
    if (pathname === "/api/extension/ack" && isApp && req.method === "POST") {
      if (transfer?.id !== req.headers["x-osint-transfer"] || transfer.state !== "checking") {
        reply(req, res, 409, { ok: false }); return true;
      }
      transfer.state = req.headers["x-osint-result"] === "connected" ? "connected" : "failed";
      reply(req, res, 200, { ok: true }); return true;
    }
    reply(req, res, 405, { ok: false, message: "Niedozwolona operacja." }); return true;
  }
  const listener = http.createServer((req, res) => {
    handle(req, res, true).then((handled) => {
      if (!handled) reply(req, res, 404, { ok: false });
    }).catch(() => reply(req, res, 500, { ok: false }));
  });
  return { handle, listener };
}

module.exports = { createExtensionBridge };
