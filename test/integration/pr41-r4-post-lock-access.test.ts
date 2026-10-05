import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { loadAccessContext } from "../../src/access/context";
import {
  accessContextAllowsClientScope,
  loadFreshAccessContext,
  loadFreshClientAndOutletAccess,
} from "../../src/clients/outlet-scope";
import { lockOutletDistributionContext } from "../../src/clients/outlet-distribution-readiness";
import { closePool } from "../../src/db/pool";
import { grantClientAccess, linkUserToEmployee } from "../helpers/access-db-fixtures";
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

const CLIENT_GUID = EXTENDED_FIXTURE_GUIDS.HOLDING_GUID;
const STORE_ONE = EXTENDED_FIXTURE_GUIDS.STORE_ONE;
const REGIONAL = EXTENDED_FIXTURE_GUIDS.REGIONAL;
const TEST_PASSWORD = "StrongPass123!";

describe("PR41 R4 post-lock access revalidation", { concurrency: false }, () => {
  let databaseUrl = "";
  let regionalUserId = "";
  let adminUserId = "";

  before(async () => {
    databaseUrl = getIntegrationDatabaseUrl();
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    await prepareDatabase(databaseUrl);
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
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
    await applyClientsImportVerified({ databaseUrl, payload: validated.payload });
  });

  after(async () => {
    await closePool();
  });

  it("reloads access context on the locked connection after employee-link revoke", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const before = await loadFreshAccessContext(client, regionalUserId, "regional_manager");
      assert.equal(accessContextAllowsClientScope(before), true);
      await client.query(
        `UPDATE user_onec_employee_links SET revoked_at = NOW() WHERE user_id = $1::uuid AND revoked_at IS NULL`,
        [regionalUserId],
      );
      const after = await loadFreshAccessContext(client, regionalUserId, "regional_manager");
      assert.equal(accessContextAllowsClientScope(after), false);
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("reloads access context after user becomes inactive on the locked connection", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      assert.equal(
        accessContextAllowsClientScope(
          await loadFreshAccessContext(client, regionalUserId, "regional_manager"),
        ),
        true,
      );
      await client.query(`UPDATE users SET status = 'disabled' WHERE id = $1::uuid`, [regionalUserId]);
      assert.equal(
        accessContextAllowsClientScope(
          await loadFreshAccessContext(client, regionalUserId, "regional_manager"),
        ),
        false,
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("denies outlet access after client-specific denial on the locked connection", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const before = await loadFreshAccessContext(client, regionalUserId, "regional_manager");
      assert.equal(accessContextAllowsClientScope(before), true);
      assert.ok(
        await loadFreshClientAndOutletAccess(client, before, CLIENT_GUID, STORE_ONE),
      );
      await client.query(
        `
          INSERT INTO access_denials (user_id, scope_type, object_id, reason, basis, created_by_user_id)
          VALUES ($1::uuid, 'client', $2::uuid, $3, $4, $5::uuid)
        `,
        [regionalUserId, CLIENT_GUID, "integration test denial", "integration test", adminUserId],
      );
      const after = await loadFreshAccessContext(client, regionalUserId, "regional_manager");
      assert.equal(
        await loadFreshClientAndOutletAccess(client, after, CLIENT_GUID, STORE_ONE),
        null,
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("denies outlet access after revoke even when stale middleware context would allow", async () => {
    const staleContext = await loadAccessContext(regionalUserId, "regional_manager");
    assert.equal(accessContextAllowsClientScope(staleContext), true);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockOutletDistributionContext(client, CLIENT_GUID, STORE_ONE);
      await client.query(
        `UPDATE user_onec_employee_links SET revoked_at = NOW() WHERE user_id = $1::uuid AND revoked_at IS NULL`,
        [regionalUserId],
      );
      const freshContext = await loadFreshAccessContext(client, regionalUserId, "regional_manager");
      assert.equal(accessContextAllowsClientScope(freshContext), false);
      const freshAccess = await loadFreshClientAndOutletAccess(
        client,
        freshContext,
        CLIENT_GUID,
        STORE_ONE,
      );
      assert.equal(freshAccess, null);
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  });
});
