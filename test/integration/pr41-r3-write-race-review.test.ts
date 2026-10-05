import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Express } from "express";
import { Pool } from "pg";
import request from "supertest";
import { applyCatalogImport } from "../../src/onec-catalog/apply";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import { readExtendedSnapshot } from "../../src/onec-clients/extended-apply";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { grantClientAccess, linkUserToEmployee } from "../helpers/access-db-fixtures";
import {
  buildMinimalDistributionXmlSet,
  catalogDistributionEntriesFromXmlSet,
} from "../helpers/onec-catalog-fixtures";
import { applyClientsImportVerified } from "../helpers/onec-clients-fixtures";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedHolding,
  sampleIdentifiedOutlet,
  validateClientsForApplyTest,
} from "../helpers/onec-clients-extended-fixtures";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const ORIGIN = "http://127.0.0.1:3000";
const TEST_PASSWORD = "StrongPass123!";
const CLIENT_GUID = EXTENDED_FIXTURE_GUIDS.HOLDING_GUID;
const STORE_ONE = EXTENDED_FIXTURE_GUIDS.STORE_ONE;
const REGIONAL = EXTENDED_FIXTURE_GUIDS.REGIONAL;
const OTHER_REGIONAL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function authHeaders(cookie: string): Record<string, string> {
  return { Origin: ORIGIN, Cookie: cookie };
}

async function login(app: Express, email: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .set({ Origin: ORIGIN, "Content-Type": "application/json" })
    .send({ email, password: TEST_PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return (res.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
}

async function seedCatalog(databaseUrl: string): Promise<string> {
  const xmlSet = buildMinimalDistributionXmlSet();
  const entries = catalogDistributionEntriesFromXmlSet(xmlSet);
  const parsed = await parseCatalogSet(
    entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    "distribution",
  );
  assert.equal(parsed.ok, true);
  const validated = validateCatalogSet(parsed.data!, { profile: "distribution" });
  assert.equal(validated.ok, true);
  const applied = await applyCatalogImport(databaseUrl, validated.data!);
  assert.equal(applied.ok, true);
  return applied.versionId;
}

function snapshotWithoutRegionalAccess(snapshot: unknown): unknown {
  const parsed = readExtendedSnapshot(snapshot);
  assert.ok(parsed);
  const copy = JSON.parse(JSON.stringify(parsed)) as typeof parsed;
  const outlet = copy.currentRetailOutlets[0];
  assert.ok(outlet);
  outlet.managers.regionalManager = { guid: OTHER_REGIONAL, name: "Other Regional", state: "directory_unverified" };
  return copy;
}

function startPost(
  app: Express,
  url: string,
  cookie: string,
  body: Record<string, unknown>,
): { result: Promise<Awaited<ReturnType<typeof request>>>; settled: () => boolean } {
  let postSettled = false;
  let postResult: Awaited<ReturnType<typeof request>> | null = null;
  const result = request(app)
    .post(url)
    .set({ Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" })
    .send(body)
    .then((res) => {
      postResult = res;
      postSettled = true;
      return res;
    });
  return {
    result,
    settled: () => postSettled,
  };
}

async function runConcurrentPostDuringClientLock(input: {
  app: Express;
  monitor: Pool;
  holder: import("pg").PoolClient;
  url: string;
  cookie: string;
  body: Record<string, unknown>;
  whileLocked: () => Promise<void>;
}): Promise<Awaited<ReturnType<typeof request>>> {
  await input.holder.query("BEGIN");
  await input.holder.query(
    `SELECT guid_client FROM onec_clients WHERE guid_client = $1::uuid FOR UPDATE`,
    [CLIENT_GUID],
  );

  const post = startPost(input.app, input.url, input.cookie, input.body);
  const holderPid = Number(
    (await input.holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid,
  );
  let sawBlockedWaiter = false;
  for (let attempt = 0; attempt < 300 && !post.settled(); attempt += 1) {
    const blocked = await input.monitor.query<{ blocked: boolean }>(
      `
        SELECT (
          COALESCE(array_length(pg_blocking_pids($1::int), 1), 0) > 0
          OR EXISTS (
            SELECT 1
            FROM pg_stat_activity
            WHERE pid <> $1::int
              AND wait_event_type = 'Lock'
              AND query ILIKE '%onec_clients%'
              AND state = 'active'
          )
        ) AS blocked
      `,
      [holderPid],
    );
    if (blocked.rows[0]?.blocked) {
      sawBlockedWaiter = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (post.settled()) {
    const early = await post.result;
    assert.fail(
      `POST settled before lock wait with status ${early.status}: ${JSON.stringify(early.body)}`,
    );
  }
  assert.equal(sawBlockedWaiter, true, "expected POST to wait on onec_clients row lock");

  await input.whileLocked();
  await input.holder.query("COMMIT");

  const waitDeadline = Date.now() + 15000;
  while (!post.settled() && Date.now() < waitDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return post.result;
}

describe("PR41 R3 distribution write access revalidation", { concurrency: false }, () => {
  let databaseUrl = "";
  let catalogVersionId = "";
  let regionalCookie = "";
  let regionalUserId = "";
  let adminUserId = "";
  let app!: Express;

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, ORIGIN);
    await prepareDatabase(databaseUrl);
    const admin = await createTestUser({
      databaseUrl,
      email: "admin@example.com",
      password: TEST_PASSWORD,
      fullName: "Admin",
      role: "admin",
    });
    adminUserId = admin.id;
    const regional = await createTestUser({
      databaseUrl,
      email: "regional@example.com",
      password: TEST_PASSWORD,
      fullName: "Regional",
      role: "regional_manager",
    });
    regionalUserId = regional.id;
    await linkUserToEmployee({
      databaseUrl,
      userId: regional.id,
      employeeId: REGIONAL,
      confirmedByUserId: admin.id,
    });
    await grantClientAccess({
      databaseUrl,
      userId: regional.id,
      objectId: CLIENT_GUID,
      grantedByUserId: admin.id,
    });

    const bytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        retail_outlets: [
          sampleIdentifiedOutlet({
            guid_store: STORE_ONE,
            closed: false,
            managers: {
              guid_manager: "",
              name_manager: "",
              guid_regional_manager: REGIONAL,
              name_regional_manager: "Regional Lead",
              guid_hardware_manager: "",
              name_hardware_manager: "",
              guid_head_of_the_sales_department: "",
              name_head_of_the_sales_department: "",
            },
          }),
        ],
      }),
    ]);
    const validated = validateClientsForApplyTest(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const applied = await applyClientsImportVerified({ databaseUrl, payload: validated.payload });
    assert.equal(applied.ok, true, applied.ok ? "" : `${applied.code}: ${applied.message}`);

    catalogVersionId = await seedCatalog(databaseUrl);
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    app = createApp();
    regionalCookie = await login(app, "regional@example.com");
  });

  after(async () => {
    await closePool();
  });

  it("rejects marker write when regional assignment changes while waiting on client lock", async () => {
    const url = `/api/clients/${CLIENT_GUID}/catalog/outlets/${STORE_ONE}/distribution/markers`;
    const body = {
      action: "set",
      markerKind: "installed",
      productCode: "p1",
      versionId: catalogVersionId,
    };

    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const monitor = new Pool({ connectionString: databaseUrl, max: 1 });
    const holder = await pool.connect();
    try {
      let snapshotForUpdate: unknown;
      const postResult = await runConcurrentPostDuringClientLock({
        app,
        monitor,
        holder,
        url,
        cookie: regionalCookie,
        body,
        whileLocked: async () => {
          const locked = await holder.query<{ extended_snapshot: unknown }>(
            `SELECT extended_snapshot FROM onec_clients WHERE guid_client = $1::uuid`,
            [CLIENT_GUID],
          );
          snapshotForUpdate = locked.rows[0]!.extended_snapshot;
          const updatedSnapshot = snapshotWithoutRegionalAccess(snapshotForUpdate);
          await holder.query(
            `UPDATE onec_clients SET extended_snapshot = $2::jsonb WHERE guid_client = $1::uuid`,
            [CLIENT_GUID, JSON.stringify(updatedSnapshot)],
          );
        },
      });
      assert.equal(postResult.status, 404, JSON.stringify(postResult.body));

      const events = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM outlet_distribution_marker_events WHERE product_code = 'p1'`,
      );
      assert.equal(events.rows[0]?.n, 0);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
      await monitor.end().catch(() => undefined);
      await pool.end().catch(() => undefined);
    }
  });

  it("rejects marker write when employee-link is revoked while waiting on client lock", async () => {
    const url = `/api/clients/${CLIENT_GUID}/catalog/outlets/${STORE_ONE}/distribution/markers`;
    const body = {
      action: "set",
      markerKind: "installed",
      productCode: "revoke-link",
      versionId: catalogVersionId,
    };

    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const monitor = new Pool({ connectionString: databaseUrl, max: 1 });
    const holder = await pool.connect();
    try {
      const postResult = await runConcurrentPostDuringClientLock({
        app,
        monitor,
        holder,
        url,
        cookie: regionalCookie,
        body,
        whileLocked: async () => {
          await holder.query(
            `UPDATE user_onec_employee_links SET revoked_at = NOW() WHERE user_id = $1::uuid AND revoked_at IS NULL`,
            [regionalUserId],
          );
        },
      });
      assert.equal(postResult.status, 403, JSON.stringify(postResult.body));

      const events = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM outlet_distribution_marker_events WHERE product_code = 'revoke-link'`,
      );
      assert.equal(events.rows[0]?.n, 0);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
      await monitor.end().catch(() => undefined);
      await pool.end().catch(() => undefined);
    }
  });

  it("allows write before assignment change and blocks subsequent reads", async () => {
    const url = `/api/clients/${CLIENT_GUID}/catalog/outlets/${STORE_ONE}/distribution/markers`;
    const body = {
      action: "set",
      markerKind: "installed",
      productCode: "p1",
      versionId: catalogVersionId,
    };

    const saved = await request(app)
      .post(url)
      .set({ Origin: ORIGIN, Cookie: regionalCookie, "Content-Type": "application/json" })
      .send(body);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.changed, true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const row = await pool.query<{ extended_snapshot: unknown }>(
      `SELECT extended_snapshot FROM onec_clients WHERE guid_client = $1::uuid`,
      [CLIENT_GUID],
    );
    const updatedSnapshot = snapshotWithoutRegionalAccess(row.rows[0]!.extended_snapshot);
    await pool.query(`UPDATE onec_clients SET extended_snapshot = $2::jsonb WHERE guid_client = $1::uuid`, [
      CLIENT_GUID,
      JSON.stringify(updatedSnapshot),
    ]);
    await pool.end();

    const denied = await request(app)
      .get(`/api/clients/${CLIENT_GUID}/catalog/outlets/${STORE_ONE}/distribution`)
      .set(authHeaders(regionalCookie));
    assert.equal(denied.status, 404);
  });
});
