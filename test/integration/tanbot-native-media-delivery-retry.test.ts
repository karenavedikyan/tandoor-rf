import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { buildNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import type { TelegramDeliveryTransport } from "../../src/tanbot-telegram/delivery-transport";
import type { MaxDeliveryTransport } from "../../src/tanbot-max/delivery-transport";
import { buildMaxSendMessagePayload } from "../../src/tanbot-max/delivery-transport";

const databaseUrl = getIntegrationDatabaseUrl();
const ORIGIN = "http://127.0.0.1:3000";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const SYNTH_MAX_TOKEN = "synthetic-native-preview-max-token-001";
const TG_FILE_ID = "synthetic-file-id-retry";

describe("native media delivery retry and terminal cancel", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_BOT_TOKEN = "123456789:SYNTH_MEDIA_RETRY_TG";
    process.env.TANBOT_TELEGRAM_BOT_USERNAME = "TANDOOR_MEDIA_RETRY";
    process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = "test-link-pepper-min-16-chars";
    process.env.TANBOT_TELEGRAM_WEBHOOK_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret-min-16";
    process.env.TANBOT_TELEGRAM_DELIVERY_ENABLED = "false";
    process.env.TANBOT_MAX_ENABLED = "true";
    process.env.TANBOT_MAX_BOT_TOKEN = "SYNTH_MEDIA_RETRY_MAX_TOKEN";
    process.env.TANBOT_MAX_BOT_USERNAME = "id231100522180_bot";
    process.env.TANBOT_MAX_LINK_TOKEN_PEPPER = "test-max-link-pepper-min-16-chars";
    process.env.TANBOT_MAX_WEBHOOK_ENABLED = "true";
    process.env.TANBOT_MAX_WEBHOOK_SECRET = "test-max-webhook-secret-min16";
    process.env.TANBOT_MAX_DELIVERY_ENABLED = "false";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  async function telegramInboxRow(pool: import("pg").Pool, updateId: number) {
    const row = await pool.query(`SELECT reply_delivered_at, reply_extra FROM tanbot_telegram_update_dedup WHERE update_id=$1`, [
      updateId,
    ]);
    assert.equal(row.rowCount, 1);
    const extra = row.rows[0]!.reply_extra;
    return {
      reply_delivered_at: row.rows[0]!.reply_delivered_at,
      reply_extra: typeof extra === "string" ? JSON.parse(extra) : extra,
    };
  }

  async function seedTelegramExternalDraft(input: {
    tgUserId: number;
    phone: string;
    updateId: number;
    delivery: { primary: boolean; copyOnly?: boolean };
    includeDraft: boolean;
    includeVerification: boolean;
  }): Promise<{ personId: string; draftId: string }> {
    const pool = getPool()!;
    await pool.query(`INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Media Ext', $1)`, [
      input.phone,
    ]);
    const partyId = (await pool.query<{ id: string }>(`SELECT id::text FROM tt_parties WHERE phone_e164=$1`, [input.phone]))
      .rows[0]!.id;
    const personId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (party_id, display_name, phone_e164)
         VALUES ($1::uuid,'Media Ext',$2) RETURNING id::text`,
        [partyId, input.phone],
      )
    ).rows[0]!.id;
    if (input.includeVerification) {
      await pool.query(
        `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
         VALUES ($1::uuid,'telegram',$2,$3)`,
        [personId, String(input.tgUserId), String(input.tgUserId)],
      );
    }
    const chatKey = `native:ext:telegram:${input.tgUserId}`;
    let draftId = "00000000-0000-4000-8000-000000000001";
    if (input.includeDraft) {
      draftId = (
        await pool.query<{ id: string }>(
          `INSERT INTO tt_external_request_drafts (channel, messenger_chat_id, person_id, step, payload)
           VALUES ('telegram', $1, $2::uuid, 'summary', $3::jsonb) RETURNING id::text`,
          [
            chatKey,
            personId,
            JSON.stringify({ draftOrigin: "native_bot", revision: 3, actor: "external" }),
          ],
        )
      ).rows[0]!.id;
      await pool.query(
        `INSERT INTO tt_external_request_draft_files
         (draft_id, storage_key, file_name, mime_type, byte_size, sort_order, telegram_file_id)
         VALUES ($1::uuid, 'external-draft/synthetic', 'x.jpg', 'image/jpeg', 10, 0, $2)`,
        [draftId, TG_FILE_ID],
      );
    }
    await pool.query(
      `INSERT INTO tanbot_telegram_update_dedup
       (update_id, reply_chat_id, reply_text, reply_extra, status)
       VALUES ($1, $2, 'Photo preview text', $3::jsonb, 'committed')`,
      [
        input.updateId,
        input.tgUserId,
        JSON.stringify({
          nativeMediaQueue: [{ channel: "telegram", draftId, sortOrder: 0, telegramFileId: TG_FILE_ID }],
          nativeMediaScope: {
            messengerChatId: String(input.tgUserId),
            messengerUserId: String(input.tgUserId),
            actor: "external",
            channel: "telegram",
          },
          delivery: input.delivery,
        }),
      ],
    );
    return { personId, draftId };
  }

  it("telegram: primary succeeds, sendPhoto fails once, retry sends only photo", async () => {
    await resetPoolForTests();
    const tgUserId = 88006001;
    const updateId = 880060010;
    await seedTelegramExternalDraft({
      tgUserId,
      phone: "+79995558801",
      updateId,
      delivery: { primary: false },
      includeDraft: true,
      includeVerification: true,
    });
    const pool = getPool()!;
    const loaded = loadTanbotTelegramStage2Config();
    assert.ok(loaded.ok);
    const methods: string[] = [];
    let photoAttempts = 0;
    const failTransport: TelegramDeliveryTransport = async (input) => {
      methods.push(input.method);
      if (input.method === "sendPhoto") {
        photoAttempts += 1;
        if (photoAttempts === 1) {
          return { ok: false, code: "HTTP_ERROR", message: "synthetic photo fail", retryable: true };
        }
      }
      return { ok: true, result: {} };
    };
    await processUndeliveredTelegramWebhookReplies(pool, loaded.config, failTransport, { deliveryEnabled: true });
    assert.equal(methods.filter((m) => m === "sendMessage").length, 1);
    assert.equal(methods.filter((m) => m === "sendPhoto").length, 1);
    assert.equal((await telegramInboxRow(pool, updateId)).reply_delivered_at, null);

    const retryMethods: string[] = [];
    await processUndeliveredTelegramWebhookReplies(pool, loaded.config, async (input) => {
      retryMethods.push(input.method);
      return { ok: true, result: {} };
    }, { deliveryEnabled: true });
    assert.deepEqual(retryMethods, ["sendPhoto"]);
    assert.ok((await telegramInboxRow(pool, updateId)).reply_delivered_at);
  });

  it("telegram: obsolete draft marks media canceled and completes outbox on retry", async () => {
    await resetPoolForTests();
    const tgUserId = 88006002;
    const updateId = 880060020;
    const { draftId } = await seedTelegramExternalDraft({
      tgUserId,
      phone: "+79995558802",
      updateId,
      delivery: { primary: false },
      includeDraft: true,
      includeVerification: true,
    });
    const pool = getPool()!;
    await pool.query(`DELETE FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId]);
    const loaded = loadTanbotTelegramStage2Config();
    assert.ok(loaded.ok);
    const sink: string[] = [];
    await processUndeliveredTelegramWebhookReplies(pool, loaded.config, async (input) => {
      sink.push(input.method);
      return { ok: true, result: {} };
    }, { deliveryEnabled: true });
    assert.ok(sink.includes("sendMessage"));
    assert.equal(sink.filter((m) => m === "sendPhoto").length, 0);
    const row = await telegramInboxRow(pool, updateId);
    assert.ok(row.reply_delivered_at);
    assert.equal(row.reply_extra.nativeMediaProgress.disposition, "canceled");
    const second = await processUndeliveredTelegramWebhookReplies(pool, loaded.config, async () => ({ ok: true, result: {} }), {
      deliveryEnabled: true,
    });
    assert.equal(second.attempted, 0);
  });

  it("telegram: revoked verification terminally cancels pending media", async () => {
    await resetPoolForTests();
    const tgUserId = 88006003;
    const updateId = 880060030;
    const { personId } = await seedTelegramExternalDraft({
      tgUserId,
      phone: "+79995558803",
      updateId,
      delivery: { primary: true },
      includeDraft: true,
      includeVerification: true,
    });
    const pool = getPool()!;
    await pool.query(`DELETE FROM tt_external_person_verifications WHERE person_id=$1::uuid`, [personId]);
    const loaded = loadTanbotTelegramStage2Config();
    assert.ok(loaded.ok);
    await processUndeliveredTelegramWebhookReplies(pool, loaded.config, async () => ({ ok: true, result: {} }), {
      deliveryEnabled: true,
    });
    const row = await telegramInboxRow(pool, updateId);
    assert.ok(row.reply_delivered_at);
    assert.equal(row.reply_extra.nativeMediaProgress.cancelReason, "permission_denied");
  });

  it("max: actualHTTP photo inspect delivers maxImageToken via buildMaxSendMessagePayload", async () => {
    const maxUserId = 88007001;
    const maxChatId = maxUserId + 100000;
    const phone = "+79995558804";
    const pool = getPool()!;
    await pool.query(`INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Max Media', $1)`, [phone]);
    const partyId = (await pool.query<{ id: string }>(`SELECT id::text FROM tt_parties WHERE phone_e164=$1`, [phone])).rows[0]!.id;
    const personId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (party_id, display_name, phone_e164)
         VALUES ($1::uuid,'Max Media',$2) RETURNING id::text`,
        [partyId, phone],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid,'max',$2,$3)`,
      [personId, String(maxUserId), String(maxChatId)],
    );
    const receiver = await createTestUser({
      databaseUrl,
      email: "max-photo-receiver@test.local",
      password: "StrongPass123!",
      fullName: "Max Photo Receiver",
      role: "manager",
    });
    await pool.query("UPDATE users SET accepts_external_tt_intake=TRUE WHERE id=$1::uuid", [receiver.id]);
    await ensurePartyForUserOnWrite(pool, receiver.id, "Max Photo Receiver", "+79995558899");

    const agent = new MockAgent();
    setGlobalDispatcher(agent);
    agent.get("https://iu.oneme.ru").intercept({ path: "/photo/native-preview.jpg", method: "GET" }).reply(200, JPEG, {
      headers: { "content-type": "image/jpeg" },
    });

    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const poolAfter = getPool()!;
    const maxWh = (timestamp: number, body: Record<string, unknown>) =>
      request(app)
        .post("/api/tanbot-max/webhook")
        .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!)
        .send({ timestamp, ...body });

    let ts = maxUserId * 10;
    const msg = (timestamp: number, text: string, mid: string, attachments?: unknown[]) => ({
      update_type: "message_created",
      timestamp,
      message: {
        sender: { user_id: maxUserId, is_bot: false },
        recipient: { chat_id: maxChatId, chat_type: "dialog" },
        body: attachments?.length ? { mid, attachments } : { mid, text },
      },
    });

    assert.equal((await maxWh(++ts, msg(ts, "Создать передачу", "m1"))).status, 200);
    assert.equal((await maxWh(++ts, msg(ts, "Max photo item", "m2"))).status, 200);
    assert.equal(
      (
        await maxWh(
          ++ts,
          msg(ts, "", "m3", [
            { type: "image", payload: { url: "https://iu.oneme.ru/photo/native-preview.jpg", token: SYNTH_MAX_TOKEN } },
          ]),
        )
      ).status,
      200,
    );

    const draft = await poolAfter.query<{ id: string; payload: { revision: number } }>(
      `SELECT id::text, payload FROM tt_external_request_drafts WHERE messenger_chat_id = $1`,
      [`native:ext:max:${maxChatId}`],
    );
    assert.equal(draft.rowCount, 1);
    const draftId = draft.rows[0]!.id;
    let rev = Number(draft.rows[0]!.payload.revision);
    const cb = (payload: string) => ({
      update_type: "message_callback",
      timestamp: ++ts,
      callback: { callback_id: `cb-${payload}`, payload, user: { user_id: maxUserId, is_bot: false } },
      message: { recipient: { chat_id: maxChatId, chat_type: "dialog" } },
    });
    await maxWh(++ts, cb(buildNativeCreateCallback("photo_next", draftId, rev)!));
    rev = Number((await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    await maxWh(++ts, cb(buildNativeCreateCallback("comment_skip", draftId, rev)!));
    rev = Number((await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    await maxWh(++ts, cb(buildNativeCreateCallback("recipient", draftId, rev, "0")!));
    rev = Number((await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    await maxWh(++ts, cb(buildNativeCreateCallback("due", draftId, rev, "n")!));
    rev = Number((await poolAfter.query(`SELECT payload FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId])).rows[0]!.payload.revision);
    await maxWh(++ts, cb(buildNativeCreateCallback("photo_view", draftId, rev, "0")!));

    const fileRow = await poolAfter.query<{ max_file_token: string | null }>(
      `SELECT max_file_token FROM tt_external_request_draft_files WHERE draft_id=$1::uuid`,
      [draftId],
    );
    assert.equal(fileRow.rows[0]?.max_file_token, SYNTH_MAX_TOKEN);

    const lastOutbox = await poolAfter.query<{ dedup_key: string; reply_extra: unknown; reply_delivered_at: Date | null }>(
      `SELECT dedup_key, reply_extra, reply_delivered_at FROM tanbot_max_update_dedup ORDER BY received_at DESC LIMIT 1`,
    );
    assert.equal(lastOutbox.rowCount, 1);
    const lastExtra =
      typeof lastOutbox.rows[0]!.reply_extra === "string"
        ? JSON.parse(lastOutbox.rows[0]!.reply_extra)
        : lastOutbox.rows[0]!.reply_extra;
    assert.ok(
      (lastExtra?.nativeMediaQueue?.length ?? 0) > 0,
      `photo_view must persist nativeMediaQueue, got ${JSON.stringify(lastExtra)}`,
    );
    assert.equal(lastOutbox.rows[0]!.reply_delivered_at, null, "photo_view outbox must stay undelivered until pipeline completes");
    const targetKey = lastOutbox.rows[0]!.dedup_key;
    await poolAfter.query(
      `UPDATE tanbot_max_update_dedup SET reply_delivered_at = COALESCE(reply_delivered_at, NOW())
       WHERE dedup_key != $1 AND status='committed' AND reply_delivered_at IS NULL`,
      [targetKey],
    );

    const loaded = loadTanbotMaxStage2Config();
    assert.ok(loaded.ok);
    let capturedToken: string | undefined;
    await processUndeliveredMaxWebhookReplies(poolAfter, loaded.config, async (input) => {
      if (input.maxImageToken) {
        capturedToken = input.maxImageToken;
        const body = buildMaxSendMessagePayload({
          text: input.text,
          inlineButtons: input.inlineButtons,
          maxImageToken: input.maxImageToken,
        });
        const attachments = body.attachments as Array<{ type: string; payload: { token: string } }>;
        assert.equal(attachments[0]?.type, "image");
        assert.equal(attachments[0]?.payload.token, SYNTH_MAX_TOKEN);
      }
      return { ok: true, result: {} };
    }, { deliveryEnabled: true });
    assert.equal(capturedToken, SYNTH_MAX_TOKEN);
    await agent.close();
  });

  it("max: mismatched chat binding terminally cancels media without image transport", async () => {
    await resetPoolForTests();
    const maxUserId = 88007002;
    const maxChatId = maxUserId + 100000;
    const phone = "+79995558805";
    const pool = getPool()!;
    await pool.query(`INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Max Bind', $1)`, [phone]);
    const partyId = (await pool.query<{ id: string }>(`SELECT id::text FROM tt_parties WHERE phone_e164=$1`, [phone])).rows[0]!.id;
    const personId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (party_id, display_name, phone_e164)
         VALUES ($1::uuid,'Max Bind',$2) RETURNING id::text`,
        [partyId, phone],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_person_verifications (person_id, channel, messenger_user_id, messenger_chat_id)
       VALUES ($1::uuid,'max',$2,$3)`,
      [personId, String(maxUserId), String(maxChatId + 1)],
    );
    const draftId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_request_drafts (channel, messenger_chat_id, person_id, step, payload)
         VALUES ('max', $1, $2::uuid, 'summary', $3::jsonb) RETURNING id::text`,
        [
          `native:ext:max:${maxChatId}`,
          personId,
          JSON.stringify({ draftOrigin: "native_bot", revision: 1, actor: "external" }),
        ],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO tt_external_request_draft_files
       (draft_id, storage_key, file_name, mime_type, byte_size, sort_order, max_file_token)
       VALUES ($1::uuid, 'external-draft/synthetic', 'x.jpg', 'image/jpeg', 10, 0, $2)`,
      [draftId, SYNTH_MAX_TOKEN],
    );
    const dedupKey = "f".repeat(64);
    await pool.query(
      `INSERT INTO tanbot_max_update_dedup
       (dedup_key, reply_user_id, reply_chat_id, reply_text, reply_extra, status)
       VALUES ($1, $2, $3, 'preview', $4::jsonb, 'committed')`,
      [
        dedupKey,
        maxUserId,
        maxChatId,
        JSON.stringify({
          nativeMediaQueue: [{ channel: "max", draftId, sortOrder: 0, maxFileToken: SYNTH_MAX_TOKEN }],
          nativeMediaScope: {
            messengerChatId: String(maxChatId),
            messengerUserId: String(maxUserId),
            actor: "external",
            channel: "max",
          },
          delivery: { primary: false, copyOnly: false },
        }),
      ],
    );
    const loaded = loadTanbotMaxStage2Config();
    assert.ok(loaded.ok);
    let imageCalls = 0;
    await processUndeliveredMaxWebhookReplies(pool, loaded.config, async (input) => {
      if (input.maxImageToken) imageCalls += 1;
      return { ok: true, result: {} };
    }, { deliveryEnabled: true });
    assert.equal(imageCalls, 0);
    const row = await pool.query(`SELECT reply_delivered_at, reply_extra FROM tanbot_max_update_dedup WHERE dedup_key=$1`, [
      dedupKey,
    ]);
    assert.ok(row.rows[0].reply_delivered_at);
    assert.equal(row.rows[0].reply_extra.nativeMediaProgress.disposition, "canceled");
  });
});
