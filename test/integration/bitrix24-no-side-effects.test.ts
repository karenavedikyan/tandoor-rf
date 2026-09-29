import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { resetPoolForTests } from "../../src/db/pool";

describe("bitrix24 integration side effects", () => {
  let app: ReturnType<typeof import("../../src/server").createApp>;

  before(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.BITRIX24_ENABLED;
    delete process.env.BITRIX24_WEBHOOK_URL;
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    app = createApp();
  });

  after(async () => {
    await resetPoolForTests();
  });

  it("does not require Bitrix24 configuration for health", async () => {
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "ok", app: "tandoor-rf" });
  });

  it("does not require Bitrix24 configuration for readiness check path", async () => {
    const res = await request(app).get("/api/ready");
    assert.equal(res.status, 503);
    assert.equal(res.body.status, "not_ready");
  });
});
