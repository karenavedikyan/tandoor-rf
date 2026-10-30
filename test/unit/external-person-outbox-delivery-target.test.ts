import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { resolveExternalPersonOutboxDeliveryTarget } from "../../src/tan-tracker/external-person/outbox-worker";

describe("resolveExternalPersonOutboxDeliveryTarget", { concurrency: false }, () => {
  const databaseUrl = getIntegrationDatabaseUrl();
  let pool: Pool;

  before(async () => {
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    await prepareDatabase(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
  });

  after(async () => {
    await pool.end();
  });

  it("returns messenger_user_id when chat binding matches", async () => {
    const client = await pool.connect();
    try {
      const party = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Target test', '+79991110001') RETURNING id::text`,
        )
      ).rows[0]!.id;
      const person = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79991110002', 'Target test', $1::uuid) RETURNING id::text`,
          [party],
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id, notifications_enabled)
         VALUES ($1::uuid, 'max', '887766001', '887766552', TRUE)`,
        [person],
      );
      const target = await resolveExternalPersonOutboxDeliveryTarget(client, person, "max", "887766552");
      assert.equal(target.ok, true);
      if (target.ok) {
        assert.equal(target.messengerUserId, "887766001");
        assert.equal(target.messengerChatId, "887766552");
      }
    } finally {
      client.release();
    }
  });

  it("rejects stale queued chat id without retargeting", async () => {
    const client = await pool.connect();
    try {
      const party = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Stale chat', '+79991110003') RETURNING id::text`,
        )
      ).rows[0]!.id;
      const person = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79991110004', 'Stale chat', $1::uuid) RETURNING id::text`,
          [party],
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id, notifications_enabled)
         VALUES ($1::uuid, 'max', '887766003', '887766553', TRUE)`,
        [person],
      );
      const target = await resolveExternalPersonOutboxDeliveryTarget(client, person, "max", "999999999");
      assert.equal(target.ok, false);
      if (!target.ok) assert.equal(target.code, "NO_VERIFICATION");
    } finally {
      client.release();
    }
  });
});
