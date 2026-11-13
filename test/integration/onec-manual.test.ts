import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runManualUpdate } from "../../src/onec-manual/run-update";
import { prepareManualBundle, FILES, type FileKey, type ManualFiles } from "../../src/onec-manual/model";
import { manualFixture, fixtureGuid } from "../helpers/onec-manual-fixtures";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { resetPoolForTests, closePool } from "../../src/db/pool";
import { qualityForVisibleTargets } from "../../src/onec-manual/quality";
import request from "supertest";
import { createTestUser } from "../helpers/test-db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { setImportJobWorkerTestHooks } from "../../src/onec-import/worker-scheduler";
import { buildSaleRecord } from "../helpers/legal-sales-fixtures";
describe("manual 1C atomic PostgreSQL projection", { concurrency: false }, () => {
  let db: Pool, env: NodeJS.ProcessEnv;
  before(async () => {
    const url = getIntegrationDatabaseUrl(); setIntegrationEnv(url);
    await prepareDatabase(url); await resetPoolForTests();
    db = new Pool({ connectionString: url }); env = { ...process.env, TEST_DATABASE_URL: url };
  });
  after(async () => { await db?.end(); await closePool(); });
  async function apply(files: ManualFiles, hook?: () => Promise<void>) {
    return runManualUpdate({ env, manualFiles: files, argv: ["--apply", "--expected-fingerprint",
      prepareManualBundle(files).fingerprint], beforeManualCommit: hook });
  }
  it("imports all files, preserves source duplicates and existing access/identities", async () => {
    await db.query("INSERT INTO onec_v3_legal_entities(guid_client,name_client,managers) VALUES($1,'Старое',$2::jsonb)",
      [fixtureGuid(601), JSON.stringify({ guidManager: fixtureGuid(999) })]);
    const row = { guid_client: fixtureGuid(601), name_client: "Обновлённое", inn: "1234567890" };
    const result = await apply(manualFixture({ clients: [row, { ...row, inn: "9999999999" }] }));
    assert.equal(result.status, "SUCCESS", JSON.stringify(result));
    assert.ok(result.manualSummary!.issueCount > 0);
    assert.equal((await db.query("SELECT COUNT(*) FROM onec_manual_files")).rows[0].count, "12");
    const client = (await db.query("SELECT * FROM onec_v3_legal_entities WHERE guid_client=$1", [fixtureGuid(601)])).rows[0];
    assert.equal(client.name_client, "Обновлённое");
    assert.equal(client.managers.guidManager, fixtureGuid(999));
    assert.equal((await db.query("SELECT COUNT(*) FROM onec_manual_records WHERE file_key='clients'")).rows[0].count, "2");
    const quality = await qualityForVisibleTargets([{ kind: "legal", guid: fixtureGuid(601) }]);
    assert.ok(quality.get("legal:" + fixtureGuid(601))?.issues.some(i => i.code === "DUPLICATE_GUID"));
  });
  it("repeated imports are no-op; corrected source removes only resolved warnings", async () => {
    const files = manualFixture();
    assert.equal((await apply(files)).status, "SUCCESS");
    const counts = (await db.query("SELECT COUNT(*) FROM onec_manual_records")).rows[0].count;
    assert.equal((await apply(files)).status, "NO_CHANGES");
    assert.equal((await db.query("SELECT COUNT(*) FROM onec_manual_records")).rows[0].count, counts);
    const quality = await qualityForVisibleTargets([{ kind: "legal", guid: fixtureGuid(601) }]);
    assert.ok(!quality.get("legal:" + fixtureGuid(601))?.issues.some(i => i.code === "DUPLICATE_GUID"));
  });
  it("rolls back every table and active diagnostics on technical failure", async () => {
    const active = (await db.query("SELECT batch_id FROM onec_manual_state")).rows[0].batch_id;
    const old = (await db.query("SELECT name_client FROM onec_v3_legal_entities WHERE guid_client=$1", [fixtureGuid(601)])).rows[0].name_client;
    const files = manualFixture({ clients: [{ guid_client: fixtureGuid(601), name_client: "Не сохранять" }] });
    const result = await apply(files, async () => { throw Error("simulated local failure"); });
    assert.equal(result.status, "ERROR");
    assert.equal((await db.query("SELECT batch_id FROM onec_manual_state")).rows[0].batch_id, active);
    assert.equal((await db.query("SELECT name_client FROM onec_v3_legal_entities WHERE guid_client=$1", [fixtureGuid(601)])).rows[0].name_client, old);
    const bad = manualFixture(); bad.stocks.bytes = Buffer.from("[");
    assert.equal((await runManualUpdate({ env, manualFiles: bad, argv: ["--dry-run"] })).status, "ERROR");
  });
  it("preserves primitive and null source records verbatim in the raw journal", async () => {
    const result = await apply(manualFixture({ groups: [null, "original", 42, []] }));
    assert.equal(result.status, "SUCCESS");
    const records = await db.query("SELECT record FROM onec_manual_records WHERE batch_id=$1 AND file_key='groups' ORDER BY row_index", [result.exportBatchId]);
    assert.deepEqual(records.rows.map(r => r.record), [null, "original", 42, []]);
  });
  it("retains missing cards and reactivates an earlier bundle safely", async () => {
    const a = manualFixture(), b = manualFixture({ clients: [] });
    assert.equal((await apply(b)).status, "SUCCESS");
    assert.equal((await db.query("SELECT COUNT(*) FROM onec_v3_legal_entities")).rows[0].count, "1");
    assert.equal((await apply(a)).status, "SUCCESS");
    assert.equal((await apply(a)).status, "NO_CHANGES");
  });
  it("retains missing product lines in a partial monthly source without multiplying amounts", async () => {
    const item = (n: number) => {
      const row = buildSaleRecord({ legalGuid: fixtureGuid(601), type: "A", income: 100 * n });
      return { ...row, sale_info: { ...row.sale_info, guid_item: fixtureGuid(n), name_item: "Товар " + n } };
    };
    assert.equal((await apply(manualFixture({ saleItems: [item(1), item(2)] }))).status, "SUCCESS");
    assert.equal((await apply(manualFixture({ saleItems: [item(1)] }))).status, "SUCCESS");
    const sum = (await db.query(`SELECT COUNT(*)::int AS count,SUM(l.income)::text AS income
      FROM onec_v3_legal_sale_item_lines l JOIN onec_v3_legal_sales_month_activation a
      ON a.dataset='sale_items' AND a.sale_month=l.sale_month AND a.source_sha256=l.source_sha256`)).rows[0];
    assert.equal(sum.count, 2); assert.equal(Number(sum.income), 300);
  });
  it("rejects lock contention and a changed verification fingerprint", async () => {
    await db.query("SELECT pg_advisory_lock(902451002)");
    try { assert.equal((await apply(manualFixture({ groups: [{ guid_group: fixtureGuid(987) }] }))).errorCode, "IMPORT_LOCKED"); }
    finally { await db.query("SELECT pg_advisory_unlock(902451002)"); }
    const result = await runManualUpdate({ env, manualFiles: manualFixture(), argv: ["--apply", "--expected-fingerprint", "a".repeat(64)] });
    assert.equal(result.errorCode, "VERIFICATION_FINGERPRINT_MISMATCH");
  });
  it("scopes quality and review filter; reserves raw report to admin; does not expose foreign values", async () => {
    const url = getIntegrationDatabaseUrl();
    const admin = await createTestUser({ databaseUrl: url, email: "onec-admin@test.local", password: "StrongPass123!", fullName: "Admin", role: "admin" });
    const allowed = await createTestUser({ databaseUrl: url, email: "onec-allowed@test.local", password: "StrongPass123!", fullName: "Allowed" });
    const denied = await createTestUser({ databaseUrl: url, email: "onec-denied@test.local", password: "StrongPass123!", fullName: "Denied" });
    await linkUserToEmployee({ databaseUrl: url, userId: allowed.id, employeeId: fixtureGuid(999), confirmedByUserId: admin.id });
    await linkUserToEmployee({ databaseUrl: url, userId: denied.id, employeeId: fixtureGuid(998), confirmedByUserId: admin.id });
    const row = { guid_client: fixtureGuid(601), name_client: "Клиент", inn: "1234567890" };
    await apply(manualFixture({ clients: [row, { ...row, inn: "9999999999" }] }));
    const app = (await import("../../src/server")).createApp();
    async function cookie(email: string) {
      const res = await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:3000").send({ email, password: "StrongPass123!" });
      assert.equal(res.status, 200); return (res.headers["set-cookie"]![0]).split(";")[0];
    }
    const a = await cookie("onec-admin@test.local"), b = await cookie("onec-allowed@test.local"), c = await cookie("onec-denied@test.local");
    const detail = "/api/clients/v3/detail?entity=legal&guid=" + fixtureGuid(601);
    const ok = await request(app).get(detail).set("Cookie", b);
    assert.equal(ok.status, 200);
    assert.ok(ok.body.entity._onecQuality.issues.some((issue: { code: string }) => issue.code === "DUPLICATE_GUID"));
    assert.ok(JSON.stringify(ok.body.entity._onecQuality.variants).includes("9999999999"));
    assert.ok(!JSON.stringify(ok.body.entity._onecQuality.variants).includes("guidManager"));
    const forbidden = await request(app).get(detail).set("Cookie", c);
    assert.equal(forbidden.status, 404); assert.ok(!JSON.stringify(forbidden.body).includes("DUPLICATE_GUID"));
    const list = await request(app).get("/api/clients/v3/list?entity=legal&qualityOnly=1").set("Cookie", b);
    assert.equal(list.status, 200, JSON.stringify(list.body)); assert.equal(list.body.total, 1);
    const hidden = await request(app).get("/api/clients/v3/list?entity=legal&qualityOnly=1").set("Cookie", c);
    assert.equal(hidden.body.total, 0);
    assert.equal((await request(app).get("/api/admin/clients/onec-update/report").set("Cookie", a)).status, 200);
    assert.equal((await request(app).get("/api/admin/clients/onec-update/report").set("Cookie", b)).status, 403);
    assert.equal((await request(app).get("/api/admin/clients/onec-update/report")).status, 401);
    await db.query("UPDATE onec_v3_exchange_state SET apply_blocked=TRUE WHERE id=1");
    try {
      const blocked = await request(app).get("/api/admin/clients/onec-update/status").set("Cookie", a);
      assert.equal(blocked.body.canStart, false);
      assert.equal((await apply(manualFixture())).errorCode, "APPLY_BLOCKED");
    } finally { await db.query("UPDATE onec_v3_exchange_state SET apply_blocked=FALSE WHERE id=1"); }
    // Exercise the real existing HTTP enqueue and worker, with local bytes injected
    // only at the worker test seam. No FTP or production data are involved.
    const previousEnv = { ...process.env };
    const workerEnv = { ...env, ONEC_FTP_ENABLED: "true", ONEC_FTP_HOST: "gw.toopatch.ru",
      ONEC_FTP_PORT: "21", ONEC_FTP_USER: "test", ONEC_FTP_PASSWORD: "test-not-a-real-password",
      ONEC_FTP_BASE_PATH: "/LC", ONEC_FTP_SECURITY: "plain" };
    Object.assign(process.env, workerEnv);
    setImportJobWorkerTestHooks({ regularUpdateExecution: { manualFiles: manualFixture() } });
    try {
      const started = await request(app).post("/api/admin/clients/onec-update").set("Cookie", a)
        .set("Origin", "http://127.0.0.1:3000").send({});
      assert.equal(started.status, 202, JSON.stringify(started.body));
      let status = await request(app).get("/api/admin/clients/onec-update/status").set("Cookie", a);
      const deadline = Date.now() + 15000;
      while (["pending", "running"].includes(status.body.job.phase) && Date.now() < deadline)
        status = await request(app).get("/api/admin/clients/onec-update/status").set("Cookie", a);
      assert.equal(status.status, 200); assert.equal(status.body.job.phase, "completed");
      assert.equal(Object.keys(status.body.job.manualSummary.files).length, 12);
    } finally {
      setImportJobWorkerTestHooks(undefined);
      for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
      Object.assign(process.env, previousEnv);
    }
  });
  it("imports actual supplied twelve-file sample when explicitly configured", { skip: !process.env.ONEC_TEST_FIXTURE_DIR }, async () => {
    const root = process.env.ONEC_TEST_FIXTURE_DIR!, files = {} as ManualFiles;
    for (const file of Object.keys(FILES) as FileKey[]) {
      const section = ["holdings", "clients", "retail", "employees"].includes(file) ? "clients" :
        ["sales", "saleItems", "returns", "returnItems"].includes(file) ? "sales" : "products";
      const sourceName = FILES[file].paths[0];
      files[file] = { sourceName, bytes: await readFile(path.join(root, section, path.basename(sourceName))) };
    }
    const result = await apply(files);
    assert.equal(result.status, "SUCCESS", JSON.stringify(result));
    assert.equal((await db.query("SELECT COUNT(*) FROM onec_manual_files WHERE batch_id=$1", [result.exportBatchId])).rows[0].count, "12");
    assert.equal((await db.query("SELECT COUNT(*) FROM onec_manual_records WHERE batch_id=$1", [result.exportBatchId])).rows[0].count,
      String(Object.values(result.manualSummary!.files).reduce((a, b) => a + b, 0)));
  });
});
