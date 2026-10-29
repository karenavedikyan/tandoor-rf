import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { peekTestPhoneVerificationCode } from "../../src/tan-tracker/phone-verification";
import { signPhoneSession } from "../../src/tan-tracker/phone-session";
import { PHONE_SESSION_TTL_MS } from "../../src/tan-tracker/otp-config";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const FILE_BYTES = Buffer.from("public-attachment-secret-bytes", "utf8");
const databaseUrl = getIntegrationDatabaseUrl();

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { Origin: ORIGIN, ...extra };
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string, app: Awaited<ReturnType<typeof loadApp>>) {
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

async function seedTransferWithAttachment(app: Awaited<ReturnType<typeof loadApp>>) {
  const emp = randomUUID();
  const email = `tt-pub-att-${randomUUID().slice(0, 8)}@test.local`;
  const user = await createTestUser({
    databaseUrl,
    email,
    password: PASSWORD,
    fullName: "Pub Att Holder",
    role: "manager",
  });
  const pool = getPool();
  assert.ok(pool);
  const client = await pool.connect();
  let pendingPartyId = "";
  try {
    await client.query(
      `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
       VALUES ($1::uuid, 'Holder', 'Manager', '{}')`,
      [emp],
    );
    await linkUserToEmployee({
      databaseUrl,
      userId: user.id,
      employeeId: emp,
      confirmedByUserId: user.id,
    });
    pendingPartyId = (
      await client.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
         VALUES ('external', 'Pending', '+79995556601', $1::uuid) RETURNING id::text`,
        [user.id],
      )
    ).rows[0].id;
    await ensurePartyForUserOnWrite(client, user.id, "Pub Att Holder", "+79995556600");
  } finally {
    client.release();
  }

  const cookie = await login(email, app);
  const stageRes = await request(app)
    .post("/api/tan-tracker/staging-attachments")
    .set(
      headers(cookie, {
        "Content-Type": "text/plain",
        "X-TT-Filename": encodeURIComponent("secret.txt"),
        "X-TT-Mime-Type": "text/plain",
      }),
    )
    .send(FILE_BYTES);
  assert.equal(stageRes.status, 201, stageRes.text);

  const createRes = await request(app)
    .post("/api/tan-tracker/transfers")
    .set(headers(cookie, { "Content-Type": "application/json" }))
    .send({
      item: "Box with file",
      finalRecipientPartyId: pendingPartyId,
      stagingAttachmentIds: [stageRes.body.id],
    });
  assert.equal(createRes.status, 201, createRes.text);
  const order = createRes.body.bootstrap.orders.find(
    (o: { item: string }) => o.item === "Box with file",
  );
  assert.ok(order?.activeInvitation?.invitationToken);
  assert.ok(order.attachments?.length === 1);
  return {
    invitationToken: order.activeInvitation.invitationToken as string,
    attachmentId: order.attachments[0].id as string,
    publicCode: order.id as string,
    pendingPartyId,
    internalTransferId: (
      await pool!.query<{ id: string }>(`SELECT id::text FROM tt_transfers WHERE public_code = $1`, [
        order.id,
      ])
    ).rows[0].id,
  };
}

describe("tan-tracker public recipient attachments", { concurrency: false }, () => {
  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("rejects download before phone verify and allows own file after verify", async () => {
    const app = await loadApp();
    const seed = await seedTransferWithAttachment(app);

    const beforeVerify = await request(app)
      .get(`/api/tan-tracker/public/recipient/attachments/${encodeURIComponent(seed.attachmentId)}`)
      .query({ invitationToken: seed.invitationToken });
    assert.equal(beforeVerify.status, 403, beforeVerify.text);

    const sendRes = await request(app)
      .post("/api/tan-tracker/public/recipient/phone/send")
      .set(headers({ "Content-Type": "application/json" }))
      .send({ invitationToken: seed.invitationToken });
    assert.equal(sendRes.status, 200, sendRes.text);

    const otp = peekTestPhoneVerificationCode(seed.publicCode, seed.pendingPartyId);
    assert.ok(otp);
    const verifyRes = await request(app)
      .post("/api/tan-tracker/public/recipient/phone/verify")
      .set(headers({ "Content-Type": "application/json" }))
      .send({ invitationToken: seed.invitationToken, code: otp });
    assert.equal(verifyRes.status, 200, verifyRes.text);
    const phoneSessionToken = verifyRes.body.phoneSessionToken as string;
    assert.ok(phoneSessionToken);

    const ok = await request(app)
      .get(`/api/tan-tracker/public/recipient/attachments/${encodeURIComponent(seed.attachmentId)}`)
      .query({ invitationToken: seed.invitationToken, phoneSessionToken });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.body, FILE_BYTES);
  });

  it("rejects forged phone session and foreign attachment id", async () => {
    const app = await loadApp();
    const seed = await seedTransferWithAttachment(app);

    const forged = signPhoneSession({
      transferId: seed.internalTransferId,
      partyId: seed.pendingPartyId,
      hv: 999,
      exp: Date.now() + PHONE_SESSION_TTL_MS,
    });

    const wrongHv = await request(app)
      .get(`/api/tan-tracker/public/recipient/attachments/${encodeURIComponent(seed.attachmentId)}`)
      .query({ invitationToken: seed.invitationToken, phoneSessionToken: forged });
    assert.equal(wrongHv.status, 403, wrongHv.text);

    const sendRes = await request(app)
      .post("/api/tan-tracker/public/recipient/phone/send")
      .set(headers({ "Content-Type": "application/json" }))
      .send({ invitationToken: seed.invitationToken });
    assert.equal(sendRes.status, 200, sendRes.text);
    const otp = peekTestPhoneVerificationCode(seed.publicCode, seed.pendingPartyId);
    assert.ok(otp);
    const verifyRes = await request(app)
      .post("/api/tan-tracker/public/recipient/phone/verify")
      .set(headers({ "Content-Type": "application/json" }))
      .send({ invitationToken: seed.invitationToken, code: otp });
    assert.equal(verifyRes.status, 200, verifyRes.text);

    const foreignAtt = randomUUID();
    const foreign = await request(app)
      .get(`/api/tan-tracker/public/recipient/attachments/${encodeURIComponent(foreignAtt)}`)
      .query({
        invitationToken: seed.invitationToken,
        phoneSessionToken: verifyRes.body.phoneSessionToken,
      });
    assert.equal(foreign.status, 404, foreign.text);
  });

  it("public context lists attachments without download url", async () => {
    const app = await loadApp();
    const seed = await seedTransferWithAttachment(app);
    const ctx = await request(app)
      .get("/api/tan-tracker/public/recipient/context")
      .query({ invitationToken: seed.invitationToken });
    assert.equal(ctx.status, 200, ctx.text);
    const att = ctx.body.orders[0].attachments[0];
    assert.equal(att.id, seed.attachmentId);
    assert.equal(att.url, undefined);
  });
});
