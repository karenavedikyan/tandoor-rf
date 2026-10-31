import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MockAgent, setGlobalDispatcher } from "undici";
import { getPool, closePool } from "../../src/db/pool";
import { handleExternalPersonMaxPhoto } from "../../src/tanbot/external-person/max-bot-flow";
import { nativeBotDraftChatKey } from "../../src/tanbot/native-create/draft-scope";
import { readAttachmentBytes } from "../../src/tan-tracker/attachment-storage";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";

const databaseUrl = getIntegrationDatabaseUrl();
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe("external MAX bot durable photo", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("rejects non-allowlisted download URL without storing draft file", async () => {
    const pool = getPool()!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const partyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Max Photo', '+79996667701') RETURNING id::text`,
        )
      ).rows[0]!.id;
      const personId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79996667701', 'Max Photo', $1::uuid) RETURNING id::text`,
          [partyId],
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
         VALUES($1,'max','90001','90001')`, [personId]);
      const draftId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_request_drafts (channel, messenger_chat_id, person_id, step, payload)
           VALUES ('max', $2, $1::uuid, 'photo', $3::jsonb) RETURNING id::text`,
          [personId, nativeBotDraftChatKey({ channel: "max", messengerChatId: "90001", actor: "external" }),
            JSON.stringify({ draftOrigin: "native_bot", actor: "external", revision: 1, item: "Synthetic photo" })],
        )
      ).rows[0]!.id;
      const bad = await handleExternalPersonMaxPhoto(client, {
        chatId: 90001n,
        maxUserId: 90001n,
        downloadUrl: "https://attacker.example/steal.jpg",
        fileName: "x.jpg",
        recipientChatType: "dialog",
      });
      assert.ok(bad?.text?.includes("недоступна") || bad?.text?.includes("изображение"));
      const files = await client.query(`SELECT 1 FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`, [
        draftId,
      ]);
      assert.equal(files.rowCount, 0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("stores draft file when allowlisted URL returns jpeg bytes", async () => {
    const agent = new MockAgent();
    setGlobalDispatcher(agent);
    const mockPool = agent.get("https://iu.oneme.ru");
    mockPool
      .intercept({ path: "/photo/test.jpg", method: "GET" })
      .reply(200, JPEG, { headers: { "content-type": "image/jpeg" } });

    const pool = getPool()!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const partyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Max Photo2', '+79996667702') RETURNING id::text`,
        )
      ).rows[0]!.id;
      const personId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79996667702', 'Max Photo2', $1::uuid) RETURNING id::text`,
          [partyId],
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
         VALUES($1,'max','90002','90002')`, [personId]);
      const draftId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_external_request_drafts (channel, messenger_chat_id, person_id, step, payload)
           VALUES ('max', $2, $1::uuid, 'photo', $3::jsonb) RETURNING id::text`,
          [personId, nativeBotDraftChatKey({ channel: "max", messengerChatId: "90002", actor: "external" }),
            JSON.stringify({ draftOrigin: "native_bot", actor: "external", revision: 1, item: "Synthetic photo" })],
        )
      ).rows[0]!.id;
      const ok = await handleExternalPersonMaxPhoto(client, {
        chatId: 90002n,
        maxUserId: 90002n,
        downloadUrl: "https://iu.oneme.ru/photo/test.jpg",
        fileName: "test.jpg",
        recipientChatType: "dialog",
      });
      assert.match(ok?.text ?? "", /фото/i);
      assert.ok(ok?.inlineButtons?.flat().some(button => button.text === "Далее"),
        "successful upload returns the native next-step button");
      const files = await client.query<{ storage_key: string }>(
        `SELECT storage_key FROM tt_external_request_draft_files WHERE draft_id = $1::uuid`,
        [draftId],
      );
      assert.equal(files.rowCount, 1);
      assert.match(files.rows[0]!.storage_key, /^native-draft\//);
      assert.deepEqual(await readAttachmentBytes(files.rows[0]!.storage_key, client), JPEG);
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await agent.close();
    }
  });
});
