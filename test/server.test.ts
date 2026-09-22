import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { resetPoolForTests } from "../src/db/pool";

describe("server", () => {
  let app: ReturnType<typeof import("../src/server").createApp>;

  before(async () => {
    delete process.env.DATABASE_URL;
    resetPoolForTests();
    const { createApp } = await import("../src/server");
    app = createApp();
  });

  after(() => {
    resetPoolForTests();
  });

  it("GET / returns HTML page", async () => {
    const res = await request(app).get("/");
    assert.equal(res.status, 200);
    assert.match(res.text, /tandoor-rf/);
    assert.match(res.text, /Проверить сервер/);
  });

  it("GET /api/health returns expected JSON with Cache-Control: no-store", async () => {
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "ok", app: "tandoor-rf" });
    assert.equal(res.headers["cache-control"], "no-store");
  });

  it("GET /api/ready returns 503 when DATABASE_URL is not configured", async () => {
    const res = await request(app).get("/api/ready");
    assert.equal(res.status, 503);
    assert.equal(res.body.status, "not_ready");
  });

  it("GET /login returns login page", async () => {
    const res = await request(app).get("/login");
    assert.equal(res.status, 200);
    assert.match(res.text, /Войти/);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  it("unknown /api/* routes return JSON 404", async () => {
    const res = await request(app).get("/api/unknown");
    assert.equal(res.status, 404);
    assert.equal(res.headers["content-type"]?.includes("application/json"), true);
    assert.deepEqual(res.body, { error: "Not found" });
  });

  it("GET /app.js with out-of-range Range returns 416 with safe response", async () => {
    const res = await request(app)
      .get("/app.js")
      .set("Range", "bytes=99999999-");

    assert.equal(res.status, 416);
    assert.equal(res.headers["content-type"]?.includes("text/plain"), true);

    const body = res.text;
    assert.match(body, /range not satisfiable/i);
    assert.doesNotMatch(body, /\bat\s+\S+/);
    assert.doesNotMatch(body, /\/(?:app|workspace|node_modules)\//);
    assert.doesNotMatch(body, /Error:/);
    assert.doesNotMatch(body, /stack/i);
  });

});
