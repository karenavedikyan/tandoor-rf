import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { readAttachmentBytes } from "../../src/tan-tracker/attachments";
import { buildNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";
import { loadTanbotMaxStage2Config } from "../../src/tanbot-max/stage2-config";
import { loadTanbotTelegramStage2Config } from "../../src/tanbot-telegram/stage2-config";
import { processUndeliveredMaxWebhookReplies } from "../../src/tanbot-max/reply-retry";
import { processUndeliveredTelegramWebhookReplies } from "../../src/tanbot-telegram/reply-retry";
import { buildMaxSendMessagePayload } from "../../src/tanbot-max/delivery-transport";

type Channel = "max" | "telegram";
type Actor = { channel: Channel; id: number; chatId: number; staffId?: string };
type Button = { text: string; payload?: string; callback_data?: string };
type Reply = { text: string; buttons: Button[] };
type File = { key: string; name?: string; image?: boolean; video?: boolean; mime?: string; payloadName?: boolean; unsafe?: boolean; tokenOnly?: boolean };
type Input = { text?: string; callback?: string; files?: File[]; id?: number; timestamp?: number; optional?: boolean; group?: boolean };
const databaseUrl = getIntegrationDatabaseUrl();
let app: ReturnType<typeof import("../../src/server").createApp>;
let seq = 6300000, targetPartyId: string;
let realFetch: typeof fetch, unexpected = 0;
const fetches: string[] = [];
const media: { kind: string; token: string; body: Record<string, unknown> }[] = [];
let failMedia = false;
const pdf = (key: string) => Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Synthetic (${key}) >>\nendobj\n%%EOF\n`);
const jpg = (key: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.from(key)]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from("Synthetic video bytes")]);
const genericFiles: Record<string, Buffer> = {
  xlsx: Buffer.from("PK\u0003\u0004Synthetic Excel container"),
  docx: Buffer.from("PK\u0003\u0004Synthetic Word container"),
  zip: Buffer.from("PK\u0003\u0004Synthetic archive"),
  csv: Buffer.from("name,quantity\nSynthetic,1\n"),
  fake: Buffer.from("<html>not PDF</html>"),
  exe: Buffer.from("MZ-not-an-executable-fixture"),
  "video-file": mp4,
  "native-video": mp4,
  heic: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.from("Synthetic HEIC container")]),
  unknown: Buffer.from("Opaque synthetic attachment"),
};
const bytes = (key: string) => genericFiles[key] ?? (key.startsWith("image") ? jpg(key) : pdf(key));

before(async () => {
  setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
  Object.assign(process.env, {
    TT_ATTACHMENTS_BACKEND: "postgres", TT_EXTERNAL_MESSENGER_ENABLED: "true", TANBOT_HANDOFF_CODE_PILOT_ENABLED: "true",
    TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true", TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
    TANBOT_TELEGRAM_BOT_TOKEN: "123456789:SYNTH_NATIVE_PDF_TEST_TOKEN", TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_pdf_bot",
    TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-pdf-telegram-pepper", TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-pdf-telegram-secret",
    TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true", TANBOT_MAX_DELIVERY_ENABLED: "false",
    TANBOT_MAX_BOT_TOKEN: "SYNTH_NATIVE_PDF_MAX_TOKEN", TANBOT_MAX_BOT_USERNAME: "synthetic_pdf_bot",
    TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-pdf-max-pepper", TANBOT_MAX_WEBHOOK_SECRET: "synthetic-pdf-max-secret",
  });
  await prepareDatabase(databaseUrl); await resetPoolForTests();
  const target = await createTestUser({ databaseUrl, email: "pdf-target@test.local", password: "StrongPass123!",
    fullName: "PDF Attachment Target", role: "manager" });
  targetPartyId = (await ensurePartyForUserOnWrite(getPool()!, target.id, "PDF Attachment Target", "+79995550606")).id;
  await getPool()!.query("UPDATE users SET phone='+79995550606',accepts_external_tt_intake=TRUE WHERE id=$1", [target.id]);
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); fetches.push(url.href);
    if (url.hostname === "api.telegram.org" && url.pathname.endsWith("/getFile")) {
      const key = url.searchParams.get("file_id")!;
      return new Response(JSON.stringify({ ok: true, result: { file_path: key === "bad-path" ? "../outside.pdf" : `documents/${key}` } }));
    }
    if (url.hostname === "synthetic.oneme.ru" || (url.hostname === "api.telegram.org" && url.pathname.includes("/file/bot"))) {
      assert.equal(init?.redirect, "error");
      const key = url.pathname.split("/").at(-1)!;
      if (key === "failed") return new Response("", { status: 503 });
      if (key === "empty") return new Response(new Uint8Array(0));
      if (key === "oversize") return new Response(new Uint8Array(8 * 1024 * 1024 + 1));
      return new Response(bytes(key), { headers: { "content-type": key.startsWith("image") ? "image/jpeg" : "application/pdf" } });
    }
    unexpected++; throw new Error("No real network allowed in native PDF acceptance");
  };
  app = (await import("../../src/server")).createApp();
});
after(async () => { globalThis.fetch = realFetch; await closePool(); assert.equal(unexpected, 0); });

async function actor(channel: Channel, staff: boolean): Promise<Actor> {
  const id = ++seq, chatId = channel === "max" ? id + 100000 : id;
  if (staff) {
    const user = await createTestUser({ databaseUrl, email: `pdf-${id}@test.local`, password: "StrongPass123!",
      fullName: `Synthetic PDF Sender ${id}`, role: "admin" });
    await ensurePartyForUserOnWrite(getPool()!, user.id, `Synthetic PDF Sender ${id}`, null);
    await getPool()!.query(`INSERT INTO tanbot_${channel}_accounts(user_id,${channel}_user_id,${channel}_chat_id,notifications_enabled)
      VALUES($1,$2,$3,TRUE)`, [user.id, String(id), String(chatId)]);
    return { channel, id, chatId, staffId: user.id };
  }
  const partyId = randomUUID(), personId = randomUUID(), phone = `+7997${String(id).padStart(7, "0")}`;
  await getPool()!.query("INSERT INTO tt_parties(id,kind,display_name,phone_e164) VALUES($1,'external','Synthetic PDF External',$2)", [partyId, phone]);
  await getPool()!.query("INSERT INTO tt_external_persons(id,party_id,display_name,phone_e164) VALUES($1,$2,'Synthetic PDF External',$3)", [personId, partyId, phone]);
  await getPool()!.query(`INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id)
    VALUES($1,$2,$3,$4)`, [personId, channel, String(id), String(chatId)]);
  return { channel, id, chatId };
}
async function drain(a: Actor): Promise<Reply[]> {
  const replies: Reply[] = [];
  if (a.channel === "max") {
    const cfg = loadTanbotMaxStage2Config(); assert.ok(cfg.ok);
    await processUndeliveredMaxWebhookReplies(getPool()!, cfg.config, async p => {
      assert.equal(p.userId, BigInt(a.id), "use actual MAX user, not dialog ID");
      const body = buildMaxSendMessagePayload(p);
      const attachments = (body.attachments ?? []) as { type: string; payload?: { token?: string } }[];
      const m = attachments.find(x => x.type === "file" || x.type === "image" || x.type === "video");
      if (m) {
        media.push({ kind: m.type, token: m.payload?.token ?? "", body });
        if (failMedia) { failMedia = false; return { ok: false, code: "API_ERROR", message: "Synthetic retry", retryable: true }; }
      } else replies.push({ text: p.text, buttons: p.inlineButtons?.flat() ?? [] });
      return { ok: true, result: { message: { body: { mid: `pdf-result-${seq}` } } } };
    }, { deliveryEnabled: true });
  } else {
    const cfg = loadTanbotTelegramStage2Config(); assert.ok(cfg.ok);
    await processUndeliveredTelegramWebhookReplies(getPool()!, cfg.config, async p => {
      assert.equal(String(p.body.chat_id), String(a.id));
      if (["sendPhoto", "sendDocument", "sendVideo"].includes(String(p.method))) {
        media.push({ kind: String(p.method), token: String(p.body.document ?? p.body.photo ?? p.body.video ?? ""), body: p.body });
        if (failMedia) { failMedia = false; return { ok: false, code: "API_ERROR", message: "Synthetic retry", retryable: true }; }
      } else if (p.method === "sendMessage") {
        const markup = p.body.reply_markup as { inline_keyboard?: Button[][]; keyboard?: Button[][] } | undefined;
        replies.push({ text: String(p.body.text), buttons: (markup?.inline_keyboard ?? markup?.keyboard ?? []).flat() });
      }
      return { ok: true, result: { message_id: seq } };
    }, { deliveryEnabled: true });
  }
  return replies;
}
async function send(a: Actor, input: Input): Promise<Reply> {
  const id = input.id ?? ++seq;
  if (a.channel === "max") {
    const body: Record<string, unknown> = { mid: `pdf-${id}`, text: input.text ?? "" };
    if (input.files) body.attachments = input.files.map(f => f.image
      ? { type: "image", payload: { url: `https://synthetic.oneme.ru/files/${f.key}`, token: `image-token-${f.key}`, file_name: f.name ?? `${f.key}.jpg` } }
      : { type: f.video ? "video" : "file", ...(f.payloadName ? {} : { filename: f.name ?? `${f.key}.pdf`, size: 100 }),
          payload: { ...(f.tokenOnly ? {} : { url: f.unsafe ? "https://127.0.0.1/private.pdf" : `https://synthetic.oneme.ru/files/${f.key}` }),
            token: `${f.video ? "video" : "file"}-token-${f.key}`, ...(f.payloadName ? { filename: f.name ?? `${f.key}.pdf`, size: 100 } : {}) } });
    const message = { sender: { user_id: a.id, is_bot: false },
      recipient: { chat_id: a.chatId, chat_type: input.group ? "chat" : "dialog" }, body };
    const raw = input.callback
      ? { update_type: "message_callback", timestamp: input.timestamp ?? id, message,
          callback: { callback_id: `pdf-cb-${id}`, payload: input.callback, user: { user_id: a.id, is_bot: false } } }
      : { update_type: "message_created", timestamp: input.timestamp ?? id, message };
    const r = await request(app).post("/api/tanbot-max/webhook").set("X-Max-Bot-Api-Secret", process.env.TANBOT_MAX_WEBHOOK_SECRET!).send(raw);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  } else {
    const f = input.files?.[0];
    const message = { message_id: id, from: { id: a.id, is_bot: false }, chat: { id: a.chatId, type: input.group ? "group" : "private" },
      ...(f ? { [f.video ? "video" : "document"]: { file_id: f.key, file_unique_id: `unique-${f.key}`, file_name: f.name ?? `${f.key}.pdf`,
        mime_type: f.mime ?? (f.image ? "image/jpeg" : f.video ? "video/mp4" : "application/pdf"), file_size: 100 }, caption: input.text ?? "" } : { text: input.text ?? "" }) };
    const raw = input.callback ? { update_id: id, callback_query: { id: `pdf-cb-${id}`, data: input.callback, from: message.from, message } }
      : { update_id: id, message };
    const r = await request(app).post("/api/tanbot-telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", process.env.TANBOT_TELEGRAM_WEBHOOK_SECRET!).send(raw);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const replies = await drain(a);
  if (!input.optional) assert.ok(replies.length, "a document upload must not be silently dropped");
  return replies.at(-1) ?? { text: "", buttons: [] };
}
function button(r: Reply, re: RegExp) {
  const b = r.buttons.find(x => re.test(x.text)); assert.ok(b, `${re}: ${JSON.stringify(r)}`);
  const value = b.payload ?? b.callback_data; assert.ok(value); assert.ok(Buffer.byteLength(value) <= 64); return value;
}
async function draft(a: Actor) {
  const key = `native:${a.staffId ? "staff" : "ext"}:${a.channel}:${a.chatId}`;
  const d = (await getPool()!.query("SELECT id,step,payload,confirmed_transfer_id FROM tt_external_request_drafts WHERE messenger_chat_id=$1 ORDER BY created_at DESC LIMIT 1", [key])).rows[0];
  assert.ok(d); return d;
}
async function files(a: Actor) {
  return (await getPool()!.query("SELECT storage_key,file_name,mime_type,byte_size::int,sort_order FROM tt_external_request_draft_files WHERE draft_id=$1 ORDER BY sort_order", [(await draft(a)).id])).rows;
}
async function counts() {
  return (await getPool()!.query(`SELECT
    (SELECT count(*) FROM tt_parties)::int parties,(SELECT count(*) FROM tt_transfers)::int transfers,
    (SELECT count(*) FROM tt_handoff_codes)::int codes,(SELECT count(*) FROM tt_transfer_invitations)::int invitations,
    (SELECT count(*) FROM tt_audit_log)::int audit,(SELECT count(*) FROM tt_external_person_verifications)::int verifications,
    (SELECT count(*) FROM tt_external_persons)::int persons,(SELECT count(*) FROM tanbot_notification_outbox)::int notices,
    (SELECT count(*) FROM tt_external_person_message_outbox)::int external_notices`)).rows[0];
}
async function start(a: Actor) {
  await send(a, { text: "Создать передачу" });
  const r = await send(a, { text: "Синтетические вложения" }); assert.equal((await draft(a)).step, "photo"); return r;
}
function guidance(r: Reply, n: number) {
  assert.match(r.text, new RegExp(`${n}\\s*\\/\\s*5`)); button(r, /^далее$/iu);
  if (!n) button(r, /пропустить/iu); else assert.ok(!r.buttons.some(b => /пропустить/iu.test(b.text)));
}
async function summary(a: Actor, r: Reply) {
  r = await send(a, { callback: button(r, /^далее$/iu) });
  r = await send(a, { callback: button(r, /пропустить/iu) });
  if (a.staffId) {
    r = await send(a, { text: "PDF Attachment Target" });
    r = await send(a, { callback: button(r, /PDF Attachment Target/u) });
  } else {
    r = await send(a, { text: "+79995550606" });
    r = await send(a, { text: "Мой получатель документов" });
    for (let i = 0; i < 3 && (await draft(a)).step !== "due"; i++) r = await send(a, { callback: button(r, /оставить имя|^далее$/iu) });
  }
  assert.equal((await draft(a)).step, "due");
  return send(a, { callback: button(r, /без срока/iu) });
}
async function inspect(a: Actor, r: Reply, index = 0) {
  const d = await draft(a), cb = buildNativeCreateCallback("photo_view", d.id, d.payload.revision, String(index)); assert.ok(cb);
  assert.ok(r.buttons.some(b => (b.payload ?? b.callback_data) === cb), "summary must expose a usable attachment inspection button");
  return send(a, { callback: cb });
}

for (const channel of ["max", "telegram"] as const) {
  for (const staff of [true, false]) {
    it(`${channel} ${staff ? "staff" : "external"}: PDFs acknowledged, privately delivered as documents and attached canonically once`, async () => {
      const a = await actor(channel, staff), initial = await start(a), before = await counts();
      assert.match(initial.text, /PDF/iu);
      let r = await send(a, { files: [{ key: "first", name: "first.pdf" }] }); guidance(r, 1);
      r = await send(a, { files: [{ key: "second", name: "second.pdf", payloadName: true }] }); guidance(r, 2);
      const saved = await files(a); assert.equal(saved.length, 2);
      for (const [i, key] of ["first", "second"].entries()) {
        assert.equal(saved[i].mime_type, "application/pdf"); assert.equal(saved[i].file_name, `${key}.pdf`);
        assert.deepEqual(await readAttachmentBytes(saved[i].storage_key), pdf(key));
      }
      assert.deepEqual(await counts(), before);
      r = await summary(a, r);
      assert.doesNotMatch(r.text, /Фото:\s*2\b/iu, "PDFs must not be labelled two photos");
      const priorMedia = media.length;
      r = await inspect(a, r); assert.equal(media.length, priorMedia + 1);
      assert.equal(media.at(-1)!.kind, channel === "max" ? "file" : "sendDocument");
      assert.equal(media.at(-1)!.token, channel === "max" ? "file-token-first" : "first");
      r = await send(a, { callback: button(r, /к сводке/iu) });
      const create = button(r, /^Создать передачу$/u);
      await send(a, { callback: create });
      const id = (await draft(a)).confirmed_transfer_id; assert.ok(id);
      assert.equal((await getPool()!.query("SELECT pending_party_id FROM tt_transfers WHERE id=$1", [id])).rows[0].pending_party_id, targetPartyId);
      const attached = (await getPool()!.query("SELECT storage_key,original_name,mime_type FROM tt_transfer_attachments WHERE transfer_id=$1 ORDER BY original_name", [id])).rows;
      assert.equal(attached.length, 2);
      for (const [i, key] of ["first", "second"].entries()) {
        assert.equal(attached[i].mime_type, "application/pdf");
        assert.deepEqual(await readAttachmentBytes(attached[i].storage_key), pdf(key));
      }
      await send(a, { callback: create, optional: true });
      assert.equal((await getPool()!.query("SELECT id FROM tt_transfer_attachments WHERE transfer_id=$1", [id])).rowCount, 2);
    });
  }
  it(`${channel}: invalid files preserve prior PDF and shared five-file limit has current Next`, async () => {
    const a = await actor(channel, true); await start(a); const before = await counts();
    let r = await send(a, { files: [{ key: "empty" }] }); guidance(r, 0);
    r = await send(a, { files: [{ key: "kept" }] }); guidance(r, 1);
    const kept = await files(a);
    for (const key of ["empty", "oversize", "failed"]) {
      r = await send(a, { files: [{ key, name: `${key}.pdf` }] }); guidance(r, 1);
      assert.deepEqual(await files(a), kept);
      assert.match(r.text, /не удалось|недопуст|не поддерж|допустим|формат|размер|8\s*мб/iu);
    }
    for (let i = 0; i < 4; i++) r = await send(a, { files: [{ key: `extra-${i}` }] });
    guidance(r, 5); const beforeLimit = fetches.length;
    r = await send(a, { files: [{ key: "must-not-fetch" }] }); guidance(r, 5);
    assert.equal(fetches.length, beforeLimit); assert.equal((await files(a)).length, 5);
    assert.deepEqual(await readAttachmentBytes(kept[0].storage_key), pdf("kept"));
    assert.deepEqual(await counts(), before);
    await send(a, { callback: button(r, /^далее$/iu) }); assert.equal((await draft(a)).step, "comment");
  });
  it(`${channel}: group, foreign dialog and disabled sender cannot download or write documents`, async () => {
    const a = await actor(channel, true); await start(a); const before = await counts(), f = fetches.length;
    await send(a, { files: [{ key: "group" }], group: true, optional: true });
    await send({ ...a, chatId: a.chatId + 20000 }, { files: [{ key: "foreign-chat" }], optional: true });
    await getPool()!.query("UPDATE users SET status='disabled' WHERE id=$1", [a.staffId]);
    await send(a, { files: [{ key: "disabled" }], optional: true });
    assert.equal(fetches.length, f); assert.equal((await files(a)).length, 0); assert.deepEqual(await counts(), before);
  });
  it(`${channel}: document delivery retries only media, never primary text`, async () => {
    const a = await actor(channel, false); await start(a);
    let r = await send(a, { files: [{ key: "retry" }] }); r = await summary(a, r);
    failMedia = true; const m = media.length; await inspect(a, r);
    assert.equal(media.length, m + 1);
    const messages = await drain(a); assert.equal(messages.length, 0, "retry does not send explanatory message twice");
    assert.equal(media.length, m + 2); assert.equal(media.at(-1)!.kind, channel === "max" ? "file" : "sendDocument");
    await drain(a); assert.equal(media.length, m + 2);
  });
  it(`${channel}: Excel, Word, archive, HTML and opaque executable bytes survive canonical creation without inline interpretation`, async () => {
    const a = await actor(channel, true); await start(a); const before = await counts();
    const samples = [
      { key: "xlsx", name: "table.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { key: "docx", name: "document.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      { key: "zip", name: "archive.zip", mime: "application/zip" },
      { key: "fake", name: "claimed-pdf.pdf", mime: "application/pdf" },
      { key: "exe", name: "opaque.exe", mime: "application/octet-stream" },
    ];
    let r: Reply = { text: "", buttons: [] };
    for (const [index, sample] of samples.entries()) {
      r = await send(a, { files: [sample] }); guidance(r, index + 1);
      const row = (await files(a))[index];
      assert.equal(row.file_name, sample.name);
      assert.deepEqual(await readAttachmentBytes(row.storage_key), bytes(sample.key));
      assert.ok(!row.mime_type.startsWith("image/"), "generic files cannot enter image preview");
      if (sample.key === "fake" || sample.key === "exe") assert.equal(row.mime_type, "application/octet-stream");
    }
    assert.deepEqual(await counts(), before);
    r = await summary(a, r);
    r = await inspect(a, r, 0);
    assert.equal(media.at(-1)!.kind, channel === "max" ? "file" : "sendDocument");
    r = await send(a, { callback: button(r, /к сводке/iu) });
    await send(a, { callback: button(r, /^Создать передачу$/u) });
    const id = (await draft(a)).confirmed_transfer_id; assert.ok(id);
    const attached = (await getPool()!.query("SELECT storage_key,original_name,mime_type FROM tt_transfer_attachments WHERE transfer_id=$1", [id])).rows;
    assert.equal(attached.length, 5);
    for (const sample of samples) {
      const row = attached.find(x => x.original_name === sample.name); assert.ok(row);
      assert.deepEqual(await readAttachmentBytes(row.storage_key), bytes(sample.key));
      const { resolveAttachmentContentDisposition } = await import("../../src/tan-tracker/attachments");
      assert.equal(resolveAttachmentContentDisposition(row.mime_type, { preview: "1" }), "attachment");
    }
  });
  it(`${channel}: CSV, HEIC, unknown format and video sent as a file are not silently filtered`, async () => {
    const a = await actor(channel, false); await start(a); const before = await counts();
    const samples = [
      { key: "csv", name: "table.csv", mime: "text/csv" },
      { key: "heic", name: "picture.heic", mime: "image/heic" },
      { key: "unknown", name: "custom-format.opaque", mime: "application/x-unknown" },
      { key: "video-file", name: "clip.mp4", mime: "video/mp4" },
    ];
    let r: Reply = { text: "", buttons: [] };
    for (const [index, sample] of samples.entries()) {
      r = await send(a, { files: [sample] }); guidance(r, index + 1);
      assert.deepEqual(await readAttachmentBytes((await files(a))[index].storage_key), bytes(sample.key));
    }
    assert.deepEqual(await counts(), before);
    r = await summary(a, r); await inspect(a, r, 3);
    assert.equal(media.at(-1)!.kind, channel === "max" ? "file" : "sendDocument");
    assert.equal(media.at(-1)!.token, channel === "max" ? "file-token-video-file" : "video-file");
  });
  it(`${channel}: native video is stored as original bytes and inspected with the original provider media kind`, async () => {
    const a = await actor(channel, true); await start(a); const before = await counts();
    let r = await send(a, { files: [{ key: "native-video", name: "clip.mp4", video: true }] }); guidance(r, 1);
    assert.deepEqual(await readAttachmentBytes((await files(a))[0].storage_key), mp4);
    assert.deepEqual(await counts(), before);
    r = await summary(a, r); await inspect(a, r);
    assert.equal(media.at(-1)!.kind, channel === "max" ? "video" : "sendVideo");
    assert.equal(media.at(-1)!.token, channel === "max" ? "video-token-native-video" : "native-video");
  });
}
it("MAX: mixed image/PDF message preserves order, caption, distinct mids and replay dedup", async () => {
  const a = await actor("max", true); await start(a); const before = await counts(), id = ++seq, timestamp = id;
  const input = { id, timestamp, text: "подпись", files: [{ key: "image-mixed", image: true }, { key: "mixed", payloadName: true }] };
  let r = await send(a, input); guidance(r, 2);
  const stored = await files(a); assert.deepEqual(stored.map(x => x.mime_type), ["image/jpeg", "application/pdf"]);
  assert.deepEqual(await readAttachmentBytes(stored[0].storage_key), jpg("image-mixed"));
  assert.deepEqual(await readAttachmentBytes(stored[1].storage_key), pdf("mixed"));
  const f = fetches.length;
  await send(a, { ...input, optional: true }); assert.equal(fetches.length, f); assert.equal((await files(a)).length, 2);
  r = await send(a, { id: ++seq, timestamp, files: [{ key: "same-timestamp" }] }); guidance(r, 3);
  assert.deepEqual(await counts(), before);
});
it("MAX: unsafe URL and token-only document return feedback without any download", async () => {
  const a = await actor("max", false); await start(a); const before = await counts(), f = fetches.length;
  for (const file of [{ key: "unsafe", unsafe: true }, { key: "token", tokenOnly: true }]) {
    const r = await send(a, { files: [file] }); guidance(r, 0); assert.match(r.text, /не удалось|недоступ|отправьте|не принят/iu);
  }
  assert.equal(fetches.length, f); assert.equal((await files(a)).length, 0); assert.deepEqual(await counts(), before);
});
it("Telegram: image sent as a document is accepted by magic, not mistaken for a PDF", async () => {
  const a = await actor("telegram", true); await start(a);
  const r = await send(a, { files: [{ key: "image-as-file", image: true, name: "image-as-file.jpg" }] });
  button(r, /^далее$/iu);
  const saved = await files(a); assert.equal(saved.length, 1); assert.equal(saved[0].mime_type, "image/jpeg");
  assert.deepEqual(await readAttachmentBytes(saved[0].storage_key), jpg("image-as-file"));
  const summaryReply = await summary(a, r); await inspect(a, summaryReply);
  assert.equal(media.at(-1)!.kind, "sendDocument", "Telegram file_id cannot change from document to photo");
});
