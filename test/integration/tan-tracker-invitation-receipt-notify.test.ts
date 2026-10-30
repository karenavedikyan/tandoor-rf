import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { Pool } from "pg";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
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
import { upsertVerifiedPerson } from "../../src/tan-tracker/external-person/person-service";
import { createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";
import { processExternalPersonMessageOutbox } from "../../src/tan-tracker/external-person/outbox-worker";
import { handleStaffOrExternalMessengerStop } from "../../src/tanbot/messenger-stop-handler";
import { withTransaction } from "../../src/access/db";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const MAX_BOT_TOKEN = "SYNTH_MAX_INVITE_TOKEN_0123456789ab";

function extractSixDigitCode(text: string): string {
  const m = text.match(/\b(\d{6})\b/);
  assert.ok(m, `expected 6-digit code in: ${text}`);
  return m[1]!;
}

function signMaxVcf(vcfRaw: string): string {
  return crypto.createHmac("sha256", MAX_BOT_TOKEN).update(decodeVcfInfoForHmac(vcfRaw), "utf8").digest("hex");
}

function maxContactUpdate(input: {
  ts: number;
  userId: number;
  chatId: number;
  mid: string;
  vcfRaw: string;
  forwarded?: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    mid: input.mid,
    attachments: [
      {
        type: "contact",
        payload: {
          vcf_info: input.vcfRaw,
          max_info: { user_id: input.userId, first_name: "Syn" },
          hash: signMaxVcf(input.vcfRaw),
        },
      },
    ],
  };
  if (input.forwarded) body.link = { type: "forward" };
  return {
    update_type: "message_created",
    timestamp: input.ts,
    message: {
      sender: { user_id: input.userId, is_bot: false, first_name: "Syn" },
      recipient: { chat_id: input.chatId },
      body,
    },
  };
}

describe("invitation own-contact receipt → external person notify (PG)", { concurrency: false }, () => {
  let pool: Pool;
  let app: ReturnType<(typeof import("../../src/server"))["createApp"]>;
  let holderCookie = "";
  const databaseUrl = getIntegrationDatabaseUrl();

  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
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
      email: "inv-notify-holder@test.local",
      password: PASSWORD,
      fullName: "Invite Holder",
      role: "admin",
    });
    const { createApp } = await import("../../src/server");
    app = createApp();
    pool = new Pool({ connectionString: databaseUrl });
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: ORIGIN })
      .send({ email: "inv-notify-holder@test.local", password: PASSWORD });
    holderCookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
  });

  after(async () => {
    await pool.end();
    await closePool();
    delete process.env.TT_EXTERNAL_MESSENGER_ENABLED;
    delete process.env.TANBOT_MAX_ENABLED;
  });

  async function createExternalTransfer(phone: string, item: string): Promise<{ publicCode: string; pendingPartyId: string }> {
    const create = await request(app)
      .post("/api/tan-tracker/transfers")
      .set({ Origin: ORIGIN, Cookie: holderCookie, "Content-Type": "application/json" })
      .send({ item, finalRecipientExternal: { name: "Syn Recipient", phone } });
    assert.equal(create.status, 201, create.text);
    const publicCode = create.body.publicCode as string;
    const pendingPartyId = create.body.bootstrap.orders[0].pendingId as string;
    return { publicCode, pendingPartyId };
  }

  async function mintInvite(publicCode: string): Promise<string> {
    const invite = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(publicCode)}/messenger-invite`)
      .set({ Origin: ORIGIN, Cookie: holderCookie, "Content-Type": "application/json" })
      .send({});
    assert.equal(invite.status, 201, invite.text);
    return invite.body.startToken as string;
  }

  async function staffVerifyCode(publicCode: string, code: string): Promise<void> {
    const res = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(publicCode)}/code/verify`)
      .set({ Origin: ORIGIN, Cookie: holderCookie, "Content-Type": "application/json" })
      .send({ code });
    assert.equal(res.status, 200, res.text);
  }

  it("MAX invitation → staff verify: bridges person, delivered notice on MAX only, worker sends once", async () => {
    const phone = "+79993001001";
    const maxUserId = 93001001;
    const vcfRaw = "BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:Syn\\r\\nTEL;TYPE=CELL:+79993001001\\r\\nEND:VCARD";
    const personsBefore = (await pool.query(`SELECT COUNT(*)::int AS c FROM tt_external_persons`)).rows[0]!.c;

    const { publicCode, pendingPartyId } = await createExternalTransfer(phone, "MAX bridge box");
    const startToken = await mintInvite(publicCode);
    const maxCfg = loadTanbotMaxStage2Config();
    assert.equal(maxCfg.ok, true);
    if (!maxCfg.ok) return;

    await handleTanbotMaxUpdate(pool, maxCfg.config, {
      update_type: "bot_started",
      timestamp: Date.now(),
      chat_id: maxUserId,
      user: { user_id: maxUserId, is_bot: false, first_name: "Syn" },
      payload: startToken,
    });
    const contactOut = await handleTanbotMaxUpdate(
      pool,
      maxCfg.config,
      maxContactUpdate({ ts: Date.now() + 1, userId: maxUserId, chatId: maxUserId, mid: "inv-max-1", vcfRaw }),
    );
    const code = extractSixDigitCode(contactOut.reply?.text ?? "");

    const personsMid = (await pool.query(`SELECT COUNT(*)::int AS c FROM tt_external_persons`)).rows[0]!.c;
    assert.equal(personsMid, personsBefore, "contact proof must not create external person before handoff");

    await staffVerifyCode(publicCode, code);

    const transfer = await pool.query<{ status: string; holder_party_id: string; pending_party_id: string | null }>(
      `SELECT status, holder_party_id::text, pending_party_id::text FROM tt_transfers WHERE public_code = $1`,
      [publicCode],
    );
    assert.equal(transfer.rows[0]!.status, "delivered");
    assert.equal(transfer.rows[0]!.holder_party_id, pendingPartyId);
    assert.equal(transfer.rows[0]!.pending_party_id, null);

    const personsAfter = (await pool.query(`SELECT COUNT(*)::int AS c FROM tt_external_persons`)).rows[0]!.c;
    assert.equal(personsAfter, personsBefore + 1);

    const ver = await pool.query(
      `SELECT channel FROM tt_external_person_verifications v
       JOIN tt_external_persons p ON p.id = v.person_id
       WHERE p.party_id = $1::uuid`,
      [pendingPartyId],
    );
    assert.deepEqual(
      ver.rows.map((r) => r.channel).sort(),
      ["max"],
    );

    const outbox = await pool.query<{ channel: string; event_type: string; status: string; body: string }>(
      `SELECT channel, event_type, status, body FROM tt_external_person_message_outbox o
       JOIN tt_external_persons p ON p.id = o.person_id
       WHERE p.party_id = $1::uuid ORDER BY channel`,
      [pendingPartyId],
    );
    assert.equal(outbox.rowCount, 1);
    assert.equal(outbox.rows[0]!.channel, "max");
    assert.equal(outbox.rows[0]!.event_type, "external_person.delivered");
    assert.match(outbox.rows[0]!.body, /Открыть:/);

    let sendCount = 0;
    const worker = await processExternalPersonMessageOutbox(pool, {
      channel: "max",
      botToken: MAX_BOT_TOKEN,
      requestTimeoutMs: 5000,
      maxResponseBytes: 65536,
      transport: async () => {
        sendCount += 1;
        return { ok: true };
      },
    });
    assert.equal(worker.sent, 1);
    assert.equal(sendCount, 1);

    const personId = (
      await pool.query<{ id: string }>(`SELECT id::text FROM tt_external_persons WHERE party_id = $1::uuid`, [
        pendingPartyId,
      ])
    ).rows[0]!.id;
    const est = await withTransaction((client) => createPersonBrowserSession(client, personId, "max"));
    const boot = await request(app).get(
      `/api/tan-tracker/public/external/bootstrap?est=${encodeURIComponent(est)}`,
    );
    assert.equal(boot.status, 200, boot.text);
    assert.equal(boot.body.externalPerson, true);
    assert.ok(boot.body.orders.some((o: { id: string }) => o.id === publicCode));
    assert.ok(boot.body.capability);
  });

  it("Telegram invitation → staff verify: delivered notice on telegram channel", async () => {
    const phone = "+79993001002";
    const tgUserId = 93001002;
    const tgChatId = tgUserId;
    const { publicCode, pendingPartyId } = await createExternalTransfer(phone, "TG bridge box");
    const startToken = await mintInvite(publicCode);
    const tgCfg = loadTanbotTelegramStage2Config();
    assert.equal(tgCfg.ok, true);
    if (!tgCfg.ok) return;

    await handleTanbotTelegramUpdate(pool, tgCfg.config, {
      update_id: 9300100201,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: tgChatId, type: "private" },
        from: { id: tgUserId, is_bot: false, first_name: "Syn" },
        text: `/start ${startToken}`,
      },
    });
    const contactOut = await handleTanbotTelegramUpdate(pool, tgCfg.config, {
      update_id: 9300100202,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: tgChatId, type: "private" },
        from: { id: tgUserId, is_bot: false, first_name: "Syn" },
        contact: { phone_number: phone, user_id: tgUserId, first_name: "Syn" },
      },
    });
    const code = extractSixDigitCode(contactOut.reply?.text ?? "");
    await staffVerifyCode(publicCode, code);

    const outbox = await pool.query(
      `SELECT channel, event_type FROM tt_external_person_message_outbox o
       JOIN tt_external_persons p ON p.id = o.person_id
       WHERE p.party_id = $1::uuid`,
      [pendingPartyId],
    );
    assert.equal(outbox.rowCount, 1);
    assert.equal(outbox.rows[0]!.channel, "telegram");
    assert.equal(outbox.rows[0]!.event_type, "external_person.delivered");
  });

  it("intermediate receipt (not final): after_receipt notice on verified MAX channel", async () => {
    const pendingPhone = "+79993001007";
    const finalPhone = "+79993001008";
    const maxUserId = 93001007;
    const vcfRaw = "BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:Syn\\r\\nTEL;TYPE=CELL:+79993001007\\r\\nEND:VCARD";
    const { publicCode, pendingPartyId } = await createExternalTransfer(pendingPhone, "Intermediate hop");
    await pool.query(`INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Final hop', $1)`, [
      finalPhone,
    ]);
    await pool.query(
      `UPDATE tt_transfers SET final_recipient_party_id = (
         SELECT id FROM tt_parties WHERE phone_e164 = $2 LIMIT 1
       )
       WHERE public_code = $1`,
      [publicCode, finalPhone],
    );

    const startToken = await mintInvite(publicCode);
    const maxCfg = loadTanbotMaxStage2Config();
    assert.equal(maxCfg.ok, true);
    if (!maxCfg.ok) return;
    await handleTanbotMaxUpdate(pool, maxCfg.config, {
      update_type: "bot_started",
      timestamp: Date.now(),
      chat_id: maxUserId,
      user: { user_id: maxUserId, is_bot: false, first_name: "Syn" },
      payload: startToken,
    });
    const contactOut = await handleTanbotMaxUpdate(
      pool,
      maxCfg.config,
      maxContactUpdate({ ts: Date.now() + 6, userId: maxUserId, chatId: maxUserId, mid: "inv-mid", vcfRaw }),
    );
    await staffVerifyCode(publicCode, extractSixDigitCode(contactOut.reply?.text ?? ""));

    const transfer = await pool.query<{ status: string; holder_party_id: string }>(
      `SELECT status, holder_party_id::text FROM tt_transfers WHERE public_code = $1`,
      [publicCode],
    );
    assert.equal(transfer.rows[0]!.status, "active");
    assert.equal(transfer.rows[0]!.holder_party_id, pendingPartyId);

    const outbox = await pool.query(
      `SELECT event_type, channel FROM tt_external_person_message_outbox o
       JOIN tt_external_persons p ON p.id = o.person_id
       WHERE p.party_id = $1::uuid`,
      [pendingPartyId],
    );
    assert.equal(outbox.rowCount, 1);
    assert.equal(outbox.rows[0]!.event_type, "external_person.after_receipt");
    assert.equal(outbox.rows[0]!.channel, "max");
  });

  it("prefers MAX channel for notice when person also has telegram verification", async () => {
    const phone = "+79993001003";
    const maxUserId = 93001003;
    const tgUserId = 930010030;
    const vcfRaw = "BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:Syn\\r\\nTEL;TYPE=CELL:+79993001003\\r\\nEND:VCARD";

    await withTransaction(async (client) => {
      await upsertVerifiedPerson(client, {
        channel: "telegram",
        messengerUserId: BigInt(tgUserId),
        messengerChatId: BigInt(tgUserId),
        phoneRaw: phone,
        displayName: "Dual Syn",
      });
      await upsertVerifiedPerson(client, {
        channel: "max",
        messengerUserId: BigInt(maxUserId),
        messengerChatId: BigInt(maxUserId),
        phoneRaw: phone,
        displayName: "Dual Syn",
      });
    });

    const { publicCode, pendingPartyId } = await createExternalTransfer(phone, "Dual channel");
    const startToken = await mintInvite(publicCode);
    const maxCfg = loadTanbotMaxStage2Config();
    assert.equal(maxCfg.ok, true);
    if (!maxCfg.ok) return;
    await handleTanbotMaxUpdate(pool, maxCfg.config, {
      update_type: "bot_started",
      timestamp: Date.now(),
      chat_id: maxUserId,
      user: { user_id: maxUserId, is_bot: false, first_name: "Syn" },
      payload: startToken,
    });
    const contactOut = await handleTanbotMaxUpdate(
      pool,
      maxCfg.config,
      maxContactUpdate({ ts: Date.now() + 2, userId: maxUserId, chatId: maxUserId, mid: "inv-dual-max", vcfRaw }),
    );
    await staffVerifyCode(publicCode, extractSixDigitCode(contactOut.reply?.text ?? ""));

    const outbox = await pool.query(
      `SELECT channel FROM tt_external_person_message_outbox o
       JOIN tt_external_persons p ON p.id = o.person_id
       WHERE p.party_id = $1::uuid AND event_type = 'external_person.delivered'`,
      [pendingPartyId],
    );
    assert.equal(outbox.rowCount, 1);
    assert.equal(outbox.rows[0]!.channel, "max");
  });

  it("negative: bot start alone and forwarded contact do not create person or outbox", async () => {
    const phone = "+79993001004";
    const maxUserId = 93001004;
    const vcfRaw = "BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:Syn\\r\\nTEL;TYPE=CELL:+79993001004\\r\\nEND:VCARD";
    const { publicCode, pendingPartyId } = await createExternalTransfer(phone, "No spawn");
    const startToken = await mintInvite(publicCode);
    const maxCfg = loadTanbotMaxStage2Config();
    assert.equal(maxCfg.ok, true);
    if (!maxCfg.ok) return;

    await handleTanbotMaxUpdate(pool, maxCfg.config, {
      update_type: "bot_started",
      timestamp: Date.now(),
      chat_id: maxUserId,
      user: { user_id: maxUserId, is_bot: false, first_name: "Syn" },
      payload: startToken,
    });
    const noPerson = await pool.query(`SELECT 1 FROM tt_external_persons WHERE party_id = $1::uuid`, [pendingPartyId]);
    assert.equal(noPerson.rowCount, 0);

    await handleTanbotMaxUpdate(
      pool,
      maxCfg.config,
      maxContactUpdate({
        ts: Date.now() + 3,
        userId: maxUserId,
        chatId: maxUserId,
        mid: "inv-fwd",
        vcfRaw,
        forwarded: true,
      }),
    );
    const stillNo = await pool.query(`SELECT 1 FROM tt_external_persons WHERE party_id = $1::uuid`, [pendingPartyId]);
    assert.equal(stillNo.rowCount, 0);

    const outbox = await pool.query(
      `SELECT 1 FROM tt_external_person_message_outbox o
       JOIN tt_external_persons p ON p.id = o.person_id WHERE p.party_id = $1::uuid`,
      [pendingPartyId],
    );
    assert.equal(outbox.rowCount, 0);
    void publicCode;
  });

  it("duplicate staff verify does not duplicate delivered outbox", async () => {
    const phone = "+79993001005";
    const maxUserId = 93001005;
    const vcfRaw = "BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:Syn\\r\\nTEL;TYPE=CELL:+79993001005\\r\\nEND:VCARD";
    const { publicCode, pendingPartyId } = await createExternalTransfer(phone, "Dedupe");
    const startToken = await mintInvite(publicCode);
    const maxCfg = loadTanbotMaxStage2Config();
    assert.equal(maxCfg.ok, true);
    if (!maxCfg.ok) return;
    await handleTanbotMaxUpdate(pool, maxCfg.config, {
      update_type: "bot_started",
      timestamp: Date.now(),
      chat_id: maxUserId,
      user: { user_id: maxUserId, is_bot: false, first_name: "Syn" },
      payload: startToken,
    });
    const contactOut = await handleTanbotMaxUpdate(
      pool,
      maxCfg.config,
      maxContactUpdate({ ts: Date.now() + 4, userId: maxUserId, chatId: maxUserId, mid: "inv-dedupe", vcfRaw }),
    );
    const code = extractSixDigitCode(contactOut.reply?.text ?? "");
    await staffVerifyCode(publicCode, code);
    const replay = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(publicCode)}/code/verify`)
      .set({ Origin: ORIGIN, Cookie: holderCookie, "Content-Type": "application/json" })
      .send({ code });
    assert.notEqual(replay.status, 200);

    const outbox = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_external_person_message_outbox o
       JOIN tt_external_persons p ON p.id = o.person_id
       WHERE p.party_id = $1::uuid AND event_type = 'external_person.delivered'`,
      [pendingPartyId],
    );
    assert.equal(outbox.rows[0]!.c, 1);
  });

  it("webhook: after delivered invitation, own contact falls through to generic shell recovery (MAX)", async () => {
    const phone = "+79993001009";
    const maxUserId = 93001009;
    const vcfRaw = "BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:Syn\\r\\nTEL;TYPE=CELL:+79993001009\\r\\nEND:VCARD";
    const { publicCode } = await createExternalTransfer(phone, "Recovery MAX");
    const startToken = await mintInvite(publicCode);
    const maxCfg = loadTanbotMaxStage2Config();
    assert.equal(maxCfg.ok, true);
    if (!maxCfg.ok) return;
    await handleTanbotMaxUpdate(pool, maxCfg.config, {
      update_type: "bot_started",
      timestamp: Date.now(),
      chat_id: maxUserId,
      user: { user_id: maxUserId, is_bot: false, first_name: "Syn" },
      payload: startToken,
    });
    const firstContact = await handleTanbotMaxUpdate(
      pool,
      maxCfg.config,
      maxContactUpdate({ ts: Date.now() + 7, userId: maxUserId, chatId: maxUserId, mid: "inv-rec-1", vcfRaw }),
    );
    await staffVerifyCode(publicCode, extractSixDigitCode(firstContact.reply?.text ?? ""));

    const recovery = await handleTanbotMaxUpdate(
      pool,
      maxCfg.config,
      maxContactUpdate({ ts: Date.now() + 8, userId: maxUserId, chatId: maxUserId, mid: "inv-rec-2", vcfRaw }),
    );
    assert.match(recovery.reply?.text ?? "", /tan-tracker\/\?est=/);
    assert.ok(!/Приглашение недоступно/i.test(recovery.reply?.text ?? ""));
  });

  it("webhook: active invitation still rejects wrong phone (MAX)", async () => {
    const phone = "+79993001010";
    const maxUserId = 93001010;
    const wrongVcf =
      "BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:Syn\\r\\nTEL;TYPE=CELL:+79993001011\\r\\nEND:VCARD";
    const { publicCode } = await createExternalTransfer(phone, "Wrong phone");
    const startToken = await mintInvite(publicCode);
    const maxCfg = loadTanbotMaxStage2Config();
    assert.equal(maxCfg.ok, true);
    if (!maxCfg.ok) return;
    await handleTanbotMaxUpdate(pool, maxCfg.config, {
      update_type: "bot_started",
      timestamp: Date.now(),
      chat_id: maxUserId,
      user: { user_id: maxUserId, is_bot: false, first_name: "Syn" },
      payload: startToken,
    });
    const out = await handleTanbotMaxUpdate(
      pool,
      maxCfg.config,
      maxContactUpdate({ ts: Date.now() + 9, userId: maxUserId, chatId: maxUserId, mid: "inv-wrong", vcfRaw: wrongVcf }),
    );
    assert.match(out.reply?.text ?? "", /не совпадает/i);
    void publicCode;
  });

  it("webhook: after delivered invitation, «Мои передачи» then contact uses generic path (Telegram)", async () => {
    const phone = "+79993001012";
    const tgUserId = 93001012;
    const tgChatId = tgUserId;
    const { publicCode } = await createExternalTransfer(phone, "Recovery TG");
    const startToken = await mintInvite(publicCode);
    const tgCfg = loadTanbotTelegramStage2Config();
    assert.equal(tgCfg.ok, true);
    if (!tgCfg.ok) return;

    await handleTanbotTelegramUpdate(pool, tgCfg.config, {
      update_id: 9300101201,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: tgChatId, type: "private" },
        from: { id: tgUserId, is_bot: false, first_name: "Syn" },
        text: `/start ${startToken}`,
      },
    });
    const first = await handleTanbotTelegramUpdate(pool, tgCfg.config, {
      update_id: 9300101202,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: tgChatId, type: "private" },
        from: { id: tgUserId, is_bot: false, first_name: "Syn" },
        contact: { phone_number: phone, user_id: tgUserId, first_name: "Syn" },
      },
    });
    await staffVerifyCode(publicCode, extractSixDigitCode(first.reply?.text ?? ""));

    const myTransfers = await handleTanbotTelegramUpdate(pool, tgCfg.config, {
      update_id: 9300101203,
      message: {
        message_id: 3,
        date: Math.floor(Date.now() / 1000),
        chat: { id: tgChatId, type: "private" },
        from: { id: tgUserId, is_bot: false, first_name: "Syn" },
        text: "Мои передачи",
      },
    });
    assert.match(myTransfers.reply?.text ?? "", /tan-tracker\/\?est=/);
  });

  it("opt-out on MAX channel cancels receipt outbox delivery", async () => {
    const phone = "+79993001006";
    const maxUserId = 93001006;
    const vcfRaw = "BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:Syn\\r\\nTEL;TYPE=CELL:+79993001006\\r\\nEND:VCARD";
    const { publicCode, pendingPartyId } = await createExternalTransfer(phone, "Opt out");
    const startToken = await mintInvite(publicCode);
    const maxCfg = loadTanbotMaxStage2Config();
    assert.equal(maxCfg.ok, true);
    if (!maxCfg.ok) return;
    await handleTanbotMaxUpdate(pool, maxCfg.config, {
      update_type: "bot_started",
      timestamp: Date.now(),
      chat_id: maxUserId,
      user: { user_id: maxUserId, is_bot: false, first_name: "Syn" },
      payload: startToken,
    });
    const contactOut = await handleTanbotMaxUpdate(
      pool,
      maxCfg.config,
      maxContactUpdate({ ts: Date.now() + 5, userId: maxUserId, chatId: maxUserId, mid: "inv-opt", vcfRaw }),
    );
    await staffVerifyCode(publicCode, extractSixDigitCode(contactOut.reply?.text ?? ""));

    await withTransaction((client) =>
      handleStaffOrExternalMessengerStop(client, { channel: "max", messengerUserId: BigInt(maxUserId) }),
    );

    const worker = await processExternalPersonMessageOutbox(pool, {
      channel: "max",
      botToken: MAX_BOT_TOKEN,
      requestTimeoutMs: 5000,
      maxResponseBytes: 65536,
      transport: async () => ({ ok: true }),
    });
    assert.equal(worker.cancelled, 1);
    assert.equal(worker.sent, 0);
    void publicCode;
    void pendingPartyId;
  });
});
