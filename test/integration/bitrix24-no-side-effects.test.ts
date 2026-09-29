import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { resetPoolForTests } from "../../src/db/pool";

describe("bitrix24 integration side effects", () => {
  let app: ReturnType<typeof import("../../src/server").createApp>;
  let pinnedCalls = 0;

  before(async () => {
    delete process.env.DATABASE_URL;
    process.env.BITRIX24_ENABLED = "true";
    process.env.BITRIX24_WEBHOOK_URL = "https://example.bitrix24.ru/rest/1/testtoken/";
    await resetPoolForTests();

    const pinnedModule = await import("../../src/bitrix24/pinned-request");
    const original = pinnedModule.executePinnedHttpsRequest;
    pinnedModule.executePinnedHttpsRequest = async (...args) => {
      pinnedCalls += 1;
      return original(...args);
    };

    const { createApp } = await import("../../src/server");
    app = createApp();
  });

  after(async () => {
    delete process.env.BITRIX24_ENABLED;
    delete process.env.BITRIX24_WEBHOOK_URL;
    await resetPoolForTests();
  });

  it("does not call Bitrix24 transport from health", async () => {
    const beforeCalls = pinnedCalls;
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.equal(pinnedCalls, beforeCalls);
  });

  it("does not call Bitrix24 transport from readiness check path", async () => {
    const beforeCalls = pinnedCalls;
    const res = await request(app).get("/api/ready");
    assert.equal(res.status, 503);
    assert.equal(pinnedCalls, beforeCalls);
  });

  it("does not require Bitrix24 configuration for health when disabled", async () => {
    delete process.env.BITRIX24_ENABLED;
    delete process.env.BITRIX24_WEBHOOK_URL;
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
  });
});
