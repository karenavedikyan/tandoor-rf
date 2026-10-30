import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { confirmExternalRequestDraft } from "../../src/tan-tracker/external-request/confirm";
import { ensureActiveExternalRequestDraft } from "../../src/tan-tracker/external-request/draft-store";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";

const databaseUrl = getIntegrationDatabaseUrl();

describe("external request draft identity", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("sequential confirms create distinct transfers; replay is idempotent; max 5 enforced", async () => {
    await resetPoolForTests();
    const staff = await createTestUser({
      databaseUrl,
      email: "ext-draft-id@test.local",
      password: "StrongPass123!",
      fullName: "Draft Staff",
      role: "manager",
    });
    const pool = getPool()!;
    const client = await pool.connect();
    const personId = randomUUID();
    const chatId = "draft-id-chat-1";
    let externalPartyId = "";
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE users SET accepts_external_tt_intake = TRUE WHERE id = $1::uuid`, [staff.id]);
      await ensurePartyForUserOnWrite(client, staff.id, "Draft Staff", "+79997776601");
      externalPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Draft Ext', '+79997776602') RETURNING id::text`,
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_external_persons (id, phone_e164, display_name, party_id) VALUES ($1::uuid, '+79997776602', 'Draft Ext', $2::uuid)`,
        [personId, externalPartyId],
      );
      await client.query(
        `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
         VALUES ($1::uuid, 'telegram', '99001', $2)`,
        [personId, chatId],
      );

      const draft1 = await ensureActiveExternalRequestDraft(client, {
        channel: "telegram",
        messengerChatId: chatId,
        personId,
        step: "summary",
        payload: { item: "First", recipientUserId: staff.id, dueMode: "today" },
      });
      const first = await confirmExternalRequestDraft(client, {
        personId,
        externalPartyId,
        draftId: draft1.id,
        idempotencyKey: `ext-req:${draft1.id}`,
      });
      const replay = await confirmExternalRequestDraft(client, {
        personId,
        externalPartyId,
        draftId: draft1.id,
        idempotencyKey: `ext-req:${draft1.id}`,
      });
      assert.equal(replay.publicCode, first.publicCode);

      const draft2 = await ensureActiveExternalRequestDraft(client, {
        channel: "telegram",
        messengerChatId: chatId,
        personId,
        step: "summary",
        payload: { item: "Second", recipientUserId: staff.id, dueMode: "tomorrow" },
      });
      assert.notEqual(draft2.id, draft1.id);
      const second = await confirmExternalRequestDraft(client, {
        personId,
        externalPartyId,
        draftId: draft2.id,
        idempotencyKey: `ext-req:${draft2.id}`,
      });
      assert.notEqual(second.publicCode, first.publicCode);

      for (let i = 0; i < 4; i++) {
        const d = await ensureActiveExternalRequestDraft(client, {
          channel: "telegram",
          messengerChatId: chatId,
          personId,
          step: "summary",
          payload: { item: `Extra ${i}`, recipientUserId: staff.id, dueMode: "today" },
        });
        await confirmExternalRequestDraft(client, {
          personId,
          externalPartyId,
          draftId: d.id,
          idempotencyKey: `ext-req:${d.id}`,
        });
      }
      const blocked = await ensureActiveExternalRequestDraft(client, {
        channel: "telegram",
        messengerChatId: chatId,
        personId,
        step: "summary",
        payload: { item: "Sixth", recipientUserId: staff.id, dueMode: "today" },
      });
      await assert.rejects(
        () =>
          confirmExternalRequestDraft(client, {
            personId,
            externalPartyId,
            draftId: blocked.id,
            idempotencyKey: `ext-req:${blocked.id}`,
          }),
        (err: Error & { http?: number }) => err.http === 409,
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
