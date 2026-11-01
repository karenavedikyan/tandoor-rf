import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { closePool, getPool, resetPoolForTests } from "../../src/db/pool";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { TT_PERSONAL_RECIPIENT_LABEL_SET } from "../../src/tan-tracker/personal-recipient-label";
import { createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";
import { withTransaction } from "../../src/access/db";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";
const databaseUrl = getIntegrationDatabaseUrl();

function headers(cookie?: string, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json", ...extra };
  if (cookie) h.Cookie = cookie;
  return h;
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(email: string, app: Awaited<ReturnType<typeof loadApp>>) {
  const res = await request(app).post("/api/auth/login").set(headers()).send({ email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

async function createTransferWithExternalRecipient(
  app: Awaited<ReturnType<typeof loadApp>>,
  cookie: string,
  phone: string,
  personalName?: string,
) {
  const body: Record<string, unknown> = {
    item: "Personal label integration item",
    finalRecipientExternal: { name: "Canonical External Name", phone },
  };
  if (personalName) body.finalRecipientPersonalName = personalName;
  const create = await request(app).post("/api/tan-tracker/transfers").set(headers(cookie)).send(body);
  return create;
}

describe("tan-tracker personal recipient labels", { concurrency: false }, () => {
  let adminACookie = "";
  let adminBCookie = "";
  let managerCookie = "";
  let foreignCookie = "";
  let managerUserId = "";

  before(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "tt-prl-admin-a@test.local",
      password: PASSWORD,
      fullName: "Admin A",
      role: "admin",
    });
    await createTestUser({
      databaseUrl,
      email: "tt-prl-admin-b@test.local",
      password: PASSWORD,
      fullName: "Admin B",
      role: "admin",
    });
    const mgr = await createTestUser({
      databaseUrl,
      email: "tt-prl-mgr@test.local",
      password: PASSWORD,
      fullName: "Manager Owner",
      role: "manager",
    });
    managerUserId = mgr.id;
    await createTestUser({
      databaseUrl,
      email: "tt-prl-foreign@test.local",
      password: PASSWORD,
      fullName: "Foreign Manager",
      role: "manager",
    });
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    try {
      await ensurePartyForUserOnWrite(client, mgr.id, "Manager Owner", "+79991112201");
    } finally {
      client.release();
    }
    const app = await loadApp();
    adminACookie = await login("tt-prl-admin-a@test.local", app);
    adminBCookie = await login("tt-prl-admin-b@test.local", app);
    managerCookie = await login("tt-prl-mgr@test.local", app);
    foreignCookie = await login("tt-prl-foreign@test.local", app);
  });

  after(async () => {
    await closePool();
  });

  it("two authorized viewers store independent labels; third sees canonical", async () => {
    const app = await loadApp();
    const phone = "+79997776655";
    const create = await createTransferWithExternalRecipient(app, managerCookie, phone);
    assert.equal(create.status, 201, create.text);
    const transferId = create.body.publicCode as string;
    const pending =
      create.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId)?.pendingId ??
      create.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId)?.finalRecipientId;
    assert.ok(pending);

    const setA = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/personal-recipient-label`)
      .set(headers(adminACookie))
      .send({ recipientPartyId: pending, personalName: "Alias Admin A" });
    assert.equal(setA.status, 200, setA.text);

    const setB = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/personal-recipient-label`)
      .set(headers(adminBCookie))
      .send({ recipientPartyId: pending, personalName: "Alias Admin B" });
    assert.equal(setB.status, 200, setB.text);

    const bootA = await request(app).get("/api/tan-tracker/bootstrap").set(headers(adminACookie));
    const bootB = await request(app).get("/api/tan-tracker/bootstrap").set(headers(adminBCookie));
    const orderA = bootA.body.orders.find((o: { id: string }) => o.id === transferId);
    const orderB = bootB.body.orders.find((o: { id: string }) => o.id === transferId);
    assert.equal(orderA.personalRecipientViews[pending].personalName, "Alias Admin A");
    assert.equal(orderB.personalRecipientViews[pending].personalName, "Alias Admin B");

    const bootMgr = await request(app).get("/api/tan-tracker/bootstrap").set(headers(managerCookie));
    const orderMgr = bootMgr.body.orders.find((o: { id: string }) => o.id === transferId);
    assert.equal(orderMgr.personalRecipientViews?.[pending]?.personalName, undefined);
  });

  it("isolates labels per transfer for same external phone", async () => {
    const app = await loadApp();
    const phone = "+79997776656";
    const c1 = await createTransferWithExternalRecipient(app, managerCookie, phone, "Track One Alias");
    const c2 = await createTransferWithExternalRecipient(app, managerCookie, phone, "Track Two Alias");
    assert.equal(c1.status, 201);
    assert.equal(c2.status, 201);
    const id1 = c1.body.publicCode as string;
    const id2 = c2.body.publicCode as string;
    const p1 = c1.body.bootstrap.orders.find((o: { id: string }) => o.id === id1).pendingId;
    const boot = await request(app).get("/api/tan-tracker/bootstrap").set(headers(managerCookie));
    const o1 = boot.body.orders.find((o: { id: string }) => o.id === id1);
    const o2 = boot.body.orders.find((o: { id: string }) => o.id === id2);
    assert.equal(o1.personalRecipientViews[p1].personalName, "Track One Alias");
    assert.notEqual(o2.personalRecipientViews[p1]?.personalName, "Track One Alias");
  });

  it("rejects foreign actor, invalid types, and preserves party display_name", async () => {
    const app = await loadApp();
    const create = await createTransferWithExternalRecipient(app, managerCookie, "+79997776657");
    assert.equal(create.status, 201);
    const transferId = create.body.publicCode as string;
    const pending = create.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId).pendingId;

    const foreign = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/personal-recipient-label`)
      .set(headers(foreignCookie))
      .send({ recipientPartyId: pending, personalName: "Nope" });
    assert.equal(foreign.status, 403);

    const badType = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/personal-recipient-label`)
      .set(headers(adminACookie))
      .send({ recipientPartyId: pending, personalName: { x: 1 } });
    assert.equal(badType.status, 400);

    const badCreate = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(managerCookie))
      .send({
        item: "bad personal type",
        finalRecipientExternal: { name: "Canon", phone: "+79997776658" },
        finalRecipientPersonalName: 123,
      });
    assert.equal(badCreate.status, 400);

    const pool = getPool();
    assert.ok(pool);
    const partyName = (
      await pool.query(`SELECT display_name FROM tt_parties WHERE id = $1::uuid`, [pending])
    ).rows[0].display_name;
    assert.equal(partyName, "Canonical External Name");
  });

  it("keeps owner personal label when labeled party becomes holder", async () => {
    const app = await loadApp();
    const create = await createTransferWithExternalRecipient(
      app,
      managerCookie,
      "+79997776659",
      "После получения ярлык",
    );
    assert.equal(create.status, 201, create.text);
    const transferId = create.body.publicCode as string;
    const order0 = create.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId);
    const recipientPartyId = order0.pendingId;
    assert.ok(recipientPartyId);

    const pool = getPool();
    assert.ok(pool);
    await pool.query(
      `UPDATE tt_transfers
       SET holder_party_id = pending_party_id, pending_party_id = NULL, status = 'delivered'
       WHERE id = $1`,
      [transferId],
    );

    const bootOwner = await request(app).get("/api/tan-tracker/bootstrap").set(headers(managerCookie));
    const after = bootOwner.body.orders.find((o: { id: string }) => o.id === transferId);
    assert.equal(after.holderId, recipientPartyId);
    assert.equal(after.personalRecipientViews[recipientPartyId].personalName, "После получения ярлык");
  });

  it("external shell POST uses est session (no staff cookie) and returns bootstrap views", async () => {
    const app = await loadApp();
    const pool = getPool();
    assert.ok(pool);
    const staff = await ensurePartyForUserOnWrite(pool, managerUserId, "Manager Owner", "+79991112201");
    const extPartyId = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Ext Shell Creator', '+79997770001') RETURNING id::text`,
      )
    ).rows[0]!.id;
    const personId = randomUUID();
    await pool.query(
      `INSERT INTO tt_external_persons (id, party_id, display_name, phone_e164, access_epoch)
       VALUES ($1::uuid, $2::uuid, 'Ext Shell Creator', '+79997770001', 1)`,
      [personId, extPartyId],
    );
    const publicCode = `TT-PRL-EXT-${randomUUID().slice(0, 8)}`;
    await pool.query(
      `INSERT INTO tt_transfers (
         id, public_code, item_title, status, from_external,
         creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version
       ) VALUES ($1,$2,'Ext shell personal','waiting',TRUE,$3,$3,$4,$4,1)`,
      [publicCode, publicCode, extPartyId, staff.id],
    );
    const est = await withTransaction((client) => createPersonBrowserSession(client, personId, "telegram"));
    const saved = await request(app)
      .post(`/api/tan-tracker/public/external/transfers/${encodeURIComponent(publicCode)}/personal-recipient-label`)
      .set(headers(undefined, { "x-tt-external-est": est }))
      .send({ recipientPartyId: staff.id, personalName: "Staff alias from ext shell" });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.body.bootstrap.externalPerson, true);
    const order = saved.body.bootstrap.orders.find((o: { id: string }) => o.id === publicCode);
    assert.equal(order.personalRecipientViews[staff.id].personalName, "Staff alias from ext shell");
    const staffAttempt = await request(app)
      .post(`/api/tan-tracker/public/external/transfers/${encodeURIComponent(publicCode)}/personal-recipient-label`)
      .set(headers(managerCookie))
      .send({ recipientPartyId: staff.id, personalName: "Wrong path" });
    assert.equal(staffAttempt.status, 403, staffAttempt.text);
  });

  it("denies personal label POST in read-only employee preview", async () => {
    const app = await loadApp();
    const create = await createTransferWithExternalRecipient(app, managerCookie, "+79997776660");
    assert.equal(create.status, 201);
    const transferId = create.body.publicCode as string;
    const pending = create.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId).pendingId;
    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set(headers(adminACookie))
      .send({ userId: managerUserId });
    assert.equal(start.status, 200, start.text);
    const previewCookies =
      start.headers["set-cookie"]?.map((c) => c.split(";")[0]).join("; ") ?? adminACookie;
    const denied = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/personal-recipient-label`)
      .set(headers(previewCookies))
      .send({ recipientPartyId: pending, personalName: "Preview blocked" });
    assert.equal(denied.status, 403, denied.text);
    await request(app).post("/api/admin/access/preview/stop").set(headers(previewCookies)).send({});
  });

  it("stores server editor display name; ignores spoofed client metadata", async () => {
    const app = await loadApp();
    const create = await createTransferWithExternalRecipient(app, managerCookie, "+79997776661");
    assert.equal(create.status, 201);
    const transferId = create.body.publicCode as string;
    const pending = create.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId).pendingId;
    const set = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/personal-recipient-label`)
      .set(headers(adminACookie))
      .send({
        recipientPartyId: pending,
        personalName: "Audit name check",
        editorDisplayName: "Evil Spoof Name",
        editorUserId: "00000000-0000-0000-0000-000000000099",
      });
    assert.equal(set.status, 200, set.text);
    const pool = getPool();
    assert.ok(pool);
    const adminParty = (
      await pool.query<{ id: string }>(
        `SELECT id::text FROM tt_parties WHERE user_id = (SELECT id FROM users WHERE email = 'tt-prl-admin-a@test.local')`,
      )
    ).rows[0]!.id;
    const audit = await pool.query<{ detail: { editorDisplayName?: string; editorUserId?: string } }>(
      `SELECT detail FROM tt_audit_log
       WHERE transfer_id = $1 AND action = $2 AND acting_party_id = $3::uuid
       ORDER BY created_at DESC LIMIT 1`,
      [transferId, TT_PERSONAL_RECIPIENT_LABEL_SET, adminParty],
    );
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].detail.editorDisplayName, "Admin A");
    assert.notEqual(audit.rows[0].detail.editorUserId, "00000000-0000-0000-0000-000000000099");
  });

  it("concurrent label writes resolve to a single latest audit row per owner", async () => {
    const app = await loadApp();
    const create = await createTransferWithExternalRecipient(app, managerCookie, "+79997776662");
    assert.equal(create.status, 201);
    const transferId = create.body.publicCode as string;
    const pending = create.body.bootstrap.orders.find((o: { id: string }) => o.id === transferId).pendingId;
    await Promise.all([
      request(app)
        .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/personal-recipient-label`)
        .set(headers(adminACookie))
        .send({ recipientPartyId: pending, personalName: "Concurrent A" }),
      request(app)
        .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/personal-recipient-label`)
        .set(headers(adminACookie))
        .send({ recipientPartyId: pending, personalName: "Concurrent B" }),
    ]);
    const pool = getPool();
    assert.ok(pool);
    const adminParty = (
      await pool.query(
        `SELECT p.id::text FROM tt_parties p JOIN users u ON u.id = p.user_id WHERE u.email = 'tt-prl-admin-a@test.local'`,
      )
    ).rows[0]?.id;
    const rows = await pool.query<{ detail: { personalName: string } }>(
      `SELECT detail FROM tt_audit_log
       WHERE transfer_id = $1 AND action = $2 AND acting_party_id = $3::uuid
       ORDER BY created_at DESC, id DESC LIMIT 2`,
      [transferId, TT_PERSONAL_RECIPIENT_LABEL_SET, adminParty],
    );
    assert.equal(rows.rowCount, 2);
    const boot = await request(app).get("/api/tan-tracker/bootstrap").set(headers(adminACookie));
    const view = boot.body.orders.find((o: { id: string }) => o.id === transferId).personalRecipientViews[pending]
      .personalName;
    assert.ok(view === "Concurrent A" || view === "Concurrent B");
    assert.equal(view, rows.rows[0].detail.personalName);
  });

  it("public recipient messenger payload omits private personal labels", async () => {
    const app = await loadApp();
    const privateName = "Secret bootstrap alias";
    const create = await createTransferWithExternalRecipient(app, managerCookie, "+79997776663", privateName);
    assert.equal(create.status, 201, create.text);
    const transferId = create.body.publicCode as string;
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    const invite = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferId)}/messenger-invite`)
      .set(headers(managerCookie))
      .send({});
    assert.equal(invite.status, 201, invite.text);
    const pub = await request(app)
      .get("/api/tan-tracker/public/recipient/messenger")
      .query({ mst: invite.body.startToken });
    assert.equal(pub.status, 200, pub.text);
    const serialized = JSON.stringify(pub.body);
    assert.doesNotMatch(serialized, new RegExp(privateName));
    assert.match(serialized, /Canonical External Name/);
  });
});
