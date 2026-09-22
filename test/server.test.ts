import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/server";

describe("server", () => {
  const app = createApp();

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

  it("unknown /api/* routes return JSON 404", async () => {
    const res = await request(app).get("/api/unknown");
    assert.equal(res.status, 404);
    assert.equal(res.headers["content-type"]?.includes("application/json"), true);
    assert.deepEqual(res.body, { error: "Not found" });
  });
});
