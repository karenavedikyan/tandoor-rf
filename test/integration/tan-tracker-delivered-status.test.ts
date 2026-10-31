import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { applyPendingReceiptHandoff } from "../../src/tan-tracker/handoff-complete";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { verifyHolderAccessAllowExpired, signHolderAccess, holderAccessTtlMs } from "../../src/tan-tracker/holder-access";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

describe("tan-tracker delivered status", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("final recipient receipt sets delivered not completed", async () => {
    const creator = await createTestUser({
      databaseUrl,
      email: "delivered-creator@test.local",
      password: PASSWORD,
      fullName: "Creator",
      role: "manager",
    });
    const pool = getPool()!;
    const client = await pool.connect();
    let transferId = "";
    let finalPartyId = "";
    try {
      await client.query("BEGIN");
      const creatorParty = await ensurePartyForUserOnWrite(client, creator.id, "Creator", "+79991110001");
      finalPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Final Ext', '+79992220002') RETURNING id::text`,
        )
      ).rows[0]!.id;
      transferId = "tt-delivered-1";
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version, row_version)
         VALUES ($1, 'DEL1', 'Widget', 'waiting', $2, $2, $3, $3, 1, 1)`,
        [transferId, creatorParty.id, finalPartyId],
      );
      const row = (
        await client.query(
          `SELECT id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version, row_version FROM tt_transfers WHERE id = $1`,
          [transferId],
        )
      ).rows[0]!;
      const outcome = await applyPendingReceiptHandoff(
        client,
        row as {
          id: string;
          holder_party_id: string;
          pending_party_id: string | null;
          final_recipient_party_id: string | null;
          handoff_version: number;
          row_version: number;
        },
        creator.id,
        finalPartyId,
        "test receipt",
      );
      assert.equal(outcome.transferStatus, "delivered");
      assert.equal(outcome.routeComplete, true);
      const after = (
        await client.query<{ status: string; completed_at: Date | null; delivered_at: Date | null }>(
          `SELECT status, completed_at, delivered_at FROM tt_transfers WHERE id = $1`,
          [transferId],
        )
      ).rows[0]!;
      assert.equal(after.status, "delivered");
      assert.equal(after.completed_at, null);
      assert.ok(after.delivered_at);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });

  it("explicit close moves delivered to completed", async () => {
    const user = await createTestUser({
      databaseUrl,
      email: "delivered-close@test.local",
      password: PASSWORD,
      fullName: "Closer",
      role: "manager",
    });
    const pool = getPool()!;
    const client = await pool.connect();
    let transferId = "";
    try {
      await client.query("BEGIN");
      const party = await ensurePartyForUserOnWrite(client, user.id, "Closer", "+79993330003");
      transferId = "tt-delivered-2";
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version, delivered_at)
         VALUES ($1, 'DEL2', 'Item', 'delivered', $2, $2, 2, 1, NOW())`,
        [transferId, party.id],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const app = await loadApp();
    const db = getPool()!;
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN, "Content-Type": "application/json" })
      .send({ email: "delivered-close@test.local", password: PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const res = await request(app)
      .post(`/api/tan-tracker/transfers/${transferId}/legacy-complete`)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({});
    assert.equal(res.status, 200, res.text);
    const row = await db.query(`SELECT status FROM tt_transfers WHERE id = $1`, [transferId]);
    assert.equal(row.rows[0]?.status, "completed");
  });

  it("former creator cannot close a delivered transfer held by another party", async () => {
    const creator = await createTestUser({
      databaseUrl,
      email: "delivered-creator-close@test.local",
      password: PASSWORD,
      fullName: "Creator Close",
      role: "manager",
    });
    const pool = getPool()!;
    const client = await pool.connect();
    let transferId = "";
    let externalPartyId = "";
    try {
      await client.query("BEGIN");
      const creatorParty = await ensurePartyForUserOnWrite(client, creator.id, "Creator Close", "+79995550005");
      externalPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Final Client', '+79995550006') RETURNING id::text`,
        )
      ).rows[0]!.id;
      transferId = "tt-delivered-ext-close";
      await client.query(
        `INSERT INTO tt_transfers (
           id, public_code, item_title, status, creator_party_id, holder_party_id,
           final_recipient_party_id, handoff_version, row_version, delivered_at, from_external
         ) VALUES ($1, 'DELX', 'Gift', 'delivered', $2, $3, $3, 4, 1, NOW(), TRUE)`,
        [transferId, creatorParty.id, externalPartyId],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const app = await loadApp();
    const db = getPool()!;
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN, "Content-Type": "application/json" })
      .send({ email: "delivered-creator-close@test.local", password: PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const beforeTimeline = await db.query(`SELECT COUNT(*)::int AS n FROM tt_transfer_timeline WHERE transfer_id = $1`, [transferId]);
    const beforeAudit = await db.query(`SELECT COUNT(*)::int AS n FROM tt_audit_log WHERE transfer_id = $1`, [transferId]);
    const res = await request(app)
      .post(`/api/tan-tracker/transfers/${transferId}/legacy-complete`)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({});
    assert.equal(res.status, 403, res.text);
    const row = await db.query<{ status: string; handoff_version: number }>(
      `SELECT status, handoff_version FROM tt_transfers WHERE id = $1`,
      [transferId],
    );
    assert.equal(row.rows[0]?.status, "delivered");
    assert.equal(row.rows[0]?.handoff_version, 4);
    const afterTimeline = await db.query(`SELECT COUNT(*)::int AS n FROM tt_transfer_timeline WHERE transfer_id = $1`, [transferId]);
    assert.equal(afterTimeline.rows[0]?.n, beforeTimeline.rows[0]?.n);
    const afterAudit = await db.query(`SELECT COUNT(*)::int AS n FROM tt_audit_log WHERE transfer_id = $1`, [transferId]);
    assert.equal(afterAudit.rows[0]?.n, beforeAudit.rows[0]?.n);
  });

  it("holder access token cannot refresh after explicit close", async () => {
    const pool = getPool()!;
    const transferId = "tt-delivered-4";
    const partyId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'H2', '+79996660007') RETURNING id::text`,
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version, delivered_at, completed_at)
       VALUES ($1, 'DEL4', 'Y', 'completed', $2, $2, 9, 1, NOW(), NOW())`,
      [transferId, partyId],
    );
    const stale = signHolderAccess({
      transferId,
      partyId,
      hv: 9,
      exp: Date.now() - 86_400_000,
    });
    const app = await loadApp();
    const ctx = await request(app).get(
      `/api/tan-tracker/public/holder/context?holderAccessToken=${encodeURIComponent(stale)}`,
    );
    assert.equal(ctx.status, 404, ctx.text);
  });

  it("holder access token cannot refresh after handoff version change", async () => {
    const pool = getPool()!;
    const transferId = "tt-delivered-5";
    const partyId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'H3', '+79997770008') RETURNING id::text`,
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version)
       VALUES ($1, 'DEL5', 'Z', 'active', $2, $2, 3, 1)`,
      [transferId, partyId],
    );
    const stale = signHolderAccess({
      transferId,
      partyId,
      hv: 2,
      exp: Date.now() - 60_000,
    });
    const app = await loadApp();
    const ctx = await request(app).get(
      `/api/tan-tracker/public/holder/context?holderAccessToken=${encodeURIComponent(stale)}`,
    );
    assert.equal(ctx.status, 404, ctx.text);
  });

  it("expired holder token refreshes on context when still holder", async () => {
    const pool = getPool()!;
    const transferId = "tt-delivered-3";
    const partyId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'H', '+79994440004') RETURNING id::text`,
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version)
       VALUES ($1, 'DEL3', 'X', 'active', $2, $2, 1, 1)`,
      [transferId, partyId],
    );
    const expired = signHolderAccess({
      transferId,
      partyId,
      hv: 1,
      exp: Date.now() - 60_000,
    });
    assert.equal(verifyHolderAccessAllowExpired(expired)?.transferId, transferId);
    const app = await loadApp();
    const ctx = await request(app).get(
      `/api/tan-tracker/public/holder/context?holderAccessToken=${encodeURIComponent(expired)}`,
    );
    assert.equal(ctx.status, 200, ctx.text);
    assert.ok(ctx.body.holderAccessToken);
    assert.notEqual(ctx.body.holderAccessToken, expired);
  });
});
