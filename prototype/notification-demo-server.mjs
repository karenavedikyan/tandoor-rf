#!/usr/bin/env node
/**
 * Isolated preview backend for notification demo state only (stdlib, no secrets).
 * Listen: 0.0.0.0:34113
 * Start: node prototype/notification-demo-server.mjs
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PORT = 34113;
const HOST = "0.0.0.0";
const MAX_BODY = 256 * 1024;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const DATA_FILE = path.join(DATA_DIR, "notification-demo-state.json");

function cors(res, req) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Visitor-Id");
}

function readDb() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || !data.visitors) return { visitors: {} };
    return data;
  } catch {
    return { visitors: {} };
  }
}

function writeDb(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 0));
}

function clientIp(req) {
  return (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
}

function resolveVisitorId(req) {
  const raw = req.headers["x-visitor-id"];
  if (typeof raw === "string" && raw.trim()) {
    const id = raw.trim();
    if (!/^[\w.-]{8,128}$/.test(id)) return { status: 400, error: "invalid X-Visitor-Id" };
    return { id };
  }
  const ip = clientIp(req);
  if (ip === "127.0.0.1" || ip === "::1") return { id: "local-dev-visitor" };
  return { status: 401, error: "X-Visitor-Id required" };
}

function validatePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body must be object";
  if (!body.users || typeof body.users !== "object" || Array.isArray(body.users)) return "users required";
  const userIds = Object.keys(body.users);
  if (userIds.length > 64) return "too many demo employees";
  for (const uid of userIds) {
    if (typeof uid !== "string" || uid.length > 64) return "invalid employee id";
    const u = body.users[uid];
    if (!u || typeof u !== "object" || Array.isArray(u)) return "invalid user record";
    if (u.read && (typeof u.read !== "object" || Array.isArray(u.read))) return "invalid read map";
    if (u.deliveryStatus && (typeof u.deliveryStatus !== "object" || Array.isArray(u.deliveryStatus))) return "invalid deliveryStatus";
    if (u.delivery && typeof u.delivery !== "object") return "invalid delivery";
    if (u.read && Object.keys(u.read).length > 5000) return "read map too large";
    if (u.deliveryStatus && Object.keys(u.deliveryStatus).length > 5000) return "deliveryStatus too large";
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  cors(res, req);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/v1/demo-notification-state") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  const visitor = resolveVisitorId(req);
  if (visitor.error) {
    res.writeHead(visitor.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: visitor.error }));
    return;
  }
  const vid = visitor.id;
  try {
    if (req.method === "GET") {
      const db = readDb();
      const slice = db.visitors[vid] || { users: {} };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(slice));
      return;
    }
    if (req.method === "DELETE") {
      const db = readDb();
      delete db.visitors[vid];
      writeDb(db);
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "PUT") {
      let text;
      try {
        text = await readBody(req);
      } catch {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "body too large" }));
        return;
      }
      let body;
      try {
        body = JSON.parse(text || "{}");
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid json" }));
        return;
      }
      const err = validatePayload(body);
      if (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err }));
        return;
      }
      const db = readDb();
      db.visitors[vid] = { users: body.users };
      writeDb(db);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method not allowed" }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "internal error" }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`notification demo backend listening on http://${HOST}:${PORT}`);
});
