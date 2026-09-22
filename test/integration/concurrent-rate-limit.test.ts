import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
let databaseUrl = "";

function authHeaders(): Record<string, string> {
  return {
    Origin: ORIGIN,
    "Content-Type": "application/json",
  };
}

async function loadApp() {
  resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

describe("concurrent login rate limits", { concurrency: false }, () => {
  beforeEach(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    resetPoolForTests();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("limits concurrent failed attempts for the same email", async () => {
    await createTestUser({
      databaseUrl,
      email: "race@example.com",
      password: TEST_PASSWORD,
      fullName: "Race User",
    });

    const app = await loadApp();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        request(app)
          .post("/api/auth/login")
          .set(authHeaders())
          .send({ email: "race@example.com", password: "WrongPass123!" }),
      ),
    );

    const statuses = responses.map((res) => res.status);
    assert.ok(statuses.includes(429), `expected 429 in ${JSON.stringify(statuses)}`);
    assert.equal(statuses.filter((status) => status === 401).length <= 5, true);
  });

  it("does not clear IP bucket after successful login", async () => {
    await createTestUser({
      databaseUrl,
      email: "success@example.com",
      password: TEST_PASSWORD,
      fullName: "Success User",
    });

    const app = await loadApp();
    for (let i = 0; i < 19; i += 1) {
      const res = await request(app)
        .post("/api/auth/login")
        .set(authHeaders())
        .send({ email: `other-${i}@example.com`, password: "WrongPass123!" });
      assert.equal(res.status, 401);
    }

    const success = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "success@example.com", password: TEST_PASSWORD });
    assert.equal(success.status, 200);

    const blocked = await request(app)
      .post("/api/auth/login")
      .set(authHeaders())
      .send({ email: "yet-another@example.com", password: "WrongPass123!" });
    assert.equal(blocked.status, 429);
  });
});
