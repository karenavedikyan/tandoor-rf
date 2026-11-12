import assert from "node:assert/strict";
import request from "supertest";
import { before, after, describe, it } from "node:test";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { getPool, resetPoolForTests, closePool } from "../../src/db/pool";
import { withTransaction as tx } from "../../src/access/db";
import { loadAccessContext } from "../../src/access/context";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createTransferInTransaction, type CreateTransferInput } from "../../src/tan-tracker/create-transfer-service";
import { buildTanTrackerBootstrap } from "../../src/tan-tracker/service";
import { loadContactAliases } from "../../src/tan-tracker/contact-aliases";
import { receiveCodeReply } from "../../src/tanbot/native-create/menu-actions";
import { appendReceiptEntryChoices, handleReceiptEntryCallback } from "../../src/tanbot/native-create/receipt-code-entry";
import { trackStatusReply } from "../../src/tanbot/native-create/track-status";
import { generateHandoffCodeForPendingParty } from "../../src/tan-tracker/handoff-code-generate";
import { verifyPendingReceiptCode } from "../../src/tan-tracker/verify-pending-receipt-code";
import { buildMaxNativeCreateContext, buildTelegramNativeCreateContext } from "../../src/tanbot/native-create/adapters";
import { confirmNativeStaffDraft } from "../../src/tanbot/native-create/confirm-native";
import { ensureNativeBotDraft, bumpDraftRevision, type NativeCreateDraftPayload } from "../../src/tanbot/native-create/draft-scope";
import { findExistingExternalByPhone } from "../../src/tanbot/native-create/recipient-unified";

const databaseUrl = getIntegrationDatabaseUrl();
const pool = () => getPool()!;
let seq = 0;
const phone = () => `+799944${String(++seq).padStart(5, "0")}`;
async function employee(number = phone(), withParty = false, status = "active", role: "manager" | "admin" = "manager") {
  const name = `Synthetic staff ${++seq}`;
  const { id } = await createTestUser({
    databaseUrl, email: `phone-first-${seq}@test.invalid`, password: "SyntheticPass123!",
    fullName: name, phone: number, role, status,
  });
  const party = withParty ? await tx(c => ensurePartyForUserOnWrite(c, id, name, number)) : null;
  const user = { id, fullName: name, phone: number, role, status: "active" as const,
    email: `phone-first-${seq}@test.invalid`, lastLoginAt: null };
  const access = await loadAccessContext(id);
  return { id, name, phone: number, partyId: party?.id ?? null, user, access };
}
type Employee = Awaited<ReturnType<typeof employee>>;
async function create(sender: Employee, number: string, name = "My private recipient", extra: Partial<CreateTransferInput> = {}) {
  return tx(c => createTransferInTransaction(c, { user: sender.user, access: sender.access },
    { item: "Synthetic phone-first agreement", finalRecipientExternal: { phone: number, name }, ...extra }));
}
const row = async (id: string) => (await pool().query("SELECT * FROM tt_transfers WHERE id=$1", [id])).rows[0];
const partyFor = async (id: string) => (await pool().query("SELECT * FROM tt_parties WHERE user_id=$1", [id])).rows[0];
const externalCount = async (number: string) => (await pool().query(
  "SELECT count(*)::int n FROM tt_parties WHERE kind='external' AND phone_e164=$1", [number])).rows[0].n;
let sender: Employee;
const originalFetch = globalThis.fetch;

describe("phone-first create: canonical identity and personal labels", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl);
    process.env.TANBOT_TELEGRAM_ENABLED = "false";
    process.env.TANBOT_MAX_ENABLED = "false";
    process.env.TANBOT_HANDOFF_CODE_PILOT_ENABLED = "true";
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    globalThis.fetch = (async () => { throw new Error("Unexpected external HTTP in isolated test"); }) as typeof fetch;
    sender = await employee();
  });
  after(async () => { globalThis.fetch = originalFetch; await closePool(); });

  for (const form of ["e164", "national", "eight"] as const) {
    it(`routes ${form} staff number to one canonical party, without a shadow or shared rename`, async () => {
      const recipient = await employee();
      const input = form === "national" ? recipient.phone.slice(2) : form === "eight" ? `8${recipient.phone.slice(2)}` : recipient.phone;
      const id = await create(sender, input, `Personal ${form}`);
      const p = await partyFor(recipient.id), t = await row(id);
      assert.equal(t.pending_party_id, p.id);
      assert.equal(t.final_recipient_party_id, p.id);
      assert.equal(p.display_name, recipient.name);
      assert.equal(p.phone_e164, recipient.phone);
      assert.equal(await externalCount(recipient.phone), 0);
      const own = await buildTanTrackerBootstrap(sender.user, sender.access);
      const theirs = await buildTanTrackerBootstrap(recipient.user, recipient.access);
      assert.equal(own.contacts.find(c => c.id === p.id)?.name, `Personal ${form}`);
      assert.equal(theirs.contacts.find(c => c.id === p.id)?.name, recipient.name);
      assert.ok(theirs.orders.some(o => o.id === id));
      assert.equal((await pool().query("SELECT full_name FROM users WHERE id=$1", [recipient.id])).rows[0].full_name, recipient.name);
    });
  }

  for (const role of ["manager", "admin"] as const) {
    it(`reuses an external party globally for ${role} and isolates aliases between creators`, async () => {
      const number = phone(), other = await employee(phone(), false, "active", role);
      const first = await create(sender, number, "My warehouse");
      const second = await create(other, number, "My client");
      assert.equal((await row(first)).pending_party_id, (await row(second)).pending_party_id);
      assert.equal(await externalCount(number), 1);
      const pid = (await row(first)).pending_party_id;
      const a = await buildTanTrackerBootstrap(sender.user, sender.access);
      const b = await buildTanTrackerBootstrap(other.user, other.access);
      assert.equal(a.contacts.find(c => c.id === pid)?.name, "My warehouse");
      assert.equal(b.contacts.find(c => c.id === pid)?.name, "My client");
      assert.equal((await pool().query("SELECT display_name FROM tt_parties WHERE id=$1", [pid])).rows[0].display_name, "Внешний получатель");
      assert.equal((await pool().query("SELECT created_by_user_id FROM tt_parties WHERE id=$1", [pid])).rows[0].created_by_user_id, sender.id);
      assert.equal((await tx(c => findExistingExternalByPhone(c, sender.id, number)))?.name, "My warehouse");
      assert.equal(await tx(c => findExistingExternalByPhone(c, other.id, number)), null);
    });
  }

  it("admin reuses an ownerless external by phone for final, relay and draft edit without enabling UUID selection", async () => {
    const admin = await employee(phone(), false, "active", "admin"), number = phone();
    const pid = (await pool().query(
      "INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external','Historical private label',$1) RETURNING id",
      [number])).rows[0].id;
    await assert.rejects(tx(c => createTransferInTransaction(c, { user: admin.user, access: admin.access }, {
      item: "Synthetic forbidden UUID", finalRecipientPartyId: pid,
    })), /недоступен/);
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const login = await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:3000")
      .send({ email: admin.user.email, password: "SyntheticPass123!" });
    assert.equal(login.status, 200);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const headers = { Cookie: cookie, Origin: "http://127.0.0.1:3000" };
    const created = await request(app).post("/api/tan-tracker/transfers").set(headers).send({
      item: "Synthetic admin phone create",
      finalRecipientExternal: { phone: number, name: "My direct contact" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const direct = created.body.publicCode as string;
    const relay = await create(admin, phone(), "My final contact", {
      relayExternal: { phone: number, name: "My relay contact" },
    });
    assert.equal((await row(direct)).final_recipient_party_id, pid);
    assert.equal((await row(relay)).pending_party_id, pid);
    assert.notEqual((await row(relay)).final_recipient_party_id, pid);
    const edit = await request(app).post(`/api/tan-tracker/transfers/${direct}/draft-edit`)
      .set(headers).send({
        item: "Edited admin synthetic agreement", rowVersion: 1,
        finalRecipientExternal: { phone: number, name: "My edited contact" },
      });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal((await row(direct)).pending_party_id, pid);
    assert.equal(await externalCount(number), 1);
    const original = (await pool().query("SELECT display_name,created_by_user_id FROM tt_parties WHERE id=$1", [pid])).rows[0];
    assert.equal(original.display_name, "Historical private label");
    assert.equal(original.created_by_user_id, null);
    const aliases = await loadContactAliases(pool(), (await partyFor(admin.id)).id);
    assert.equal(aliases.get(pid), "My edited contact");
    await assert.rejects(tx(c => createTransferInTransaction(c, { user: admin.user, access: admin.access }, {
      item: "Synthetic still forbidden UUID", finalRecipientPartyId: pid,
    })), /недоступен/);
  });

  it("prefers staff over an existing external shadow but leaves old history and bindings intact", async () => {
    const recipient = await employee(), number = recipient.phone;
    const shadow = (await pool().query(
      "INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external','Historical external',$1) RETURNING id", [number])).rows[0].id;
    const old = await create(sender, phone());
    await pool().query("UPDATE tt_transfers SET final_recipient_party_id=$2 WHERE id=$1", [old, shadow]);
    const id = await create(sender, number);
    assert.equal((await row(id)).pending_party_id, (await partyFor(recipient.id)).id);
    assert.equal((await row(old)).final_recipient_party_id, shadow);
    assert.equal(await externalCount(number), 1);
    assert.equal((await pool().query("SELECT display_name FROM tt_parties WHERE id=$1", [shadow])).rows[0].display_name, "Historical external");
  });

  it("rechecks a historical external bot pick by its typed phone at confirmation", async () => {
    const recipient = await employee(), number = recipient.phone;
    const shadow = (await pool().query(
      "INSERT INTO tt_parties(kind,display_name,phone_e164,created_by_user_id) VALUES('external','Old label',$1,$2) RETURNING id",
      [number, sender.id])).rows[0].id;
    const result = await tx(async c => {
      const draft = await ensureNativeBotDraft(c, { channel: "max", messengerChatId: "991111",
        actor: "staff", staffUserId: sender.id, step: "summary" });
      const payload = await bumpDraftRevision(c, draft.id, "summary", {
        ...(draft.payload as NativeCreateDraftPayload), item: "Synthetic bot create",
        recipientPartyId: shadow, recipientSearchQuery: number, dueMode: "none",
      });
      return confirmNativeStaffDraft(c, { draftId: draft.id, staffUserId: sender.id, payload, channel: "max" });
    });
    assert.equal((await row(result.publicCode)).pending_party_id, (await partyFor(recipient.id)).id);
  });

  it("uses the canonical staff number for a relay and preserves the final recipient", async () => {
    const relay = await employee();
    const id = await create(sender, phone(), "Final recipient", { relayExternal: { phone: relay.phone, name: "Driver for me" } });
    const t = await row(id);
    assert.equal(t.pending_party_id, (await partyFor(relay.id)).id);
    assert.notEqual(t.pending_party_id, t.final_recipient_party_id);
  });

  it("serializes concurrent creates on a new external phone", async () => {
    const number = phone(), other = await employee();
    const ids = await Promise.all([create(sender, number), create(other, number)]);
    assert.equal((await row(ids[0])).pending_party_id, (await row(ids[1])).pending_party_id);
    assert.equal(await externalCount(number), 1);
  });

  it("rejects self, invalid, inactive, ambiguous, stale and excluded-role phones without a new track", async () => {
    const inactive = await employee(phone(), false, "disabled");
    const first = await employee(), second = await employee(first.phone);
    const stale = await employee(phone(), true);
    const oldNumber = stale.phone;
    await pool().query("UPDATE users SET phone=$2 WHERE id=$1", [stale.id, phone()]);
    const excluded = await employee();
    await pool().query("UPDATE users SET role='analyst' WHERE id=$1", [excluded.id]);
    const before = (await pool().query("SELECT count(*)::int n FROM tt_transfers")).rows[0].n;
    for (const n of [sender.phone, "123", inactive.phone, first.phone, oldNumber, excluded.phone]) {
      await assert.rejects(create(sender, n));
    }
    assert.equal((await pool().query("SELECT count(*)::int n FROM tt_transfers")).rows[0].n, before);
    assert.equal(await externalCount(second.phone), 0);
  });

  it("does not broaden arbitrary UUID selection outside the sender team", async () => {
    const recipient = await employee(phone(), true);
    await assert.rejects(tx(c => createTransferInTransaction(c, { user: sender.user, access: sender.access }, {
      item: "Synthetic UUID bypass", finalRecipientPartyId: recipient.partyId!,
    })), /недоступен/);
  });

  it("rolls back aliases and recipient materialization if attachment validation fails", async () => {
    const recipient = await employee();
    await assert.rejects(create(sender, recipient.phone, "Should roll back", { stagingAttachmentIds: Array(11).fill("bad") }));
    assert.equal(await partyFor(recipient.id), undefined);
    const source = await partyFor(sender.id);
    const aliases = await loadContactAliases(pool(), source.id);
    assert.ok(![...aliases.values()].includes("Should roll back"));
  });

  it("blocks read-only preview before creating contacts", async () => {
    const number = phone();
    await assert.rejects(tx(c => createTransferInTransaction(c, {
      user: sender.user, access: { ...sender.access, preview: { readOnly: true } as never },
    }, { item: "Preview", finalRecipientExternal: { name: "Not created", phone: number } })));
    assert.equal(await externalCount(number), 0);
  });

  it("edits a draft to a staff phone atomically, preserving private names and rejecting stale versions/conflicts", async () => {
    const recipient = await employee();
    const id = await create(sender, phone());
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const login = await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:3000")
      .send({ email: sender.user.email, password: "SyntheticPass123!" });
    assert.equal(login.status, 200);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const headers = { Cookie: cookie, Origin: "http://127.0.0.1:3000" };
    const edit = await request(app).post(`/api/tan-tracker/transfers/${id}/draft-edit`).set(headers).send({
      item: "Edited synthetic agreement", rowVersion: 1,
      finalRecipientExternal: { name: "Private edited recipient", phone: recipient.phone },
    });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal((await row(id)).pending_party_id, (await partyFor(recipient.id)).id);
    assert.equal((await row(id)).row_version, 2);
    const aliases = await loadContactAliases(pool(), (await partyFor(sender.id)).id);
    assert.equal(aliases.get((await partyFor(recipient.id)).id), "Private edited recipient");
    const stale = await request(app).post(`/api/tan-tracker/transfers/${id}/draft-edit`).set(headers).send({
      item: "Stale", rowVersion: 1, finalRecipientExternal: { name: "Stale label", phone: recipient.phone },
    });
    assert.equal(stale.status, 409);
    const ambiguous = await employee();
    await employee(ambiguous.phone);
    for (const [url, payload] of [
      ["/api/tan-tracker/transfers", { item: "Conflict", finalRecipientExternal: { name: "Conflict", phone: ambiguous.phone } }],
      [`/api/tan-tracker/transfers/${id}/draft-edit`, { item: "Conflict", rowVersion: 2,
        finalRecipientExternal: { name: "Conflict", phone: ambiguous.phone } }],
    ] as const) {
      const conflict = await request(app).post(url).set(headers).send(payload);
      assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
    }
    assert.equal((await row(id)).row_version, 2);
    assert.equal((await row(id)).item_title, "Edited synthetic agreement");
  });

  it("keeps canonical MAX/Telegram identities, issues a recipient code and shows custody only after OTP", async () => {
    const recipient = await employee(phone(), true);
    const messengerId = BigInt(990000 + ++seq);
    await pool().query("INSERT INTO tanbot_max_accounts(user_id,max_user_id,max_chat_id) VALUES($1,$2,$2)", [recipient.id, String(messengerId)]);
    await pool().query("INSERT INTO tanbot_telegram_accounts(user_id,telegram_user_id,telegram_chat_id) VALUES($1,$2,$2)", [recipient.id, String(messengerId)]);
    const id = await create(sender, recipient.phone, "Personal receiving colleague");
    const senderMessenger = "99150000";
    await pool().query("INSERT INTO tanbot_max_accounts(user_id,max_user_id,max_chat_id) VALUES($1,$2,$2)", [sender.id, senderMessenger]);
    await pool().query("INSERT INTO tanbot_telegram_accounts(user_id,telegram_user_id,telegram_chat_id) VALUES($1,$2,$2)", [sender.id, senderMessenger]);
    for (const channel of ["max", "telegram"] as const) {
      const ctx = { channel, messengerUserId: BigInt(senderMessenger), messengerChatId: senderMessenger,
        isLinkedStaff: true, staffUserId: sender.id, personId: null, privateDialogOk: true };
      const detail = await tx(c => handleReceiptEntryCallback(c, ctx, { action: "pick", transferId: id, version: 1 }));
      assert.match(detail.text, /Personal receiving colleague/);
      const status = await tx(c => trackStatusReply(c, ctx, { action: "view", transferId: id }));
      assert.match(status.text, /Personal receiving colleague/);
    }
    const contexts = await tx(async c => [
      await buildMaxNativeCreateContext(c, { maxUserId: messengerId, chatId: messengerId, recipientChatType: "dialog" }),
      await buildTelegramNativeCreateContext(c, { telegramUserId: messengerId, chatId: messengerId }),
    ]);
    for (const ctx of contexts) {
      const incoming = await tx(c => receiveCodeReply(c, ctx));
      assert.match(incoming.text, new RegExp(id));
      const before = await tx(c => appendReceiptEntryChoices(c, ctx, { text: "Synthetic menu" }));
      assert.match(before.text, /Пока нет активных/);
    }
    const code = await tx(c => generateHandoffCodeForPendingParty(c, {
      transferIdOrCode: id, pendingPartyId: recipient.partyId!, auditPartyId: recipient.partyId!, auditUserId: recipient.id,
    }));
    assert.equal(code.ok, true);
    if (!code.ok) throw new Error(code.message);
    const outcome = await tx(async c => {
      const r = (await c.query("SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE", [id])).rows[0];
      return verifyPendingReceiptCode(c, { row: r, code: code.code, actingPartyId: (await partyFor(sender.id)).id, auditUserId: sender.id });
    });
    assert.equal(outcome.ok, true);
    assert.equal((await row(id)).holder_party_id, recipient.partyId);
    for (const ctx of contexts) {
      const menu = await tx(c => appendReceiptEntryChoices(c, ctx, { text: "Synthetic menu" }));
      assert.doesNotMatch(menu.text, /Пока нет активных/);
      const buttons = JSON.stringify(menu.maxInlineButtons ?? menu.telegramInlineKeyboard);
      assert.match(buttons, new RegExp(id));
      const status = await tx(c => trackStatusReply(c, ctx, { action: "view", transferId: id }));
      assert.match(status.text, /Получение подтверждено/);
      assert.match(status.text, new RegExp(recipient.name));
      assert.doesNotMatch(status.text, /Personal receiving colleague/);
    }
    assert.equal((await pool().query("SELECT count(*)::int n FROM tanbot_max_accounts WHERE user_id=$1 AND max_user_id=$2",
      [recipient.id, String(messengerId)])).rows[0].n, 1);
  });
});
