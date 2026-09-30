import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { resetPoolForTests } from "../../src/db/pool";
import { setHttpsRequestImplForTests } from "../../src/bitrix24/pinned-request";

describe("bitrix24 integration side effects", () => {
  let app: ReturnType<typeof import("../../src/server").createApp>;
  let pinnedCalls = 0;
  const originalEnv = {
    BITRIX24_ENABLED: process.env.BITRIX24_ENABLED,
    BITRIX24_WEBHOOK_URL: process.env.BITRIX24_WEBHOOK_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  };

  before(async () => {
    delete process.env.DATABASE_URL;
    process.env.BITRIX24_ENABLED = "true";
    process.env.BITRIX24_WEBHOOK_URL = "https://example.bitrix24.ru/rest/1/testtoken/";
    await resetPoolForTests();

    setHttpsRequestImplForTests((() => {
      pinnedCalls += 1;
      throw new Error("EXTERNAL_NETWORK_BLOCKED");
    }) as typeof import("node:https").request);

    const { createApp } = await import("../../src/server");
    app = createApp();
  });

  after(async () => {
    setHttpsRequestImplForTests(null);
    if (originalEnv.BITRIX24_ENABLED === undefined) {
      delete process.env.BITRIX24_ENABLED;
    } else {
      process.env.BITRIX24_ENABLED = originalEnv.BITRIX24_ENABLED;
    }
    if (originalEnv.BITRIX24_WEBHOOK_URL === undefined) {
      delete process.env.BITRIX24_WEBHOOK_URL;
    } else {
      process.env.BITRIX24_WEBHOOK_URL = originalEnv.BITRIX24_WEBHOOK_URL;
    }
    if (originalEnv.DATABASE_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalEnv.DATABASE_URL;
    }
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

  it("does not call Bitrix24 transport from login", async () => {
    const beforeCalls = pinnedCalls;
    const res = await request(app).post("/api/auth/login").send({
      login: "missing-user",
      password: "wrong-password",
    });
    assert.notEqual(res.status, 500);
    assert.equal(pinnedCalls, beforeCalls);
  });

  it("does not require Bitrix24 configuration for health when disabled", async () => {
    process.env.BITRIX24_ENABLED = "false";
    delete process.env.BITRIX24_WEBHOOK_URL;
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    process.env.BITRIX24_ENABLED = "true";
    process.env.BITRIX24_WEBHOOK_URL = "https://example.bitrix24.ru/rest/1/testtoken/";
  });
});
