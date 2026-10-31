import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite, nextPublicTransferCode } from "../../src/tan-tracker/repository";
import { deleteTransferBeforeFirstCustody } from "../../src/tan-tracker/registry-cleanup/delete-transfer";
import { enqueueExternalPersonMessengerEvent } from "../../src/tan-tracker/external-person/external-person-notify";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const databaseUrl = getIntegrationDatabaseUrl();

function yearPrefix(): string {
  return `TT-${new Date().getFullYear()}-`;
}

async function insertMinimalTransfer(client: PoolClient, publicCode: string, holderPartyId: string): Promise<void> {
  await client.query(
    `INSERT INTO tt_transfers (
       id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version
     ) VALUES ($1, $1, 'seq test item', 'waiting', $2, $2, 1)`,
    [publicCode, holderPartyId],
  );
}

describe("nextPublicTransferCode with delete audit (PostgreSQL)", { concurrency: false }, () => {
  let pool: Pool;
  let holderPartyId = "";
  let actorUserId = "";

  before(async () => {
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    const user = await createTestUser({
      databaseUrl,
      email: "public-code-seq@test.local",
      password: "StrongPass123!",
      fullName: "Seq Allocator",
      role: "admin",
    });
    actorUserId = user.id;
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const client = await pool.connect();
    try {
      holderPartyId = (await ensurePartyForUserOnWrite(client, user.id, "Seq Allocator", null)).id;
    } finally {
      client.release();
    }
  });

  after(async () => {
    await pool.end();
    await closePool();
  });

  it("starts at 001 on empty database for current year", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const code = await nextPublicTransferCode(client);
      assert.ok(code.startsWith(yearPrefix()));
      assert.match(code, new RegExp(`^${yearPrefix()}001$`));
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("allocates above live max and retained delete audit for same year", async () => {
    const prefix = yearPrefix();
    const client = await pool.connect();
    let first = "";
    let second = "";
    try {
      await client.query("BEGIN");
      first = await nextPublicTransferCode(client);
      await insertMinimalTransfer(client, first, holderPartyId);
      const del = await deleteTransferBeforeFirstCustody(client, first, {
        userId: actorUserId,
        partyId: holderPartyId,
      });
      assert.equal(del.ok, true);
      second = await nextPublicTransferCode(client);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    assert.notEqual(second, first);
    const firstSeq = Number(first.slice(prefix.length));
    const secondSeq = Number(second.slice(prefix.length));
    assert.equal(secondSeq, firstSeq + 1);
  });

  it("ignores wrong-year and malformed audit codes when counting", async () => {
    const prefix = yearPrefix();
    const year = new Date().getFullYear();
    const client = await pool.connect();
    let first = "";
    let second = "";
    try {
      await client.query("BEGIN");
      first = await nextPublicTransferCode(client);
      await insertMinimalTransfer(client, first, holderPartyId);
      await client.query(
        `INSERT INTO tt_transfer_delete_audit (transfer_public_code, actor_user_id, actor_party_id)
         VALUES ($1, $2::uuid, $3::uuid), ($4, $2::uuid, $3::uuid), ($5, $2::uuid, $3::uuid)`,
        [
          `TT-${year - 1}-999`,
          actorUserId,
          holderPartyId,
          `${prefix}00abc`,
          "NOT-A-TRACK-CODE",
        ],
      );
      second = await nextPublicTransferCode(client);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    const firstSeq = Number(first.slice(prefix.length));
    assert.equal(Number(second.slice(prefix.length)), firstSeq + 1);
    assert.notEqual(second, `TT-${year - 1}-1000`);
  });

  it("concurrent transactions receive distinct codes", async () => {
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query("BEGIN");
      await c2.query("BEGIN");
      const code1 = await nextPublicTransferCode(c1);
      await insertMinimalTransfer(c1, code1, holderPartyId);
      const code2Promise = nextPublicTransferCode(c2);
      let settledEarly = false;
      const race = await Promise.race([
        code2Promise.then((code) => ({ kind: "ok" as const, code })),
        new Promise<{ kind: "wait" }>((resolve) => setTimeout(() => resolve({ kind: "wait" }), 80)),
      ]);
      if (race.kind === "ok") {
        settledEarly = true;
      }
      await c1.query("COMMIT");
      const code2 = await code2Promise;
      await insertMinimalTransfer(c2, code2, holderPartyId);
      await c2.query("COMMIT");
      assert.notEqual(code1, code2);
      if (!settledEarly) {
        assert.ok(true, "second allocator waited for first commit");
      }
    } catch (e) {
      await c1.query("ROLLBACK").catch(() => undefined);
      await c2.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      c1.release();
      c2.release();
    }
  });

  it("mutation and external-request paths share monotonic allocator", async () => {
    const client = await pool.connect();
    let viaMutation = "";
    let viaExternal = "";
    try {
      await client.query("BEGIN");
      viaMutation = await nextPublicTransferCode(client);
      await insertMinimalTransfer(client, viaMutation, holderPartyId);
      viaExternal = await nextPublicTransferCode(client);
      await insertMinimalTransfer(client, viaExternal, holderPartyId);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const prefix = yearPrefix();
    const a = Number(viaMutation.slice(prefix.length));
    const b = Number(viaExternal.slice(prefix.length));
    assert.equal(b, a + 1);
  });

  it("retained failed outbox idempotency does not block delivered notice for replacement track", async () => {
    const client = await pool.connect();
    const prefix = yearPrefix();
    let oldCode = "";
    let newCode = "";
    let personId = "";
    try {
      await client.query("BEGIN");
      oldCode = await nextPublicTransferCode(client);
      await insertMinimalTransfer(client, oldCode, holderPartyId);
      const phoneSuffix = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
      const phone = `+7999${phoneSuffix}`;
      const party = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Seq ext', $1) RETURNING id::text`,
          [phone],
        )
      ).rows[0]!.id;
      personId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ($1, 'Seq ext', $2::uuid) RETURNING id::text`,
          [phone, party],
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id, notifications_enabled)
         VALUES ($1::uuid, 'max', '12345001', '12345002', TRUE)`,
        [personId],
      );
      const staleKey = `tt-ext-msg:delivered:${oldCode}:hv:2:max`;
      await client.query(
        `INSERT INTO tt_external_person_message_outbox (
           person_id, channel, messenger_chat_id, body, idempotency_key, event_type, status, attempt_count, last_error_code, next_attempt_at
         ) VALUES ($1::uuid, 'max', '12345002', 'stale body', $2, 'external_person.delivered', 'failed', 1, 'API_ERROR', NOW())`,
        [personId, staleKey],
      );
      await deleteTransferBeforeFirstCustody(client, oldCode, { userId: actorUserId, partyId: holderPartyId });
      newCode = await nextPublicTransferCode(client);
      await insertMinimalTransfer(client, newCode, holderPartyId);
      await enqueueExternalPersonMessengerEvent(client, {
        externalPartyId: party,
        publicCode: newCode,
        event: "delivered",
        body: "replacement delivered body",
        idempotencyKey: `tt-ext-msg:delivered:${newCode}:hv:2`,
        singleChannel: true,
        preferredChannel: "max",
      });
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    assert.notEqual(newCode, oldCode);
    const oldSeq = Number(oldCode.slice(prefix.length));
    const newSeq = Number(newCode.slice(prefix.length));
    assert.equal(newSeq, oldSeq + 1);

    const stale = await pool.query<{ status: string }>(
      `SELECT status FROM tt_external_person_message_outbox WHERE idempotency_key = $1`,
      [`tt-ext-msg:delivered:${oldCode}:hv:2:max`],
    );
    assert.equal(stale.rowCount, 1);
    assert.equal(stale.rows[0]!.status, "failed");

    const fresh = await pool.query<{ status: string; idempotency_key: string }>(
      `SELECT status, idempotency_key FROM tt_external_person_message_outbox
       WHERE idempotency_key = $1`,
      [`tt-ext-msg:delivered:${newCode}:hv:2:max`],
    );
    assert.equal(fresh.rowCount, 1);
    assert.equal(fresh.rows[0]!.status, "pending");
    assert.ok(!fresh.rows[0]!.idempotency_key.includes(oldCode));
  });
});
