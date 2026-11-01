import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { TT_PENDING_USER_PARTY_PREFIX } from "../../src/tan-tracker/recipient-catalog";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();

function headers(cookie?: string, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json", ...extra };
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

describe("tan-tracker personal recipient labels", { concurrency: false }, () => {
  let actorACookie = "";
  let actorBCookie = "";
  let recipientId = "";

  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    const actorA = await createTestUser({
      databaseUrl,
      email: "tt-prl-a@test.local",
      password: PASSWORD,
      fullName: "Personal Label Actor A",
      role: "manager",
    });
    await createTestUser({
      databaseUrl,
      email: "tt-prl-b@test.local",
      password: PASSWORD,
      fullName: "Personal Label Actor B",
      role: "manager",
    });
    recipientId = (
      await createTestUser({
        databaseUrl,
        email: "tt-prl-recipient@test.local",
        password: PASSWORD,
        fullName: "Canonical Recipient Name",
        role: "manager",
      })
    ).id;
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    try {
      await ensurePartyForUserOnWrite(client, actorA.id, "Personal Label Actor A", "+79991112201");
    } finally {
      client.release();
    }
    const app = await loadApp();
    actorACookie = await login("tt-prl-a@test.local", app);
    actorBCookie = await login("tt-prl-b@test.local", app);
  });

  after(async () => {
    await closePool();
  });

  it("isolates labels per actor and per transfer; reset restores canonical view", async () => {
    const app = await loadApp();
    const create = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(actorACookie))
      .send({
        item: "Personal label item",
        finalRecipientPartyId: `${TT_PENDING_USER_PARTY_PREFIX}${recipientId}`,
        finalRecipientPersonalName: "Саша монтажник",
      });
    assert.equal(create.status, 201, create.text);
    const transferId = create.body.publicCode as string;
    const orderA = create.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId);
    const pending = orderA?.pendingId ?? orderA?.finalRecipientId;
    assert.ok(pending);
    assert.equal(orderA.personalRecipientViews?.[pending]?.personalName, "Саша монтажник");

    const setB = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/personal-recipient-label`)
      .set(headers(actorBCookie))
      .send({ recipientPartyId: pending, personalName: "Другой ярлык B" });
    assert.equal(setB.status, 403, setB.text);

    const bootB = await request(app).get("/api/tan-tracker/bootstrap").set(headers(actorBCookie));
    assert.equal(bootB.status, 200);
    const orderB = bootB.body.orders.find((o: { id: string }) => o.id === transferId);
    assert.ok(orderB);
    assert.equal(orderB.personalRecipientViews?.[pending]?.personalName, undefined);

    const reset = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/personal-recipient-label`)
      .set(headers(actorACookie))
      .send({ recipientPartyId: pending, reset: true });
    assert.equal(reset.status, 200, reset.text);
    const afterReset = reset.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId);
    assert.equal(afterReset.personalRecipientViews?.[pending]?.personalName ?? null, null);

    const pool = getPool();
    assert.ok(pool);
    const partyName = (
      await pool.query<{ display_name: string }>(`SELECT display_name FROM tt_parties WHERE id = $1::uuid`, [
        pending,
      ])
    ).rows[0]?.display_name;
    assert.equal(partyName, "Canonical Recipient Name");
  });
});
