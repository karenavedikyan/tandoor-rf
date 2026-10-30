import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { applyPendingReceiptHandoff } from "../../src/tan-tracker/handoff-complete";
import { upsertVerifiedPerson } from "../../src/tan-tracker/external-person/person-service";
import { withTransaction } from "../../src/access/db";

const databaseUrl = getIntegrationDatabaseUrl();
const PHONE = "+79994002001";
const TG_USER = 94002001n;
const MAX_USER = 94002002n;

describe("generic external person receipt notify without invitation session (PG)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
    delete process.env.TT_EXTERNAL_MESSENGER_ENABLED;
  });

  it("applyPendingReceiptHandoff fans out after_receipt to all verified channels (trusted provenance)", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);

    const staff = await createTestUser({
      databaseUrl,
      email: "generic-ext-notify-staff@test.local",
      password: "StrongPass123!",
      fullName: "Generic Staff",
      role: "manager",
    });

    const client = await pool.connect();
    const transferId = "TT-GENERIC-EXT-NOTIFY-1";
    let pendingPartyId = "";
    try {
      await client.query("BEGIN");
      const holderParty = await ensurePartyForUserOnWrite(client, staff.id, "Generic Staff", "+79994002000");
      const finalPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Final Ext', '+79994002099') RETURNING id::text`,
        )
      ).rows[0]!.id;
      pendingPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Generic Ext', $1) RETURNING id::text`,
          [PHONE],
        )
      ).rows[0]!.id;

      await upsertVerifiedPerson(client, {
        channel: "telegram",
        messengerUserId: TG_USER,
        messengerChatId: TG_USER,
        phoneRaw: PHONE,
        displayName: "Generic Ext",
      });
      await upsertVerifiedPerson(client, {
        channel: "max",
        messengerUserId: MAX_USER,
        messengerChatId: MAX_USER,
        phoneRaw: PHONE,
        displayName: "Generic Ext",
      });

      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, from_external, creator_party_id, holder_party_id,
                                  pending_party_id, final_recipient_party_id, handoff_version, row_version)
         VALUES ($1, 'GEXT1', 'Generic route item', 'waiting', TRUE, $2, $2, $3::uuid, $4::uuid, 1, 1)`,
        [transferId, holderParty.id, pendingPartyId, finalPartyId],
      );

      const sessionCount = await client.query(
        `SELECT 1 FROM tt_external_messenger_sessions WHERE transfer_id = $1`,
        [transferId],
      );
      assert.equal(sessionCount.rowCount, 0);

      await applyPendingReceiptHandoff(
        client,
        {
          id: transferId,
          holder_party_id: holderParty.id,
          pending_party_id: pendingPartyId,
          final_recipient_party_id: finalPartyId,
          handoff_version: 1,
          row_version: 1,
        },
        staff.id,
        pendingPartyId,
        "generic public holder receipt",
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const outbox = await pool.query<{ channel: string; event_type: string }>(
      `SELECT o.channel, o.event_type FROM tt_external_person_message_outbox o
       JOIN tt_external_persons p ON p.id = o.person_id
       WHERE p.party_id = $1::uuid
       ORDER BY o.channel`,
      [pendingPartyId],
    );
    assert.equal(outbox.rowCount, 2);
    assert.deepEqual(
      outbox.rows.map((r) => r.channel).sort(),
      ["max", "telegram"],
    );
    assert.ok(outbox.rows.every((r) => r.event_type === "external_person.after_receipt"));
  });

  it("does not treat expired invitation session as generic — no cross-channel fallback", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);

    const staff = await createTestUser({
      databaseUrl,
      email: "generic-ext-notify-stale@test.local",
      password: "StrongPass123!",
      fullName: "Stale Staff",
      role: "manager",
    });

    const phone = "+79994002013";
    const maxUserId = 94002013;
    let pendingPartyId = "";
    const transferId = "TT-GENERIC-EXT-STALE-1";

    const holderParty = await withTransaction(async (client) => {
      const hp = await ensurePartyForUserOnWrite(client, staff.id, "Stale Staff", "+79994002012");
      pendingPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Stale Ext', $1) RETURNING id::text`,
          [phone],
        )
      ).rows[0]!.id;
      await upsertVerifiedPerson(client, {
        channel: "telegram",
        messengerUserId: 940020130n,
        messengerChatId: 940020130n,
        phoneRaw: phone,
        displayName: "Stale TG only",
      });
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, from_external, creator_party_id, holder_party_id,
                                  pending_party_id, final_recipient_party_id, handoff_version, row_version)
         VALUES ($1, 'GSTALE', 'Stale invite item', 'waiting', TRUE, $2, $2, $3::uuid, $3::uuid, 1, 1)`,
        [transferId, hp.id, pendingPartyId],
      );
      await client.query(
        `INSERT INTO tt_external_messenger_sessions (
           token_hash, transfer_id, pending_party_id, handoff_version, channel, phone_verified_at, code_issued_at,
           expires_at, bound_max_user_id, max_chat_id, superseded_at
         ) VALUES ($1, $2, $3::uuid, 1, 'max', NOW(), NOW(), NOW() - interval '1 minute', $4, $4, NULL)`,
        [
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab",
          transferId,
          pendingPartyId,
          maxUserId.toString(),
        ],
      );
      return hp;
    });

    await withTransaction(async (client) => {
      await applyPendingReceiptHandoff(
        client,
        {
          id: transferId,
          holder_party_id: holderParty.id,
          pending_party_id: pendingPartyId,
          final_recipient_party_id: pendingPartyId,
          handoff_version: 1,
          row_version: 1,
        },
        staff.id,
        pendingPartyId,
        "stale invitation must not fan out",
      );
    });

    const outbox = await pool.query(
      `SELECT 1 FROM tt_external_person_message_outbox o
       JOIN tt_external_persons p ON p.id = o.person_id
       WHERE p.party_id = $1::uuid`,
      [pendingPartyId],
    );
    assert.equal(outbox.rowCount, 0);
  });
});
