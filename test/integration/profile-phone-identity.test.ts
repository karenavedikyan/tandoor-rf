import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { withTransaction as tx } from "../../src/access/db";
import { loadAccessContext } from "../../src/access/context";
import { createTransferInTransaction } from "../../src/tan-tracker/create-transfer-service";
import { buildTanTrackerBootstrap } from "../../src/tan-tracker/service";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { findStaffRecipientByPhone } from "../../src/tan-tracker/staff-phone-recipient";
import { resolveNativeExternalPendingPartyByPhone } from "../../src/tanbot/native-create/native-external-recipient-by-phone";
import { linkStaffByVerifiedContact } from "../../src/tanbot/verified-contact-staff-link";
import { mintExternalMessengerSession } from "../../src/tan-tracker/external-messenger/session-service";
import {
  handleExternalRecipientStart, handleExternalRecipientTelegramContact, handleExternalRecipientMaxContact,
} from "../../src/tanbot/external-recipient/bot-flow";
import { searchStaffRecipientHits } from "../../src/tanbot/native-create/recipient-unified";
import { createSession } from "../../src/auth/session";
import { SESSION_COOKIE_NAME } from "../../src/config";

const db = getIntegrationDatabaseUrl(), origin = "http://127.0.0.1:3000";
const pool = () => getPool()!;
let seq = 0;
const number = () => `+799933${String(++seq).padStart(5, "0")}`;
let app: ReturnType<typeof import("../../src/server").createApp>;
const originalFetch = globalThis.fetch;
let network = 0;
async function employee(phone: string | null = number()) {
  const email = `profile-phones-${++seq}@test.invalid`, fullName = `Synthetic employee ${seq}`;
  const u = await createTestUser({ databaseUrl: db, email, fullName, phone, role: "manager", password: "SyntheticPass123!" });
  // Synthetic fixture sessions avoid exhausting the shared login-IP rate limit.
  const { token } = await createSession(u.id);
  const cookie = `${SESSION_COOKIE_NAME}=${token}`;
  return { id: u.id, cookie };
}
type Employee = Awaited<ReturnType<typeof employee>>;
async function profile(user: Employee) {
  const r = await request(app).get("/api/profile/self").set("Cookie", user.cookie);
  assert.equal(r.status, 200); return r.body.user;
}
function patch(user: Employee, body: object) {
  return request(app).patch("/api/profile/self").set("Cookie", user.cookie).set("Origin", origin).send(body);
}
async function create(user: Employee, phone: string) {
  const actor = await profile(user), access = await loadAccessContext(user.id);
  return tx(c => createTransferInTransaction(c, { user: actor, access }, {
    item: "Synthetic profile phone transfer", finalRecipientExternal: { name: "My private recipient", phone },
  }));
}
async function transfer(id: string) {
  return (await pool().query("SELECT * FROM tt_transfers WHERE id=$1", [id])).rows[0];
}
async function bootstrap(user: Employee) {
  return buildTanTrackerBootstrap(await profile(user), await loadAccessContext(user.id));
}

describe("profile phone identity: primary + additional, future transfers only", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(db, origin);
    Object.assign(process.env, {
      TT_EXTERNAL_MESSENGER_ENABLED: "true", TANBOT_HANDOFF_CODE_PILOT_ENABLED: "true",
      TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true", TANBOT_MAX_DELIVERY_ENABLED: "false",
      TANBOT_MAX_BOT_TOKEN: "synthetic-profile-max-token", TANBOT_MAX_BOT_USERNAME: "synthetic_profile_bot",
      TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-profile-max-pepper",
      TANBOT_MAX_WEBHOOK_SECRET: "synthetic-profile-max-secret",
      TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true", TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
      TANBOT_TELEGRAM_BOT_TOKEN: "123456789:synthetic-profile-telegram-token",
      TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_profile_bot",
      TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-profile-telegram-pepper",
      TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-profile-telegram-secret",
    });
    await prepareDatabase(db); await resetPoolForTests();
    app = (await import("../../src/server")).createApp();
    globalThis.fetch = async () => { network++; throw new Error("No real messages or HTTP in profile phone QA"); };
  });
  after(async () => { globalThis.fetch = originalFetch; await closePool(); assert.equal(network, 0); });

  it("saves, normalizes, reloads and clears an additional phone without replacing the working number", async () => {
    const primary = number(), extra = number(), user = await employee(primary);
    assert.equal((await profile(user)).additionalPhone, null);
    const r = await patch(user, { additionalPhone: `8 (${extra.slice(2, 5)}) ${extra.slice(5)}` });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.user.additionalPhone, extra);
    assert.equal((await profile(user)).phone, primary);
    assert.equal((await profile(user)).additionalPhone, extra);
    assert.equal((await patch(user, { additionalPhone: "" })).status, 200);
    assert.equal((await profile(user)).additionalPhone, null);
    assert.equal((await profile(user)).phone, primary);
  });

  it("rejects invalid, repeated and cross-profile numbers atomically, without revealing another profile", async () => {
    const a = await employee(), b = await employee(), extra = number();
    assert.equal((await patch(a, { additionalPhone: extra })).status, 200);
    const before = await profile(b);
    for (const [body, status] of [
      [{ additionalPhone: "123" }, 400], [{ additionalPhone: before.phone }, 400],
      [{ additionalPhone: (await profile(a)).phone }, 409], [{ additionalPhone: extra }, 409],
      [{ phone: extra }, 409], [{ role: "admin", additionalPhone: number() }, 400],
    ] as const) {
      const r = await patch(b, { fullName: "Must not be saved", ...body });
      assert.equal(r.status, status, JSON.stringify(r.body));
      assert.doesNotMatch(JSON.stringify(r.body), new RegExp(a.id));
      assert.deepEqual(await profile(b), before);
    }
    assert.equal((await request(app).patch("/api/profile/self").set("Origin", origin)
      .send({ additionalPhone: number() })).status, 401);
  });

  it("serializes simultaneous claims of the same additional phone", async () => {
    const a = await employee(), b = await employee(), extra = number();
    const results = await Promise.all([patch(a, { additionalPhone: extra }), patch(b, { additionalPhone: extra })]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal((await pool().query("SELECT count(*)::int n FROM users WHERE additional_phone=$1", [extra])).rows[0].n, 1);
  });

  it("routes both numbers to the same employee and keeps unrelated staff out of their tracks", async () => {
    const sender = await employee(), recipient = await employee(), outsider = await employee(), extra = number();
    assert.equal((await patch(recipient, { additionalPhone: extra })).status, 200);
    const primary = (await profile(recipient)).phone;
    const first = await create(sender, primary), second = await create(sender, extra);
    const a = await transfer(first), b = await transfer(second);
    assert.equal(a.pending_party_id, b.pending_party_id);
    const party = (await pool().query("SELECT * FROM tt_parties WHERE id=$1", [a.pending_party_id])).rows[0];
    assert.equal(party.user_id, recipient.id); assert.equal(party.phone_e164, primary);
    const theirs = await bootstrap(recipient), unrelated = await bootstrap(outsider);
    for (const id of [first, second]) {
      assert.ok(theirs.orders.some(o => o.id === id)); assert.ok(!unrelated.orders.some(o => o.id === id));
    }
    assert.equal((await pool().query("SELECT count(*)::int n FROM tt_parties WHERE kind='external' AND phone_e164=$1", [extra])).rows[0].n, 0);
  });

  it("uses additional phone when the primary is empty and materializes a valid staff party", async () => {
    const sender = await employee(), recipient = await employee(null), extra = number();
    assert.equal((await patch(recipient, { additionalPhone: extra })).status, 200);
    const id = await create(sender, extra);
    const party = (await pool().query("SELECT * FROM tt_parties WHERE id=$1", [(await transfer(id)).pending_party_id])).rows[0];
    assert.equal(party.user_id, recipient.id); assert.equal(party.phone_e164, extra);
  });

  it("never grants historical external tracks when a phone is later added to a profile; saved contacts route only the new assignment", async () => {
    const sender = await employee(), recipient = await employee(), extra = number();
    const old = await create(sender, extra), before = await transfer(old), externalId = before.pending_party_id;
    assert.equal((await patch(recipient, { additionalPhone: extra })).status, 200);
    const next = await create(sender, extra);
    const actor = await profile(sender), access = await loadAccessContext(sender.id);
    const saved = await tx(c => createTransferInTransaction(c, { user: actor, access }, {
      item: "Synthetic saved contact", finalRecipientPartyId: externalId,
    }));
    assert.equal((await transfer(next)).pending_party_id, (await transfer(saved)).pending_party_id);
    assert.notEqual((await transfer(next)).pending_party_id, externalId);
    assert.deepEqual(await transfer(old), before);
    const theirs = await bootstrap(recipient);
    assert.ok(!theirs.orders.some(o => o.id === old));
    assert.ok(theirs.orders.some(o => o.id === next));
    const own = await bootstrap(sender);
    assert.equal(own.contacts.find(c => c.id === (theirs.orders.find(o => o.id === saved)!.finalRecipientId))?.name,
      "My private recipient");
  });

  it("clearing an additional phone changes only future classification, not existing staff participation", async () => {
    const sender = await employee(), recipient = await employee(), extra = number();
    assert.equal((await patch(recipient, { additionalPhone: extra })).status, 200);
    const old = await create(sender, extra), before = await transfer(old);
    assert.equal((await patch(recipient, { additionalPhone: null })).status, 200);
    const next = await create(sender, extra);
    assert.notEqual((await transfer(next)).pending_party_id, before.pending_party_id);
    assert.deepEqual(await transfer(old), before);
    const theirs = await bootstrap(recipient);
    assert.ok(theirs.orders.some(o => o.id === old)); assert.ok(!theirs.orders.some(o => o.id === next));
  });

  it("ignores another employee's stale party alias and honors the current additional profile number", async () => {
    const sender = await employee(), stale = await employee(), recipient = await employee(), extra = number();
    await tx(c => ensurePartyForUserOnWrite(c, stale.id, "Synthetic historical", extra));
    assert.equal((await patch(recipient, { additionalPhone: extra })).status, 200);
    assert.equal((await tx(c => findStaffRecipientByPhone(c, extra)))?.id, recipient.id);
    const id = await create(sender, extra);
    assert.equal((await pool().query("SELECT user_id FROM tt_parties WHERE id=$1", [(await transfer(id)).pending_party_id])).rows[0].user_id, recipient.id);
  });

  for (const conflict of ["duplicate", "inactive", "excluded-role"] as const) {
    it(`rejects an additional phone with ${conflict} profile identity without an external shadow`, async () => {
      const sender = await employee(), recipient = await employee(), extra = number();
      assert.equal((await patch(recipient, { additionalPhone: extra })).status, 200);
      if (conflict === "duplicate") {
        await employee(extra); // Simulate legacy/admin data outside the guarded self-profile API.
      } else {
        await pool().query(conflict === "inactive" ? "UPDATE users SET status='disabled' WHERE id=$1"
          : "UPDATE users SET role='analyst' WHERE id=$1", [recipient.id]);
      }
      await assert.rejects(create(sender, extra));
      assert.equal((await pool().query(`SELECT count(*)::int n FROM tt_parties
        WHERE kind='external' AND phone_e164=$1`, [extra])).rows[0].n, 0);
    });
  }

  for (const channel of ["max", "telegram"] as const) {
    it(`${channel}: resolves additional phone identically for external native senders and staff search`, async () => {
      const recipient = await employee(), extra = number(), actorPhone = number();
      assert.equal((await patch(recipient, { additionalPhone: extra })).status, 200);
      const party = (await pool().query(`INSERT INTO tt_parties(kind,display_name,phone_e164)
        VALUES('external','Synthetic external',$1) RETURNING id`, [actorPhone])).rows[0];
      const resolution = await tx(c => resolveNativeExternalPendingPartyByPhone(c, {
        senderExternalPartyId: party.id, phoneE164: extra, externalRecipient: { name: "Private name", phone: extra },
      }));
      assert.equal(resolution.recipientKind, "staff");
      const admin = await employee();
      await pool().query("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
      const hits = await tx(c => searchStaffRecipientHits(c, admin.id, extra));
      assert.ok(hits.some(hit => hit.ref === resolution.pendingPartyId));
    });

    it(`${channel}: a verified own additional contact links the exact staff account, not a new external person`, async () => {
      const recipient = await employee(), extra = number(), messenger = BigInt(820000 + ++seq);
      assert.equal((await patch(recipient, { additionalPhone: extra })).status, 200);
      const linked = await tx(c => linkStaffByVerifiedContact(c, {
        channel, phoneRaw: extra, messengerUserId: messenger, messengerChatId: messenger,
      }));
      assert.deepEqual(linked, { kind: "staff", userId: recipient.id });
      const rejected = await tx(c => linkStaffByVerifiedContact(c, {
        channel, phoneRaw: extra, messengerUserId: messenger + 1n, messengerChatId: messenger + 1n,
      }));
      assert.equal(rejected.kind, "rejected");
      assert.equal((await pool().query(`SELECT user_id FROM tanbot_${channel}_accounts
        WHERE ${channel}_user_id=$1`, [String(messenger)])).rows[0].user_id, recipient.id);
    });

    it(`${channel}: own additional contact obtains a code for the same employee; unrelated and foreign contacts cannot`, async () => {
      const sender = await employee(), recipient = await employee(), extra = number();
      assert.equal((await patch(recipient, { additionalPhone: extra })).status, 200);
      const id = await create(sender, (await profile(recipient)).phone);
      const row = await transfer(id), messenger = BigInt(830000 + ++seq);
      await pool().query(`INSERT INTO tanbot_${channel}_accounts(user_id,${channel}_user_id,${channel}_chat_id)
        VALUES($1,$2,$2)`, [recipient.id, String(messenger)]);
      const session = await tx(c => mintExternalMessengerSession(c, {
        transferId: id, pendingPartyId: row.pending_party_id, handoffVersion: row.handoff_version, allowUserParty: true,
      }));
      assert.ok(session);
      const start = await tx(c => handleExternalRecipientStart(c, {
        channel, startPayload: session.startToken, chatId: messenger, messengerUserId: messenger,
      }));
      assert.equal(start?.requestContact, true);
      const contact = async (phone: string, own = true) => tx(c => {
        if (channel === "telegram") return handleExternalRecipientTelegramContact(c, {
          telegramChatId: messenger, telegramUserId: messenger, contactUserId: Number(own ? messenger : messenger + 1n),
          phoneRaw: phone, isForwarded: false,
        });
        const vcf = `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Synthetic\r\nTEL:${phone}\r\nEND:VCARD\r\n`;
        return handleExternalRecipientMaxContact(c, {
          maxChatId: messenger, maxUserId: messenger, isForwarded: false,
          contact: { vcfInfo: vcf, contactHash: createHmac("sha256", process.env.TANBOT_MAX_BOT_TOKEN!).update(vcf).digest("hex"),
            contactUserId: Number(own ? messenger : messenger + 1n) },
        });
      });
      assert.ok(!(await contact(number()))?.copyOnlyCode);
      assert.ok(!(await contact(extra, false))?.copyOnlyCode);
      const issued = await contact(extra);
      assert.ok(issued?.copyOnlyCode, JSON.stringify(issued));
      assert.equal((await transfer(id)).holder_party_id, row.holder_party_id);
    });
  }
});
