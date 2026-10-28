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
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { getPool } from "../../src/db/pool";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();

function headers(cookie?: string): Record<string, string> {
  const h: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json" };
  if (cookie) h.Cookie = cookie;
  return h;
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string, app: Awaited<ReturnType<typeof loadApp>>) {
  const res = await request(app).post("/api/auth/login").set(headers()).send({ email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

describe("tan-tracker HTTP mutation guards", { concurrency: false }, () => {
  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("POST /transfers rejects another manager's external contact", async () => {
    const m1 = await createTestUser({
      databaseUrl,
      email: "http-m1@test.local",
      password: PASSWORD,
      fullName: "HTTP M1",
      role: "manager",
    });
    const m2 = await createTestUser({
      databaseUrl,
      email: "http-m2@test.local",
      password: PASSWORD,
      fullName: "HTTP M2",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    let secretPartyId = "";
    try {
      await ensurePartyForUserOnWrite(client, m1.id, "HTTP M1", "+79991112233");
      await ensurePartyForUserOnWrite(client, m2.id, "HTTP M2", "+79992223344");
      secretPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
           VALUES ('external','Secret','+79993334455',$1::uuid) RETURNING id::text`,
          [m2.id],
        )
      ).rows[0].id;
    } finally {
      client.release();
    }

    const app = await loadApp();
    const cookie = await login("http-m1@test.local", app);
    const res = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(cookie))
      .send({ item: "Box", finalRecipientPartyId: secretPartyId });
    assert.equal(res.status, 403);
  });

  it("POST /transfers rejects marketer role", async () => {
    await createTestUser({
      databaseUrl,
      email: "http-marketer@test.local",
      password: PASSWORD,
      fullName: "Marketer",
      role: "marketer",
    });
    const app = await loadApp();
    const cookie = await login("http-marketer@test.local", app);
    const res = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(cookie))
      .send({
        item: "Box",
        finalRecipientExternal: { name: "X", phone: "+79001112233" },
      });
    assert.equal(res.status, 403);
  });
});
