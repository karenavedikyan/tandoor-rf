import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import request from "supertest";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { closePool, resetPoolForTests } from "../../src/db/pool";

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "StrongPass123!";

function headers(cookie?: string): Record<string, string> {
  const h: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json" };
  if (cookie) h.Cookie = cookie;
  return h;
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

async function login(app: Awaited<ReturnType<typeof loadApp>>, email: string) {
  const res = await request(app).post("/api/auth/login").set(headers()).send({ email, password: PASSWORD });
  assert.equal(res.status, 200, res.text);
  return res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

describe("external messenger invite authority (PG)", { concurrency: false }, () => {
  let transferCode = "";
  let holderCookie = "";
  let wrongHolderCookie = "";
  let adminCookie = "";
  let wrongHolderUserId = "";

  before(async () => {
    const databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    Object.assign(process.env, {
      TANBOT_TELEGRAM_ENABLED: "true", TANBOT_TELEGRAM_WEBHOOK_ENABLED: "true",
      TANBOT_TELEGRAM_BOT_TOKEN: "123456:synthetic-token-not-real-123456789",
      TANBOT_TELEGRAM_WEBHOOK_SECRET: "synthetic-secret-min16", TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "synthetic-pepper-min16",
      TANBOT_MAX_ENABLED: "true", TANBOT_MAX_WEBHOOK_ENABLED: "true",
      TANBOT_MAX_BOT_TOKEN: "synthetic-max-token", TANBOT_MAX_WEBHOOK_SECRET: "synthetic-secret-min16",
      TANBOT_MAX_LINK_TOKEN_PEPPER: "synthetic-pepper-min16",
    });
    await prepareDatabase(databaseUrl);
    await createTestUser({
      databaseUrl,
      email: "inv-hold@test.local",
      password: PASSWORD,
      fullName: "Invite Holder",
      role: "admin",
    });
    wrongHolderUserId = (
      await createTestUser({
      databaseUrl,
      email: "inv-wrong@test.local",
      password: PASSWORD,
      fullName: "Wrong Holder",
      role: "manager",
    })
    ).id;
    const emp = randomUUID();
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await pool.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, 'Wrong Holder', 'Manager', '{}')`,
        [emp],
      );
      await linkUserToEmployee({
        databaseUrl,
        userId: wrongHolderUserId,
        employeeId: emp,
        confirmedByUserId: wrongHolderUserId,
      });
    } finally {
      await pool.end();
    }
    await createTestUser({
      databaseUrl,
      email: "inv-admin@test.local",
      password: PASSWORD,
      fullName: "Other Admin",
      role: "admin",
    });

    const app = await loadApp();
    holderCookie = await login(app, "inv-hold@test.local");
    wrongHolderCookie = await login(app, "inv-wrong@test.local");
    adminCookie = await login(app, "inv-admin@test.local");

    const create = await request(app)
      .post("/api/tan-tracker/transfers")
      .set(headers(holderCookie))
      .send({
        item: "Invite auth box",
        finalRecipientExternal: { name: "Ext", phone: "+79991112233" },
      });
    assert.equal(create.status, 201, create.text);
    transferCode = create.body.publicCode as string;
  });

  after(async () => {
    await closePool();
    delete process.env.TT_EXTERNAL_MESSENGER_ENABLED;
  });

  it("denies wrong holder, admin-not-holder; allows current holder", async () => {
    const app = await loadApp();
    const wrong = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferCode)}/messenger-invite`)
      .set(headers(wrongHolderCookie))
      .send({});
    assert.equal(wrong.status, 403, wrong.text);

    const adminOther = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferCode)}/messenger-invite`)
      .set(headers(adminCookie))
      .send({});
    assert.equal(adminOther.status, 403, adminOther.text);

    const ok = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferCode)}/messenger-invite`)
      .set(headers(holderCookie))
      .send({});
    assert.equal(ok.status, 201, ok.text);
    assert.match(ok.body.startToken, /^er/);
    assert.match(ok.body.invitationText, /Получить код в MAX: https:\/\/max\.ru\//);
    assert.match(ok.body.invitationText, /Получить код в Telegram: https:\/\/t\.me\//);
    assert.doesNotMatch(ok.body.invitationText, /\/tan-tracker\/recipient/);
    for (const url of Object.values(ok.body.botLinks) as string[]) {
      assert.equal(new URL(url).searchParams.get("start"), ok.body.startToken);
    }
  });

  it("denies invite in read-only employee preview", async () => {
    const app = await loadApp();
    const start = await request(app)
      .post("/api/admin/access/preview/start")
      .set(headers(adminCookie))
      .send({ userId: wrongHolderUserId });
    assert.equal(start.status, 200, start.text);
    const previewCookies =
      start.headers["set-cookie"]?.map((c) => c.split(";")[0]).join("; ") ?? adminCookie;

    const denied = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferCode)}/messenger-invite`)
      .set(headers(previewCookies))
      .send({});
    assert.equal(denied.status, 403, denied.text);

    await request(app).post("/api/admin/access/preview/stop").set(headers(previewCookies)).send({});
  });
});
