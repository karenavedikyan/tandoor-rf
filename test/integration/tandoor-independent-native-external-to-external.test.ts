import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { handleTanbotTelegramUpdate } from "../../src/tanbot-telegram/webhook-handler";
import { handleTanbotMaxUpdate } from "../../src/tanbot-max/webhook-handler";
import { holderAccessTtlMs, signHolderAccess } from "../../src/tan-tracker/holder-access";
import { decodeVcfInfoForHmac } from "../../src/tanbot/external-recipient/max-contact-verify";
import { externalUnavailableMessage } from "../../src/tanbot/native-create/recipient-unified";
type Channel = "max" | "telegram";
type Button = { text: string; payload?: string; callback_data?: string };
type Reply = { text: string; buttons: Button[]; messages?: Reply[] };
type ExtActor = {
  channel: Channel; id: number; chatId: number; partyId: string; personId: string; phone: string;
};

const db = getIntegrationDatabaseUrl();
const origin = "http://127.0.0.1:3000";
let app: ReturnType<typeof import("../../src/server").createApp>;
let seq = 920000;
let originalFetch: typeof fetch;
const pdfBytes = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

async function externalActor(channel: Channel, phone?: string): Promise<ExtActor> {
  const id = ++seq;
  const chatId = channel === "max" ? id + 200000 : id;
  const actorPhone = phone ?? `+7998${String(id).padStart(7, "0")}`;
  const partyId = (await getPool()!.query(
    `INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external',$1,$2) RETURNING id`,
    [`Ext sender ${id}`, actorPhone],
  )).rows[0].id;
  const personId = randomUUID();
  await getPool()!.query(
    `INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164) VALUES($1,$2,$3,$4)`,
    [personId, partyId, `Ext sender ${id}`, actorPhone],
  );
  await getPool()!.query(
    `INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
     VALUES($1,$2,$3,$4)`,
    [personId, channel, String(id), String(chatId)],
  );
  return { channel, id, chatId, partyId, personId, phone: actorPhone };
}

async function verifiedRecipient(channel: Channel, phone: string, name: string): Promise<{
  partyId: string; personId: string; messengerId: number;
}> {
  const messengerId = ++seq;
  const partyId = (await getPool()!.query(
    `INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external',$1,$2) RETURNING id`,
    [name, phone],
  )).rows[0].id;
  const personId = randomUUID();
  await getPool()!.query(
    `INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164) VALUES($1,$2,$3,$4)`,
    [personId, partyId, name, phone],
  );
  await getPool()!.query(
    `INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
     VALUES($1,$2,$3,$4)`,
    [personId, channel, String(messengerId), String(messengerId)],
  );
  return { partyId, personId, messengerId };
}

async function send(actor: ExtActor, input: { text?: string; callback?: string; document?: boolean }): Promise<Reply> {
  const id = ++seq;
  const out: Reply[] = [];
  if (actor.channel === "max") {
    const body: Record<string, unknown> = input.document
      ? {
          mid: `e2e-${id}`,
          attachments: [{
            type: "file",
            payload: { token: `max-file-${id}`, file_name: "doc.pdf", mime_type: "application/pdf", file_size: pdfBytes.length },
          }],
        }
      : { mid: `e2e-${id}`, text: input.text ?? "" };
    const raw = input.callback
      ? {
          update_type: "message_callback", timestamp: id,
          callback: { callback_id: `e2e-${id}`, payload: input.callback, user: { user_id: actor.id, is_bot: false } },
          message: { recipient: { chat_id: actor.chatId, chat_type: "dialog", user_id: actor.id }, body: { mid: `e2e-${id}` } },
        }
      : {
          update_type: "message_created", timestamp: id,
          message: {
            sender: { user_id: actor.id, is_bot: false },
            recipient: { chat_id: actor.chatId, chat_type: "dialog", user_id: 999000 },
            body,
          },
        };
    const result = await request(app).post("/api/tanbot-max/webhook")
      .set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!).send(raw);
    assert.equal(result.status, 200);
    const c = loadTanbotMaxStage2Config(); assert.ok(c.ok);
    await processUndeliveredMaxWebhookReplies(getPool()!, c.config, async p => {
      out.push({ text: p.text, buttons: p.inlineButtons?.flat() ?? [] });
      return { ok: true, result: { message: { body: { mid: `reply-${id}` } } } };
    }, { deliveryEnabled: true });
  } else {
    const raw = input.callback
      ? {
          update_id: id, callback_query: {
            id: `e2e-${id}`, data: input.callback, from: { id: actor.id, is_bot: false },
            message: { message_id: id, chat: { id: actor.chatId, type: "private" } },
          },
        }
      : {
          update_id: id,
          message: {
            message_id: id, from: { id: actor.id, is_bot: false },
            chat: { id: actor.chatId, type: "private" },
            ...(input.document
              ? { document: { file_id: `tg-doc-${id}`, file_name: "doc.pdf", mime_type: "application/pdf", file_size: pdfBytes.length } }
              : { text: input.text ?? "" }),
          },
        };
    const result = await request(app).post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!).send(raw);
    assert.equal(result.status, 200);
    const c = loadTanbotTelegramStage2Config(); assert.ok(c.ok);
    await processUndeliveredTelegramWebhookReplies(getPool()!, c.config, async p => {
      if (p.method === "sendMessage") {
        const m = p.body.reply_markup as { inline_keyboard?: Button[][] } | undefined;
        out.push({ text: String(p.body.text), buttons: (m?.inline_keyboard ?? []).flat() });
      }
      return { ok: true, result: { message_id: id } };
    }, { deliveryEnabled: true });
  }
  assert.ok(out.length);
  return { ...out.at(-1)!, messages: out };
}

function button(r: Reply, pattern: RegExp): string {
  const b = r.buttons.find(x => pattern.test(x.text));
  assert.ok(b, JSON.stringify(r));
  const data = b.payload ?? b.callback_data;
  assert.ok(data);
  return data;
}

function draftKey(actor: ExtActor): string {
  return `native:ext:${actor.channel}:${actor.chatId}`;
}

async function draftRow(actor: ExtActor) {
  return (await getPool()!.query(
    `SELECT id,step,payload,confirmed_transfer_id FROM tt_external_request_drafts
     WHERE messenger_chat_id=$1 ORDER BY created_at DESC LIMIT 1`, [draftKey(actor)],
  )).rows[0];
}

async function bizSnapshot(draftId?: string) {
  const pool = getPool()!;
  const base = (await pool.query(`SELECT
    (SELECT count(*)::int FROM tt_parties) AS parties,
    (SELECT count(*)::int FROM tt_transfers) AS transfers,
    (SELECT count(*)::int FROM tt_transfer_invitations) AS invitations,
    (SELECT count(*)::int FROM tt_handoff_codes) AS codes,
    (SELECT count(*)::int FROM tt_transfer_attachments) AS attachments`)).rows[0];
  if (!draftId) return base;
  const draft = (await pool.query(
    `SELECT confirmed_transfer_id::text,
      (SELECT count(*)::int FROM tt_external_request_draft_files WHERE draft_id=$1::uuid) AS draft_files
     FROM tt_external_request_drafts WHERE id=$1::uuid`, [draftId],
  )).rows[0];
  return { ...base, draftConfirmed: draft?.confirmed_transfer_id ?? null, draftFiles: draft?.draft_files ?? 0 };
}

async function wizardToSummary(actor: ExtActor, recipientPhone: string, name: string, withDoc = false) {
  let r = await send(actor, { text: "Создать передачу" });
  r = await send(actor, { text: `E2E item ${actor.id}` });
  if (withDoc) {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.telegram.org") && url.includes("/getFile")) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: "documents/doc.pdf" } }));
      }
      if (url.includes("api.telegram.org") && url.includes("/file/bot")) {
        return new Response(pdfBytes, { headers: { "content-type": "application/pdf" } });
      }
      if (url.includes("synthetic.oneme.ru")) {
        return new Response(pdfBytes, { headers: { "content-type": "application/pdf" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    try {
      r = await send(actor, { document: true });
      r = await send(actor, { callback: button(r, /далее|пропустить/iu) });
    } finally {
      globalThis.fetch = async () => { throw new Error("No network in ext2ext test"); };
    }
  } else {
    r = await send(actor, { callback: button(r, /пропустить/iu) });
  }
  r = await send(actor, { callback: button(r, /пропустить/iu) });
  r = await send(actor, { text: recipientPhone });
  r = await send(actor, { text: name });
  r = await send(actor, { callback: button(r, /без срока/iu) });
  return r;
}

async function confirmSummary(actor: ExtActor, summary: Reply): Promise<Reply> {
  return send(actor, { callback: button(summary, /^Создать передачу$/u) });
}

function parseMst(text: string): string {
  const url = (text.match(/https?:\/\/[^\s)]+/g) ?? [])[0];
  assert.ok(url);
  const mst = new URL(url).searchParams.get("mst");
  assert.ok(mst);
  return mst;
}

async function issueRecipientCode(
  channel: Channel,
  mst: string,
  recipientPhone: string,
  recipientUserId: number,
): Promise<string> {
  if (channel === "telegram") {
    const cfg = loadTanbotTelegramStage2Config(); assert.ok(cfg.ok);
    await handleTanbotTelegramUpdate(getPool()!, cfg.config, {
      update_id: ++seq,
      message: {
        message_id: 1, chat: { id: recipientUserId, type: "private" },
        from: { id: recipientUserId, is_bot: false }, text: `/start ${mst}`,
      },
    });
    const contact = await handleTanbotTelegramUpdate(getPool()!, cfg.config, {
      update_id: ++seq,
      message: {
        message_id: 2, chat: { id: recipientUserId, type: "private" },
        from: { id: recipientUserId, is_bot: false },
        contact: { phone_number: recipientPhone, user_id: recipientUserId, first_name: "R" },
      },
    });
    const code = contact.reply?.copyOnlyCode;
    assert.ok(code && /^\d{6}$/.test(code), `expected copyOnlyCode, got ${JSON.stringify(contact.reply)}`);
    return code;
  }
  const cfg = loadTanbotMaxStage2Config(); assert.ok(cfg.ok);
  const vcfRaw =
    `BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nFN:R\\r\\nTEL;TYPE=CELL:${recipientPhone}\\r\\nEND:VCARD`;
  const hash = createHmac("sha256", process.env.TANBOT_MAX_BOT_TOKEN!)
    .update(decodeVcfInfoForHmac(vcfRaw), "utf8").digest("hex");
  await handleTanbotMaxUpdate(getPool()!, cfg.config, {
    update_type: "bot_started", timestamp: ++seq, chat_id: recipientUserId,
    user: { user_id: recipientUserId, is_bot: false, first_name: "R" }, payload: mst,
  });
  const contact = await handleTanbotMaxUpdate(getPool()!, cfg.config, {
    update_type: "message_created", timestamp: ++seq,
    message: {
      sender: { user_id: recipientUserId, is_bot: false, first_name: "R" },
      recipient: { chat_id: recipientUserId },
      body: {
        mid: `contact-${seq}`,
        attachments: [{
          type: "contact",
          payload: { vcf_info: vcfRaw, hash, max_info: { user_id: recipientUserId, first_name: "R" } },
        }],
      },
    },
  });
  const code = contact.reply?.copyOnlyCode;
  assert.ok(code && /^\d{6}$/.test(code), `expected copyOnlyCode, got ${JSON.stringify(contact.reply)}`);
  return code;
}

function receiptEntryCallback(created: Reply, publicCode: string): string {
  for (const m of created.messages ?? [created]) {
    const b = m.buttons.find(x => /Ввести код/u.test(x.text) && x.text.includes(publicCode));
    if (b) {
      const data = b.payload ?? b.callback_data;
      assert.ok(data);
      return data;
    }
  }
  throw new Error(`missing receipt entry for ${publicCode}: ${JSON.stringify(created)}`);
}

async function senderVerifyViaBot(actor: ExtActor, created: Reply, publicCode: string, code: string) {
  const entryCb = receiptEntryCallback(created, publicCode);
  await send(actor, { callback: entryCb });
  const verified = await send(actor, { text: code });
  assert.match(verified.text, /Код проверен|подтверждена/iu);
}

before(async () => {
  setIntegrationEnv(db, origin);
  Object.assign(process.env, {
    TT_OTP_PEPPER: "independent-ext2ext-pepper-min16",
    TT_EXTERNAL_MESSENGER_ENABLED: "true",
    TANBOT_HANDOFF_CODE_PILOT_ENABLED: "true",
    TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
    TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
    TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-ext2ext-synthetic-test-token",
    TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_ext2ext_bot",
    TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-ext2ext-telegram-pepper",
    TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-ext2ext-telegram-secret",
    TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true",
    TANBOT_MAX_DELIVERY_ENABLED: "false", TANBOT_MAX_BOT_TOKEN: "SYNTHETIC_EXT2EXT_MAX_TOKEN",
    TANBOT_MAX_BOT_USERNAME: "synthetic_ext2ext_bot",
    TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-ext2ext-max-pepper",
    TANBOT_MAX_WEBHOOK_SECRET: "synthetic-ext2ext-max-secret",
  });
  await prepareDatabase(db);
  await resetPoolForTests();
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No network in ext2ext test"); };
  const { createApp } = await import("../../src/server");
  app = createApp();
});

after(async () => {
  globalThis.fetch = originalFetch;
  await closePool();
});

describe("native external sender to external recipient (both channels)", { concurrency: false }, () => {
  for (const channel of ["telegram", "max"] as const) {
    it(`${channel}: invitation, copyOnlyCode, native webhook receipt`, async () => {
      const sender = await externalActor(channel);
      const recipientPhone = `+7904${String(++seq).padStart(7, "0")}`;
      const summary = await wizardToSummary(sender, recipientPhone, "Canonical Ext Recipient");
      const created = await confirmSummary(sender, summary);
      const draft = await draftRow(sender);
      assert.ok(draft.confirmed_transfer_id);
      const row = (await getPool()!.query(
        `SELECT t.id,t.public_code,t.holder_party_id::text,t.pending_party_id::text,t.handoff_version
         FROM tt_transfers t WHERE t.id=$1`, [draft.confirmed_transfer_id],
      )).rows[0];
      assert.equal(row.holder_party_id, sender.partyId);
      const inviteText = (created.messages ?? [created]).map(m => m.text).join("\n");
      assert.match(inviteText, /Посмотреть передачу/u);
      const mst = parseMst(inviteText);
      const beforeIssue = (await getPool()!.query(
        `SELECT holder_party_id::text,pending_party_id::text,handoff_version FROM tt_transfers WHERE id=$1`, [row.id],
      )).rows[0];
      const code = await issueRecipientCode(channel, mst, recipientPhone, ++seq);
      const afterIssue = (await getPool()!.query(
        `SELECT holder_party_id::text,pending_party_id::text,handoff_version FROM tt_transfers WHERE id=$1`, [row.id],
      )).rows[0];
      assert.deepEqual(afterIssue, beforeIssue, "code issuance must not change custody");
      await senderVerifyViaBot(sender, created, row.public_code, code);
      const afterVerify = (await getPool()!.query(
        `SELECT holder_party_id::text,pending_party_id,handoff_version FROM tt_transfers WHERE id=$1`, [row.id],
      )).rows[0];
      assert.equal(afterVerify.holder_party_id, row.pending_party_id);
      assert.equal(afterVerify.pending_party_id, null);
      assert.equal(afterVerify.handoff_version, row.handoff_version + 1);
    });

    it(`${channel}: verified recipient person and party reused without rename`, async () => {
      const phone = `+7905${String(++seq).padStart(7, "0")}`;
      const existing = await verifiedRecipient(channel, phone, "Canonical Verified Name");
      const sender = await externalActor(channel);
      const summary = await wizardToSummary(sender, phone, "Attempted Rename");
      await confirmSummary(sender, summary);
      const transfer = (await getPool()!.query(
        `SELECT pending_party_id::text FROM tt_transfers WHERE creator_party_id=$1::uuid ORDER BY created_at DESC LIMIT 1`,
        [sender.partyId],
      )).rows[0];
      assert.equal(transfer.pending_party_id, existing.partyId);
      assert.equal(
        (await getPool()!.query(`SELECT display_name FROM tt_parties WHERE id=$1`, [existing.partyId])).rows[0].display_name,
        "Canonical Verified Name",
      );
      assert.equal(
        (await getPool()!.query(`SELECT id::text FROM tt_external_persons WHERE party_id=$1`, [existing.partyId])).rows[0].id,
        existing.personId,
      );
    });

    it(`${channel}: draft document copied once to transfer attachments`, async () => {
      const sender = await externalActor(channel);
      const phone = `+7908${String(++seq).padStart(7, "0")}`;
      const before = await bizSnapshot();
      const summary = await wizardToSummary(sender, phone, "Attachment Recipient", true);
      const draft = await draftRow(sender);
      assert.ok((await bizSnapshot(draft.id)).draftFiles >= 1);
      await confirmSummary(sender, summary);
      const tid = (await draftRow(sender)).confirmed_transfer_id;
      assert.ok(tid);
      const files = await getPool()!.query(
        `SELECT original_name,mime_type,uploaded_by_user_id FROM tt_transfer_attachments WHERE transfer_id=$1`, [tid],
      );
      assert.equal(files.rowCount, 1);
      assert.equal(files.rows[0].original_name, "doc.pdf");
      assert.equal(files.rows[0].mime_type, "application/pdf");
      assert.equal(files.rows[0].uploaded_by_user_id, null);
      assert.equal((await bizSnapshot()).transfers, before.transfers + 1);
      assert.equal((await bizSnapshot()).attachments, before.attachments + 1);
    });
  }

  it("telegram: self recipient rolls back with draft snapshot preserved", async () => {
    const sender = await externalActor("telegram");
    const summary = await wizardToSummary(sender, sender.phone, "Self Target");
    const draft = await draftRow(sender);
    const before = await bizSnapshot(draft.id);
    const r = await confirmSummary(sender, summary);
    assert.match(r.text, /себ|получател/iu);
    assert.equal((await draftRow(sender)).confirmed_transfer_id, null);
    assert.deepEqual(await bizSnapshot(draft.id), before);
  });

  it("max: employee phone collision is neutral for external actor", async () => {
    const sender = await externalActor("max");
    const empPhone = `+7906${String(++seq).padStart(7, "0")}`;
    const emp = await createTestUser({
      databaseUrl: db, email: `ext2ext-emp-${seq}@test.local`, password: "StrongPass123!",
      fullName: "Hidden Employee Oracle", role: "manager",
    });
    await ensurePartyForUserOnWrite(getPool()!, emp.id, "Hidden Employee Oracle", empPhone);
    const summary = await wizardToSummary(sender, empPhone, "Should Fail");
    const draft = await draftRow(sender);
    const before = await bizSnapshot(draft.id);
    const r = await confirmSummary(sender, summary);
    assert.match(r.text, /Получатель недоступен/u);
    assert.ok(r.text.includes(externalUnavailableMessage().split(".")[0] ?? "недоступен"));
    assert.doesNotMatch(r.text, /Hidden Employee|сотрудник|личный кабинет/iu);
    assert.equal((await draftRow(sender)).confirmed_transfer_id, null);
    assert.deepEqual(await bizSnapshot(draft.id), before);
  });

  it("telegram: ambiguous duplicate phone rolls back and keeps draft/files", async () => {
    const sender = await externalActor("telegram");
    const dupPhone = `+7909${String(++seq).padStart(7, "0")}`;
    await getPool()!.query(
      `INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external','Dup A',$1),('external','Dup B',$1)`,
      [dupPhone],
    );
    const summary = await wizardToSummary(sender, dupPhone, "Dup Recipient");
    const draft = await draftRow(sender);
    const before = await bizSnapshot(draft.id);
    const r = await confirmSummary(sender, summary);
    assert.match(r.text, /несколько контактов|недоступен|получател/iu);
    assert.equal((await draftRow(sender)).confirmed_transfer_id, null);
    assert.deepEqual(await bizSnapshot(draft.id), before);
  });

  for (const channel of ["telegram", "max"] as const) {
    it(`${channel}: concurrent confirm and replayed callback stay idempotent`, async () => {
      const sender = await externalActor(channel);
      const phone = `+7907${String(++seq).padStart(7, "0")}`;
      const summary = await wizardToSummary(sender, phone, "Once Only");
      const confirm = button(summary, /^Создать передачу$/u);
      await Promise.all([
        request(app).post(channel === "telegram" ? "/api/tanbot-telegram/webhook" : "/api/tanbot-max/webhook")
          .set(channel === "telegram" ? "X-Telegram-Bot-Api-Secret-Token" : "X-Max-Bot-Api-Secret",
            channel === "telegram" ? process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET! : process.env.TANBOT_MAX_WEBHOOK_SECRET!)
          .send(channel === "telegram"
            ? { update_id: ++seq, callback_query: { id: "p1", data: confirm, from: { id: sender.id, is_bot: false },
                message: { message_id: 1, chat: { id: sender.chatId, type: "private" } } } }
            : { update_type: "message_callback", timestamp: ++seq,
                callback: { callback_id: "p1", payload: confirm, user: { user_id: sender.id, is_bot: false } },
                message: { recipient: { chat_id: sender.chatId, chat_type: "dialog", user_id: sender.id }, body: { mid: "p1" } } }),
        request(app).post(channel === "telegram" ? "/api/tanbot-telegram/webhook" : "/api/tanbot-max/webhook")
          .set(channel === "telegram" ? "X-Telegram-Bot-Api-Secret-Token" : "X-Max-Bot-Api-Secret",
            channel === "telegram" ? process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET! : process.env.TANBOT_MAX_WEBHOOK_SECRET!)
          .send(channel === "telegram"
            ? { update_id: ++seq, callback_query: { id: "p2", data: confirm, from: { id: sender.id, is_bot: false },
                message: { message_id: 2, chat: { id: sender.chatId, type: "private" } } } }
            : { update_type: "message_callback", timestamp: ++seq,
                callback: { callback_id: "p2", payload: confirm, user: { user_id: sender.id, is_bot: false } },
                message: { recipient: { chat_id: sender.chatId, chat_type: "dialog", user_id: sender.id }, body: { mid: "p2" } } }),
      ]);
      assert.equal(
        (await getPool()!.query(`SELECT count(*)::int AS n FROM tt_transfers WHERE creator_party_id=$1::uuid AND item_title=$2`, [
          sender.partyId, `E2E item ${sender.id}`,
        ])).rows[0].n,
        1,
      );
      assert.equal(
        (await getPool()!.query(`SELECT count(*)::int AS n FROM tt_transfer_invitations i
          JOIN tt_transfers t ON t.id=i.transfer_id WHERE t.creator_party_id=$1::uuid AND t.item_title=$2`, [
          sender.partyId, `E2E item ${sender.id}`,
        ])).rows[0].n,
        1,
      );
      await send(sender, { callback: confirm });
      assert.equal(
        (await getPool()!.query(`SELECT count(*)::int AS n FROM tt_transfers WHERE creator_party_id=$1::uuid AND item_title=$2`, [
          sender.partyId, `E2E item ${sender.id}`,
        ])).rows[0].n,
        1,
      );
    });

    it(`${channel}: wrong and expired codes reject; foreign actor cannot issue`, async () => {
      const sender = await externalActor(channel);
      const phone = `+7910${String(++seq).padStart(7, "0")}`;
      const summary = await wizardToSummary(sender, phone, "Code Guards");
      const created = await confirmSummary(sender, summary);
      const row = (await getPool()!.query(
        `SELECT id,public_code,pending_party_id::text,handoff_version FROM tt_transfers
         WHERE creator_party_id=$1::uuid ORDER BY created_at DESC LIMIT 1`, [sender.partyId],
      )).rows[0];
      const mst = parseMst((created.messages ?? [created]).map(m => m.text).join("\n"));
      const code = await issueRecipientCode(channel, mst, phone, ++seq);
      const foreign = await externalActor(channel);
      const entryCb = receiptEntryCallback(created, row.public_code);
      await send(foreign, { callback: entryCb });
      const foreignTry = await send(foreign, { text: code });
      assert.match(foreignTry.text, /недоступ|не подтвержден|выберите/i);
      await send(sender, { callback: entryCb });
      const wrong = await send(sender, { text: "000000" });
      assert.match(wrong.text, /не подтвержден|невер|код/i);
      await getPool()!.query(
        `UPDATE tt_handoff_codes SET expires_at=NOW()-INTERVAL '1 minute' WHERE transfer_id=$1`, [row.id],
      );
      const expired = await send(sender, { text: code });
      assert.match(expired.text, /истёк|невер|не подтвержден/i);
      assert.equal(
        (await getPool()!.query(`SELECT holder_party_id::text FROM tt_transfers WHERE id=$1`, [row.id])).rows[0].holder_party_id,
        sender.partyId,
      );
    });
  }

  it("telegram: nullable creator holder assigns next external by phone after real receipt", async () => {
    const sender = await externalActor("telegram");
    const recipientPhone = `+7911${String(++seq).padStart(7, "0")}`;
    const summary = await wizardToSummary(sender, recipientPhone, "First Hop Recipient");
    const created = await confirmSummary(sender, summary);
    const row = (await getPool()!.query(
      `SELECT id,public_code,pending_party_id::text,handoff_version FROM tt_transfers
       WHERE creator_party_id=$1::uuid ORDER BY created_at DESC LIMIT 1`, [sender.partyId],
    )).rows[0];
    const mst = parseMst((created.messages ?? [created]).map(m => m.text).join("\n"));
    const code = await issueRecipientCode("telegram", mst, recipientPhone, ++seq);
    await senderVerifyViaBot(sender, created, row.public_code, code);
    const after = (await getPool()!.query(
      `SELECT holder_party_id::text,pending_party_id,handoff_version,creator_party_id::text FROM tt_transfers WHERE id=$1`, [row.id],
    )).rows[0];
    assert.equal(after.pending_party_id, null);
    const holderHat = signHolderAccess({
      transferId: row.id,
      partyId: after.holder_party_id,
      hv: after.handoff_version,
      exp: Date.now() + holderAccessTtlMs(),
    });
    const nextPhone = `+7912${String(++seq).padStart(7, "0")}`;
    const change = await request(app).post("/api/tan-tracker/public/holder/pending/change")
      .set("Origin", origin)
      .send({ holderAccessToken: holderHat, external: { name: "Next Hop", phone: nextPhone } });
    assert.equal(change.status, 200, change.text);
    const stray = (await getPool()!.query(
      `INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external','Stranger','+79139999999') RETURNING id`,
    )).rows[0].id;
    const reject = await request(app).post("/api/tan-tracker/public/holder/pending/change")
      .set("Origin", origin)
      .send({ holderAccessToken: holderHat, pendingPartyId: stray });
    assert.equal(reject.status, 403);
    assert.equal(
      (await getPool()!.query(`SELECT user_id FROM tt_parties WHERE id=(SELECT creator_party_id FROM tt_transfers WHERE id=$1)`, [row.id])).rows[0].user_id,
      null,
    );
  });
});
