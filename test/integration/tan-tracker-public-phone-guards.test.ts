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
import { signInvitationToken, invitationTokenTtlMs } from "../../src/tan-tracker/invitation-token";
import { peekTestPhoneVerificationCode } from "../../src/tan-tracker/phone-verification";
import { PHONE_VERIFICATION_MAX_ATTEMPTS } from "../../src/tan-tracker/otp-config";

const ORIGIN = "http://127.0.0.1:3000";
const databaseUrl = getIntegrationDatabaseUrl();

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { Origin: ORIGIN, "Content-Type": "application/json", ...extra };
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function seedWaitingTransfer() {
  const pool = getPool();
  assert.ok(pool);
  const holder = await createTestUser({
    databaseUrl,
    email: `tt-phone-${randomUUID().slice(0, 8)}@test.local`,
    password: "StrongPass123!",
    fullName: "Phone Holder",
    role: "manager",
  });
  const client = await pool.connect();
  const publicCode = `TT-P-${randomUUID().slice(0, 8)}`;
  let pendingPartyId = "";
  try {
    const holderParty = await ensurePartyForUserOnWrite(client, holder.id, "Phone Holder", "+79996661101");
    pendingPartyId = (
      await client.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
         VALUES ('external', 'Pending', '+79996661102', $1::uuid) RETURNING id::text`,
        [holder.id],
      )
    ).rows[0].id;
    await client.query(
      `INSERT INTO tt_transfers (
        id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id,
        final_recipient_party_id, handoff_version
      ) VALUES ($1,$1,'Item','waiting',$2,$2,$3,$3,1)`,
      [publicCode, holderParty.id, pendingPartyId],
    );
    await client.query(
      `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
       VALUES ($1,1,$2,$3,'Item')`,
      [publicCode, holderParty.id, pendingPartyId],
    );
  } finally {
    client.release();
  }
  const token = signInvitationToken({
    transferId: publicCode,
    hv: 1,
    pendingPartyId,
    exp: Date.now() + invitationTokenTtlMs(),
  });
  return { publicCode, pendingPartyId, token };
}

describe("tan-tracker public phone guards", { concurrency: false }, () => {
  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await resetPoolForTests();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("persists wrong verify attempts and blocks after limit", async () => {
    const app = await loadApp();
    const { publicCode, pendingPartyId, token } = await seedWaitingTransfer();
    await request(app)
      .post("/api/tan-tracker/public/recipient/phone/send")
      .set(headers())
      .send({ invitationToken: token })
      .expect(200);

    for (let i = 0; i < PHONE_VERIFICATION_MAX_ATTEMPTS; i++) {
      const res = await request(app)
        .post("/api/tan-tracker/public/recipient/phone/verify")
        .set(headers())
        .send({ invitationToken: token, code: "000000" });
      assert.equal(res.status, 400);
    }

    const pool = getPool();
    const row = (
      await pool!.query<{ attempt_count: number }>(
        `SELECT attempt_count FROM tt_phone_verifications
         WHERE transfer_id = $1 AND party_id = $2::uuid ORDER BY created_at DESC LIMIT 1`,
        [publicCode, pendingPartyId],
      )
    ).rows[0];
    assert.equal(row.attempt_count, PHONE_VERIFICATION_MAX_ATTEMPTS);

    const otp = peekTestPhoneVerificationCode(publicCode, pendingPartyId);
    assert.ok(otp);
    const okRes = await request(app)
      .post("/api/tan-tracker/public/recipient/phone/verify")
      .set(headers())
      .send({ invitationToken: token, code: otp });
    assert.equal(okRes.status, 409, okRes.text);
  });

  it("cooldown blocks immediate resend", async () => {
    const app = await loadApp();
    const { token } = await seedWaitingTransfer();
    assert.equal(
      (await request(app).post("/api/tan-tracker/public/recipient/phone/send").set(headers()).send({ invitationToken: token }))
        .status,
      200,
    );
    const again = await request(app)
      .post("/api/tan-tracker/public/recipient/phone/send")
      .set(headers())
      .send({ invitationToken: token });
    assert.equal(again.status, 429, again.text);
  });

  it("blocks send after max sends in window", async () => {
    const app = await loadApp();
    const { publicCode, pendingPartyId, token } = await seedWaitingTransfer();
    const pool = getPool();
    assert.ok(pool);
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO tt_phone_verifications (transfer_id, party_id, handoff_version, code_hash, expires_at, attempt_count)
         VALUES ($1,$2::uuid,1,'x',NOW() + interval '5 minutes',0)`,
        [publicCode, pendingPartyId],
      );
    }
    const res = await request(app)
      .post("/api/tan-tracker/public/recipient/phone/send")
      .set(headers())
      .send({ invitationToken: token });
    assert.equal(res.status, 429, res.text);
  });

  it("GET public recipient context without auth", async () => {
    const app = await loadApp();
    const { token } = await seedWaitingTransfer();
    const res = await request(app)
      .get("/api/tan-tracker/public/recipient/context")
      .query({ invitationToken: token });
    assert.equal(res.status, 200);
    assert.equal(res.body.publicRecipient, true);
    assert.equal(res.body.orders.length, 1);
  });
});
