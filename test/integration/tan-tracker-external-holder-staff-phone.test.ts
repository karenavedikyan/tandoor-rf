import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { withTransaction as tx } from "../../src/access/db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { signHolderAccess } from "../../src/tan-tracker/holder-access";
import { hashOtp } from "../../src/tan-tracker/phone-verification";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { verifyPendingReceiptCode } from "../../src/tan-tracker/verify-pending-receipt-code";
import { upsertVerifiedPerson } from "../../src/tan-tracker/external-person/person-service";
import { buildNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";
import {
  bumpDraftRevision, ensureNativeBotDraft, type NativeCreateDraftPayload,
} from "../../src/tanbot/native-create/draft-scope";
import {
  handleNativeCreateCallback, type NativeCreateContext,
} from "../../src/tanbot/native-create/engine";
import {
  createTestUser, getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv,
} from "../helpers/test-db";

const databaseUrl = getIntegrationDatabaseUrl();
const ORIGIN = "http://127.0.0.1:3000";
const ENDPOINT = "/api/tan-tracker/public/holder/pending/change";
let sequence = 0;
const phone = () => `+799955${String(++sequence).padStart(5, "0")}`;
const pool = () => getPool()!;
let app: ReturnType<typeof import("../../src/server").createApp>;
const originalFetch = globalThis.fetch;
const outbound: string[] = [];

async function employee(number = phone(), withParty = true, status = "active") {
  const name = `Synthetic Employee ${++sequence}`;
  const user = await createTestUser({
    databaseUrl, email: `holder-staff-${sequence}@test.invalid`, password: "SyntheticPass123!",
    fullName: name, role: "manager", phone: number, status,
  });
  const party = withParty ? await tx(c => ensurePartyForUserOnWrite(c, user.id, name, number)) : null;
  return { userId: user.id, partyId: party?.id ?? null, name, phone: number };
}

async function external(number = phone(), name = "Synthetic External") {
  return (await pool().query(
    `INSERT INTO tt_parties(kind, display_name, phone_e164) VALUES('external',$1,$2) RETURNING id`,
    [name, number],
  )).rows[0].id as string;
}

async function fixture(externalCreator = false) {
  const creator = await employee();
  const holderPhone = phone();
  const holder = await external(holderPhone, "Synthetic Holder");
  const final = await external();
  const creatorParty = externalCreator ? holder : creator.partyId!;
  const id = `staff-phone-${++sequence}`;
  await pool().query(
    `INSERT INTO tt_transfers
     (id,public_code,item_title,status,creator_party_id,holder_party_id,final_recipient_party_id,
      first_custody_at,handoff_version,row_version,from_external)
     VALUES($1,$2,'Synthetic agreement','active',$3,$4,$5,NOW(),4,6,$6)`,
    [id, `TEST-${sequence}`, creatorParty, holder, final, externalCreator],
  );
  await pool().query(
    `INSERT INTO tt_transfer_timeline(transfer_id,from_party_id,to_party_id,note)
     VALUES($1,$2,$3,'Synthetic existing history')`, [id, creatorParty, holder],
  );
  await pool().query(
    `INSERT INTO tt_transfer_attachments
     (transfer_id,storage_key,original_name,mime_type,byte_size,uploaded_by_user_id)
     VALUES($1,$2,'synthetic.txt','text/plain',10,$3)`, [id, `synthetic/${id}`, creator.userId],
  );
  return { id, creator, creatorParty, holder, holderPhone, final };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function state(f: Fixture) {
  return (await pool().query(`SELECT * FROM tt_transfers WHERE id=$1`, [f.id])).rows[0];
}
function token(f: Fixture, overrides: Partial<Parameters<typeof signHolderAccess>[0]> = {}) {
  return signHolderAccess({
    transferId: f.id, partyId: f.holder, hv: 4, exp: Date.now() + 60_000, ...overrides,
  });
}
function web(f: Fixture, body: object, access = token(f)) {
  return request(app).post(ENDPOINT).set("Origin", ORIGIN).send({ holderAccessToken: access, ...body });
}
async function assertPreserved(f: Fixture) {
  const row = await state(f);
  assert.equal(row.id, f.id);
  assert.equal(row.creator_party_id, f.creatorParty);
  assert.equal(row.holder_party_id, f.holder);
  assert.equal(row.final_recipient_party_id, f.final);
  assert.equal((await pool().query(
    `SELECT count(*)::int n FROM tt_transfer_attachments WHERE transfer_id=$1
     AND storage_key=$2 AND original_name='synthetic.txt'`, [f.id, `synthetic/${f.id}`],
  )).rows[0].n, 1);
  assert.equal((await pool().query(
    `SELECT count(*)::int n FROM tt_transfer_timeline WHERE transfer_id=$1
     AND note='Synthetic existing history'`, [f.id],
  )).rows[0].n, 1);
}
async function assertEmployeePending(f: Fixture, staff: Awaited<ReturnType<typeof employee>>) {
  const row = await state(f);
  const party = (await pool().query(`SELECT * FROM tt_parties WHERE user_id=$1`, [staff.userId])).rows[0];
  assert.equal(row.pending_party_id, party.id);
  assert.equal(party.kind, "user");
  assert.equal(party.display_name, staff.name);
  assert.equal(party.phone_e164, staff.phone);
  const user = (await pool().query(`SELECT full_name,phone FROM users WHERE id=$1`, [staff.userId])).rows[0];
  assert.equal(user.full_name, staff.name);
  assert.equal(user.phone, staff.phone);
  assert.equal(row.status, "waiting");
  assert.equal(row.handoff_version, 5);
  assert.equal(row.row_version, 7);
  assert.equal((await pool().query(
    `SELECT count(*)::int n FROM tt_parties WHERE kind='external' AND phone_e164=$1`, [staff.phone],
  )).rows[0].n, 0);
  await assertPreserved(f);
}
async function nativeDraft(f: Fixture, channel: "max" | "telegram", number: string) {
  const messengerId = BigInt(900000 + ++sequence);
  const person = await tx(c => upsertVerifiedPerson(c, {
    channel, messengerUserId: messengerId, messengerChatId: messengerId,
    phoneRaw: f.holderPhone, displayName: "Synthetic Holder", allowSelfRegistration: true,
  }));
  assert.equal(person.party_id, f.holder);
  const ctx: NativeCreateContext = {
    channel, messengerUserId: messengerId, messengerChatId: String(messengerId),
    isLinkedStaff: false, staffUserId: null, personId: person.id, privateDialogOk: true,
  };
  const callback = await tx(async c => {
    const draft = await ensureNativeBotDraft(c, {
      channel, messengerChatId: ctx.messengerChatId, actor: "external", personId: person.id, step: "summary",
    });
    const payload = await bumpDraftRevision(c, draft.id, "summary", {
      ...(draft.payload as NativeCreateDraftPayload),
      externalRecipientPhone: number, externalRecipientDisplayName: "Do not rename employee",
      // An untrusted draft UUID must not override the phone match.
      recipientPartyId: f.final,
      holderAction: {
        kind: "forward", transferId: f.id, publicCode: (await state(f)).public_code,
        handoffVersion: 4, rowVersion: 6,
      },
    });
    return buildNativeCreateCallback("confirm", draft.id, payload.revision)!;
  });
  return { ctx, callback, confirm: () => tx(c => handleNativeCreateCallback(c, ctx, callback)) };
}

describe("external current holder selects unrelated employee by phone", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    Object.assign(process.env, {
      TT_EXTERNAL_MESSENGER_ENABLED: "true",
      TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_DELIVERY_ENABLED: "false",
      TANBOT_TELEGRAM_BOT_TOKEN: "123456789:synthetic-holder-staff-test",
      TANBOT_TELEGRAM_BOT_USERNAME: "synthetic_holder_staff_bot",
      TANBOT_MAX_ENABLED: "true", TANBOT_MAX_DELIVERY_ENABLED: "false",
      TANBOT_MAX_BOT_TOKEN: "synthetic-holder-staff-test",
      TANBOT_MAX_BOT_USERNAME: "synthetic_holder_staff_bot",
    });
    globalThis.fetch = async input => {
      outbound.push(String(input));
      throw new Error("External network is forbidden in holder-staff regression tests");
    };
    await prepareDatabase(databaseUrl);
    await resetPoolForTests();
    app = (await import("../../src/server")).createApp();
  });
  after(async () => {
    globalThis.fetch = originalFetch;
    await closePool();
    assert.deepEqual(outbound, []);
  });

  for (const channel of ["max", "telegram"] as const) {
    it(`${channel}: confirms existing track to canonical employee, preserving custody until valid OTP`, async () => {
      const f = await fixture();
      const staff = await employee();
      const draft = await nativeDraft(f, channel, staff.phone);
      const reply = await draft.confirm();
      assert.ok(reply);
      assert.doesNotMatch(reply.text, /Не удалось|недоступ|устарел/iu);
      await assertEmployeePending(f, staff);
      const snapshot = await state(f);
      await draft.confirm();
      assert.deepEqual(await state(f), snapshot, "duplicate callback cannot repeat the mutation");

      await tx(async c => {
        const row = (await c.query(`SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE`, [f.id])).rows[0];
        const pepper = process.env.TT_OTP_PEPPER!;
        await c.query(
          `INSERT INTO tt_handoff_codes(transfer_id,handoff_version,pending_party_id,code_hash,expires_at)
           VALUES($1,5,$2,$3,NOW()+INTERVAL '5 minutes')`, [f.id, staff.partyId, hashOtp("654321", pepper)],
        );
        const incorrect = await verifyPendingReceiptCode(c, {
          row, code: "123456", auditUserId: null, actingPartyId: f.holder, pepper,
        });
        assert.equal(incorrect.ok, false);
      });
      await assertEmployeePending(f, staff);
      await tx(async c => {
        const row = (await c.query(`SELECT * FROM tt_transfers WHERE id=$1 FOR UPDATE`, [f.id])).rows[0];
        assert.deepEqual(await verifyPendingReceiptCode(c, {
          row, code: "654321", auditUserId: null, actingPartyId: f.holder,
        }), { ok: true });
      });
      const received = await state(f);
      assert.equal(received.holder_party_id, staff.partyId);
      assert.equal(received.pending_party_id, null);
      assert.equal(received.final_recipient_party_id, f.final);
      assert.equal(received.status, "active");
    });

    it(`${channel}: rejects inactive staff without changing the track or creating a shadow contact`, async () => {
      const f = await fixture();
      const staff = await employee(phone(), true, "disabled");
      const before = await state(f);
      const draft = await nativeDraft(f, channel, staff.phone);
      await draft.confirm();
      assert.deepEqual(await state(f), before);
      assert.equal((await pool().query(
        `SELECT count(*)::int n FROM tt_parties WHERE kind='external' AND phone_e164=$1`, [staff.phone],
      )).rows[0].n, 0);
      await assertPreserved(f);
    });

    it(`${channel}: rolls back the new staff party and entire handoff when invitation preparation fails`, async () => {
      const f = await fixture();
      const staff = await employee(phone(), false);
      const before = await state(f);
      const draft = await nativeDraft(f, channel, staff.phone);
      const enabled = process.env.TT_EXTERNAL_MESSENGER_ENABLED;
      try {
        process.env.TT_EXTERNAL_MESSENGER_ENABLED = "false";
        const reply = await draft.confirm();
        assert.match(reply!.text, /Не удалось/iu);
      } finally {
        process.env.TT_EXTERNAL_MESSENGER_ENABLED = enabled;
      }
      assert.deepEqual(await state(f), before);
      assert.equal((await pool().query(
        `SELECT count(*)::int n FROM tt_parties WHERE user_id=$1 OR phone_e164=$2`, [staff.userId, staff.phone],
      )).rows[0].n, 0);
      assert.equal((await pool().query(
        `SELECT count(*)::int n FROM tt_transfer_invitations WHERE transfer_id=$1`, [f.id],
      )).rows[0].n, 0);
      assert.equal((await pool().query(
        `SELECT count(*)::int n FROM tt_audit_log WHERE transfer_id=$1`, [f.id],
      )).rows[0].n, 0);
      await assertPreserved(f);
    });

    it(`${channel}: does not let a stale draft or different messenger choose the next recipient`, async () => {
      const f = await fixture();
      const staff = await employee(phone(), false);
      const draft = await nativeDraft(f, channel, staff.phone);
      const before = await state(f);
      await tx(c => handleNativeCreateCallback(c, {
        ...draft.ctx, messengerUserId: draft.ctx.messengerUserId + 1n,
      }, draft.callback));
      assert.deepEqual(await state(f), before);
      await pool().query(`UPDATE tt_transfers SET row_version=row_version+1 WHERE id=$1`, [f.id]);
      const changed = await state(f);
      await draft.confirm();
      assert.deepEqual(await state(f), changed);
      assert.equal((await pool().query(
        `SELECT count(*)::int n FROM tt_parties WHERE user_id=$1`, [staff.userId],
      )).rows[0].n, 0);
      await assertPreserved(f);
    });
  }

  for (const externalCreator of [false, true]) {
    it(`public holder: selects unrelated staff by phone, external creator=${externalCreator}`, async () => {
      const f = await fixture(externalCreator);
      const staff = await employee();
      const response = await web(f, { external: { name: "Do not rename employee", phone: staff.phone } });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      await assertEmployeePending(f, staff);
    });
  }

  it("public holder: creates a canonical party for an active employee who has never used tracks", async () => {
    const f = await fixture();
    const staff = await employee(phone(), false);
    const response = await web(f, { external: { name: "Do not rename employee", phone: staff.phone } });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    await assertEmployeePending(f, staff);
  });

  for (const conflict of ["inactive", "ambiguous", "stale-alias"] as const) {
    it(`public holder: rejects ${conflict} employee phone without a shadow external party`, async () => {
      const f = await fixture();
      const number = phone();
      const staff = await employee(number, true, conflict === "inactive" ? "disabled" : "active");
      if (conflict === "ambiguous") await employee(number);
      if (conflict === "stale-alias") {
        await pool().query(`UPDATE users SET phone=$2 WHERE id=$1`, [staff.userId, phone()]);
      }
      const before = await state(f);
      const response = await web(f, { external: { name: "Synthetic recipient", phone: number } });
      assert.equal(response.status, 403, JSON.stringify(response.body));
      assert.deepEqual(await state(f), before);
      assert.equal((await pool().query(
        `SELECT count(*)::int n FROM tt_parties WHERE kind='external' AND phone_e164=$1`, [number],
      )).rows[0].n, 0);
      await assertPreserved(f);
    });
  }

  it("public holder: still denies unrelated employee UUIDs, self-transfer and invalid numbers", async () => {
    const f = await fixture();
    const staff = await employee();
    const before = await state(f);
    assert.equal((await web(f, { pendingPartyId: staff.partyId })).status, 403);
    assert.equal((await web(f, { external: { name: "Synthetic self", phone: f.holderPhone } })).status, 400);
    assert.equal((await web(f, { external: { name: "Synthetic invalid", phone: "123" } })).status, 400);
    assert.deepEqual(await state(f), before);
  });

  it("public holder: rejects expired, stale-version, wrong-holder and unsigned tokens before phone resolution", async () => {
    const f = await fixture();
    const number = phone();
    const before = await state(f);
    for (const access of [
      token(f, { exp: Date.now() - 1_000 }), token(f, { hv: 3 }),
      token(f, { partyId: f.final }), "invalid.synthetic",
    ]) {
      const response = await web(f, { external: { name: "Synthetic unknown", phone: number } }, access);
      assert.ok([403, 404].includes(response.status), JSON.stringify(response.body));
    }
    assert.deepEqual(await state(f), before);
    assert.equal((await pool().query(
      `SELECT count(*)::int n FROM tt_parties WHERE phone_e164=$1`, [number],
    )).rows[0].n, 0);
  });

  it("public holder: preserves staff creator provenance for new external recipients", async () => {
    const f = await fixture();
    const number = phone();
    const response = await web(f, { external: { name: "Synthetic new external", phone: number } });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const party = (await pool().query(`SELECT * FROM tt_parties WHERE id=$1`, [(await state(f)).pending_party_id])).rows[0];
    assert.equal(party.kind, "external");
    assert.equal(party.created_by_user_id, f.creator.userId);
    await assertPreserved(f);
  });
});
