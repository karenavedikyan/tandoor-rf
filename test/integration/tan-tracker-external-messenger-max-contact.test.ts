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
import { handleTanbotMaxUpdate } from "../../src/tanbot-max/webhook-handler";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { decodeVcfInfoForHmac } from "../../src/tanbot/external-recipient/max-contact-verify";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const MAX_BOT_TOKEN = "SYNTH_MAX_TEST_TOKEN_0123456789abcdef";
const PHONE = "+79991112233";

function signVcf(vcfRaw: string): string {
  return crypto.createHmac("sha256", MAX_BOT_TOKEN).update(decodeVcfInfoForHmac(vcfRaw), "utf8").digest("hex");
}

function maxContactUpdate(input: {
  ts: number;
  userId: number;
  chatId: number;
  mid: string;
  vcfRaw: string;
  hash?: string;
  maxUserId?: number;
  forwarded?: boolean;
}): Record<string, unknown> {
  const hash = input.hash ?? signVcf(input.vcfRaw);
  const maxUid = input.maxUserId ?? input.userId;
  const body: Record<string, unknown> = {
    mid: input.mid,
    attachments: [
      {
        type: "contact",
        payload: {
          vcf_info: input.vcfRaw,
          max_info: { user_id: maxUid, first_name: "Ext" },
          hash,
        },
      },
    ],
  };
  if (input.forwarded) body.link = { type: "forward" };
  return {
    update_type: "message_created",
    timestamp: input.ts,
    message: {
      sender: { user_id: input.userId, is_bot: false, first_name: "Ext" },
      recipient: { chat_id: input.chatId },
      body,
    },
  };
}

describe("external messenger MAX native contact (PG)", { concurrency: false }, () => {
  let pool: Pool;
  let maxCfg: ReturnType<typeof loadTanbotMaxStage2Config> extends { ok: true; config: infer C }
    ? C
    : never;
  let startToken = "";
  const maxUserId = 920001;
  const maxChatId = maxUserId;
  const vcfRaw =
    "BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:Ext\\r\\nTEL;TYPE=CELL:+79991112233\\r\\nEND:VCARD";
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
      email: "max-contact-admin@test.local",
      password: PASSWORD,
      fullName: "Max Admin",
      role: "admin",
    });
    pool = new Pool({ connectionString: databaseUrl });
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN })
      .send({ email: "max-contact-admin@test.local", password: PASSWORD });
    const cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
    const create = await request(app)
      .post("/api/tan-tracker/transfers")
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({ item: "Max contact", finalRecipientExternal: { name: "E", phone: PHONE } });
    assert.equal(create.status, 201);
    const code = create.body.publicCode as string;
    const invite = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(code)}/messenger-invite`)
      .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
      .send({});
    startToken = invite.body.startToken as string;
    const loaded = loadTanbotMaxStage2Config();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) throw new Error("max config");
    maxCfg = loaded.config;
  });

  async function bindMaxSession(): Promise<void> {
    await handleTanbotMaxUpdate(pool, maxCfg, {
      update_type: "bot_started",
      timestamp: Date.now(),
      chat_id: maxChatId,
      user: { user_id: maxUserId, is_bot: false, first_name: "Ext" },
      payload: startToken,
    });
  }

  after(async () => {
    await pool.end();
    await closePool();
    delete process.env.TT_EXTERNAL_MESSENGER_ENABLED;
    delete process.env.TANBOT_MAX_ENABLED;
  });

  async function maxReply(update: Record<string, unknown>): Promise<string> {
    const out = await handleTanbotMaxUpdate(pool, maxCfg, update);
    return out.reply?.text ?? "";
  }

  it("accepts official payload.hash shape with escaped CRLF vcf", async () => {
    await bindMaxSession();
    const text = await maxReply(
      maxContactUpdate({ ts: Date.now() + 10, userId: maxUserId, chatId: maxChatId, mid: "m-ok", vcfRaw }),
    );
    assert.match(text, /\d{6}/);
  });

  it("rejects missing hash, wrong hash, alien user id, forwarded, wrong phone", async () => {
    await bindMaxSession();
    const missingHash = await maxReply(
      maxContactUpdate({
        ts: Date.now() + 11,
        userId: maxUserId,
        chatId: maxChatId,
        mid: "m-nohash",
        vcfRaw,
        hash: "",
      }),
    );
    assert.ok(!/\d{6}/.test(missingHash), `missing hash must not issue code: ${missingHash}`);

    const wrongHash = await maxReply(
      maxContactUpdate({
        ts: Date.now() + 12,
        userId: maxUserId,
        chatId: maxChatId,
        mid: "m-badhash",
        vcfRaw,
        hash: "00".repeat(32),
      }),
    );
    assert.ok(wrongHash.includes("подлинность"), wrongHash);

    const alien = await maxReply(
      maxContactUpdate({
        ts: Date.now() + 13,
        userId: maxUserId,
        chatId: maxChatId,
        mid: "m-alien",
        vcfRaw,
        maxUserId: maxUserId + 1,
      }),
    );
    assert.ok(alien.includes("собственный"));

    const forwarded = await maxReply(
      maxContactUpdate({
        ts: Date.now() + 14,
        userId: maxUserId,
        chatId: maxChatId,
        mid: "m-fwd",
        vcfRaw,
        forwarded: true,
      }),
    );
    assert.ok(forwarded.includes("Переслан"));

    const wrongPhoneVcf =
      "BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:Ext\\r\\nTEL;TYPE=CELL:+79990000000\\r\\nEND:VCARD";
    const wrongPhone = await maxReply(
      maxContactUpdate({
        ts: Date.now() + 15,
        userId: maxUserId,
        chatId: maxChatId,
        mid: "m-wrongphone",
        vcfRaw: wrongPhoneVcf,
      }),
    );
    assert.ok(wrongPhone.includes("не совпадает"));
  });

  it("rejects payload without max_info.user_id (parser returns no contact)", async () => {
    await bindMaxSession();
    const out = await handleTanbotMaxUpdate(pool, maxCfg, {
      update_type: "message_created",
      timestamp: Date.now() + 16,
      message: {
        sender: { user_id: maxUserId, is_bot: false, first_name: "Ext" },
        recipient: { chat_id: maxChatId },
        body: {
          mid: "m-nouid",
          attachments: [
            {
              type: "contact",
              payload: { vcf_info: vcfRaw, hash: signVcf(vcfRaw) },
            },
          ],
        },
      },
    });
    assert.ok(!/\d{6}/.test(out.reply?.text ?? ""), "must not issue code without user_id");
  });
});
