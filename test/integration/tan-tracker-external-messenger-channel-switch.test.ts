import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { handleTanbotTelegramUpdate } from "../../src/tanbot-telegram/webhook-handler";
import { handleTanbotMaxUpdate } from "../../src/tanbot-max/webhook-handler";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { decodeVcfInfoForHmac } from "../../src/tanbot/external-recipient/max-contact-verify";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const MAX_BOT_TOKEN = "SYNTH_MAX_TEST_TOKEN_0123456789abcdef";

function extractSixDigitCode(text: string): string {
  const m = text.match(/\b(\d{6})\b/);
  assert.ok(m, `expected 6-digit code in: ${text}`);
  return m[1]!;
}

function buildSignedMaxContactUpdate(input: {
  timestamp: number;
  userId: number;
  chatId: number;
  mid: string;
  vcfRaw: string;
}): Record<string, unknown> {
  const decoded = decodeVcfInfoForHmac(input.vcfRaw);
  const hash = crypto.createHmac("sha256", MAX_BOT_TOKEN).update(decoded, "utf8").digest("hex");
  return {
    update_type: "message_created",
    timestamp: input.timestamp,
    message: {
      sender: { user_id: input.userId, is_bot: false, first_name: "Ext" },
      recipient: { chat_id: input.chatId },
      body: {
        mid: input.mid,
        attachments: [
          {
            type: "contact",
            payload: {
              vcf_info: input.vcfRaw,
              max_info: { user_id: input.userId, first_name: "Ext" },
              hash,
            },
          },
        ],
      },
    },
  };
}

describe("external messenger channel switch (PG)", { concurrency: false }, () => {
  let app: ReturnType<(typeof import("../../src/server"))["createApp"]>;
  let pool: Pool;
  let holderCookie = "";
  let startToken = "";
  let transferCode = "";
  const databaseUrl = getIntegrationDatabaseUrl();

  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_ENABLED = "true";
    process.env.TANBOT_TELEGRAM_BOT_TOKEN = "123456789:AAH-test-token-for-integration-only";
    process.env.TANBOT_TELEGRAM_BOT_USERNAME = "tandoor_test_bot";
    process.env.TANBOT_TELEGRAM_LINK_TOKEN_PEPPER = "test-link-pepper-min-16-chars";
    process.env.TANBOT_MAX_ENABLED = "true";
    process.env.TANBOT_MAX_BOT_TOKEN = MAX_BOT_TOKEN;
    process.env.TANBOT_MAX_BOT_USERNAME = "id231100522180_bot";
    process.env.TANBOT_MAX_LINK_TOKEN_PEPPER = "test-max-link-pepper-min-16-chars";
    process.env.TANBOT_MAX_WEBHOOK_SECRET = "test-max-webhook-secret-min16";
    process.env.APP_ORIGIN = ORIGIN;
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    await createTestUser({
      databaseUrl,
      email: "ext-switch-holder@test.local",
      password: PASSWORD,
      fullName: "Switch Holder",
      role: "admin",
    });
    const { createApp } = await import("../../src/server");
    app = createApp();
    pool = new Pool({ connectionString: databaseUrl });
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN })
      .send({ email: "ext-switch-holder@test.local", password: PASSWORD });
    holderCookie = login.headers["set-cookie"]![0]!.split(";")[0]!;

    const create = await request(app)
      .post("/api/tan-tracker/transfers")
      .set({ Origin: ORIGIN, Cookie: holderCookie, "Content-Type": "application/json" })
      .send({
        item: "Channel switch box",
        finalRecipientExternal: { name: "Внешний", phone: "+79991112233" },
      });
    assert.equal(create.status, 201, create.text);
    transferCode = create.body.publicCode as string;

    const invite = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferCode)}/messenger-invite`)
      .set({ Origin: ORIGIN, Cookie: holderCookie, "Content-Type": "application/json" })
      .send({});
    assert.equal(invite.status, 201, invite.text);
    startToken = invite.body.startToken as string;
  });

  after(async () => {
    await pool.end();
    await closePool();
    delete process.env.TT_EXTERNAL_MESSENGER_ENABLED;
    delete process.env.TANBOT_MAX_ENABLED;
  });

  it("telegram code invalidated after MAX switch; fresh MAX code confirms once", async () => {
    const tgCfg = loadTanbotTelegramStage2Config();
    const maxCfg = loadTanbotMaxStage2Config();
    assert.equal(tgCfg.ok, true);
    assert.equal(maxCfg.ok, true);
    if (!tgCfg.ok || !maxCfg.ok) return;

    const tgUserId = 810001;
    const tgChatId = tgUserId;
    const maxUserId = 910001;
    const maxChatId = maxUserId;
    const vcfRaw =
      "BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:Ext\\r\\nTEL;TYPE=CELL:+79991112233\\r\\nEND:VCARD";

    await handleTanbotTelegramUpdate(pool, tgCfg.config, {
      update_id: 920001,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: tgChatId, type: "private" },
        from: { id: tgUserId, is_bot: false, first_name: "Ext" },
        text: `/start ${startToken}`,
      },
    });

    const tgContact = await handleTanbotTelegramUpdate(pool, tgCfg.config, {
      update_id: 920002,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: tgChatId, type: "private" },
        from: { id: tgUserId, is_bot: false, first_name: "Ext" },
        contact: { phone_number: "+79991112233", user_id: tgUserId, first_name: "Ext" },
      },
    });
    const telegramCode = extractSixDigitCode(tgContact.reply?.text ?? "");

    await handleTanbotMaxUpdate(pool, maxCfg.config, {
      update_type: "bot_started",
      timestamp: Date.now(),
      chat_id: maxChatId,
      user: { user_id: maxUserId, is_bot: false, first_name: "Ext" },
      payload: startToken,
    });

    const staleAfterSwitch = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferCode)}/code/verify`)
      .set({ Origin: ORIGIN, Cookie: holderCookie, "Content-Type": "application/json" })
      .send({ code: telegramCode });
    assert.notEqual(staleAfterSwitch.status, 200, "telegram-era code must not verify after channel switch");

    const maxContactOut = await handleTanbotMaxUpdate(
      pool,
      maxCfg.config,
      buildSignedMaxContactUpdate({
        timestamp: Date.now() + 1,
        userId: maxUserId,
        chatId: maxChatId,
        mid: "max-contact-m1",
        vcfRaw,
      }),
    );
    assert.match(maxContactOut.reply?.text ?? "", /\d{6}/);
    const maxCode = extractSixDigitCode(maxContactOut.reply?.text ?? "");

    const confirm = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferCode)}/code/verify`)
      .set({ Origin: ORIGIN, Cookie: holderCookie, "Content-Type": "application/json" })
      .send({ code: maxCode });
    assert.equal(confirm.status, 200, confirm.text);

    const replay = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferCode)}/code/verify`)
      .set({ Origin: ORIGIN, Cookie: holderCookie, "Content-Type": "application/json" })
      .send({ code: maxCode });
    assert.notEqual(replay.status, 200, "code must be single-use");
  });
});
