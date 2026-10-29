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

describe("tan-tracker draft edit before first custody", { concurrency: false }, () => {
  let adminCookie = "";
  let recipientACookie = "";
  let recipientBCookie = "";
  let freshAId = "";
  let freshBId = "";

  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    freshAId = (
      await createTestUser({
        databaseUrl,
        email: "tt-draft-a@test.local",
        password: PASSWORD,
        fullName: "Draft Recipient A",
        role: "manager",
      })
    ).id;
    freshBId = (
      await createTestUser({
        databaseUrl,
        email: "tt-draft-b@test.local",
        password: PASSWORD,
        fullName: "Draft Recipient B",
        role: "manager",
      })
    ).id;
    await createTestUser({
      databaseUrl,
      email: "tt-draft-admin@test.local",
      password: PASSWORD,
      fullName: "Draft Admin",
      role: "admin",
    });
    const app = await loadApp();
    adminCookie = await login("tt-draft-admin@test.local", app);
    recipientACookie = await login("tt-draft-a@test.local", app);
    recipientBCookie = await login("tt-draft-b@test.local", app);
  });

  after(async () => {
    await closePool();
  });

  it("invalidates old handoff code after recipient change; denies edit after custody", async () => {
    const app = await loadApp();
    const create = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(adminCookie))
      .send({
        item: "Draft edit box",
        finalRecipientPartyId: `${TT_PENDING_USER_PARTY_PREFIX}${freshAId}`,
      });
    assert.equal(create.status, 201, create.text);
    const transferId = create.body.publicCode as string;
    const order0 = create.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId);
    assert.equal(order0?.canEditDraft, true);
    const rowVersion = order0?.rowVersion;
    assert.ok(rowVersion);

    const genA = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/generate`)
      .set(headers(recipientACookie))
      .send({});
    assert.equal(genA.status, 200, genA.text);
    const oldCode = genA.body.code as string;

    const metaOnly = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/draft-edit`)
      .set(headers(adminCookie))
      .send({
        item: "Draft edit title only",
        finalRecipientPartyId: `${TT_PENDING_USER_PARTY_PREFIX}${freshAId}`,
        rowVersion,
      });
    assert.equal(metaOnly.status, 200, metaOnly.text);
    const rowVersion2 = metaOnly.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId)
      ?.rowVersion;
    assert.ok(rowVersion2);
    const staleAfterTitle = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/verify`)
      .set(headers(adminCookie))
      .send({ code: oldCode });
    assert.notEqual(staleAfterTitle.status, 200, "title-only edit must invalidate prior code");

    const edit = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/draft-edit`)
      .set(headers(adminCookie))
      .send({
        item: "Draft edit box revised",
        finalRecipientPartyId: `${TT_PENDING_USER_PARTY_PREFIX}${freshBId}`,
        rowVersion: rowVersion2,
      });
    assert.equal(edit.status, 200, edit.text);
    const order1 = edit.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId);
    assert.equal(order1?.item, "Draft edit box revised");
    assert.notEqual(order1?.pendingId, order0?.pendingId);

    const staleVerify = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/verify`)
      .set(headers(adminCookie))
      .send({ code: oldCode });
    assert.notEqual(staleVerify.status, 200, "old code must not confirm handoff");

    const genB = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/generate`)
      .set(headers(recipientBCookie))
      .send({});
    assert.equal(genB.status, 200, genB.text);
    const newCode = genB.body.code as string;

    const ok = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/verify`)
      .set(headers(adminCookie))
      .send({ code: newCode });
    assert.equal(ok.status, 200, ok.text);

    const after = await request(app).get("/api/tan-tracker/bootstrap").set(headers(adminCookie));
    const orderAfter = after.body.orders.find((o: { id: string }) => o.id === transferId);
    assert.notEqual(orderAfter?.canEditDraft, true);

    const denied = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/draft-edit`)
      .set(headers(adminCookie))
      .send({
        item: "Too late",
        finalRecipientPartyId: `${TT_PENDING_USER_PARTY_PREFIX}${freshAId}`,
        rowVersion: orderAfter?.rowVersion,
      });
    assert.equal(denied.status, 403, denied.text);
  });

  it("denies draft edit after first custody when item returns to creator", async () => {
    const app = await loadApp();
    const create = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(adminCookie))
      .send({
        item: "Return to creator",
        finalRecipientPartyId: `${TT_PENDING_USER_PARTY_PREFIX}${freshAId}`,
      });
    assert.equal(create.status, 201, create.text);
    const transferId = create.body.publicCode as string;
    const creatorPartyId = create.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId)
      ?.holderId;
    assert.ok(creatorPartyId);

    const gen1 = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/generate`)
      .set(headers(recipientACookie))
      .send({});
    assert.equal(gen1.status, 200, gen1.text);
    const code1 = gen1.body.code as string;
    const verify1 = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/verify`)
      .set(headers(adminCookie))
      .send({ code: code1 });
    assert.equal(verify1.status, 200, verify1.text);

    const pool = getPool();
    assert.ok(pool);
    const custodyRow = await pool.query<{ first_custody_at: Date | null; creator_party_id: string }>(
      `SELECT first_custody_at, creator_party_id FROM tt_transfers WHERE public_code = $1`,
      [transferId],
    );
    assert.ok(custodyRow.rows[0]?.first_custody_at, "first_custody_at must be set on verify");

    await pool.query(
      `UPDATE tt_transfers
       SET holder_party_id = creator_party_id, pending_party_id = NULL, status = 'active'
       WHERE public_code = $1 AND first_custody_at IS NOT NULL`,
      [transferId],
    );

    const boot = await request(app).get("/api/tan-tracker/bootstrap").set(headers(adminCookie));
    const order = boot.body.orders.find((o: { id: string }) => o.id === transferId);
    assert.equal(order?.holderId, creatorPartyId);
    assert.notEqual(order?.canEditDraft, true);

    const denied = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/draft-edit`)
      .set(headers(adminCookie))
      .send({
        item: "Too late after return",
        finalRecipientPartyId: `${TT_PENDING_USER_PARTY_PREFIX}${freshBId}`,
        rowVersion: order?.rowVersion,
      });
    assert.equal(denied.status, 403, denied.text);
  });

  it("edit-vs-confirm race: draft edit and code verify cannot both succeed on same code", async () => {
    const app = await loadApp();
    const create = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(adminCookie))
      .send({
        item: "Race box",
        finalRecipientPartyId: `${TT_PENDING_USER_PARTY_PREFIX}${freshAId}`,
      });
    assert.equal(create.status, 201, create.text);
    const transferId = create.body.publicCode as string;
    const rowVersion = create.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId)
      ?.rowVersion;
    assert.ok(rowVersion);

    const gen = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/generate`)
      .set(headers(recipientACookie))
      .send({});
    assert.equal(gen.status, 200, gen.text);
    const code = gen.body.code as string;

    const [editRes, verifyRes] = await Promise.all([
      request(app)
        .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/draft-edit`)
        .set(headers(adminCookie))
        .send({
          item: "Race revised title",
          finalRecipientPartyId: `${TT_PENDING_USER_PARTY_PREFIX}${freshAId}`,
          rowVersion,
        }),
      request(app)
        .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/verify`)
        .set(headers(adminCookie))
        .send({ code }),
    ]);

    const bothOk = editRes.status === 200 && verifyRes.status === 200;
    assert.equal(bothOk, false, "draft-edit and verify must not both succeed concurrently");
    if (editRes.status === 200) {
      const stale = await request(app)
        .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/code/verify`)
        .set(headers(adminCookie))
        .send({ code });
      assert.notEqual(stale.status, 200);
    }
  });
});
