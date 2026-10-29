#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { runMigrations } from "../../dist/db/migrate-runner.js";
import { hashPassword } from "../../dist/auth/password.js";
import {
  TT56_USER_TEST_DATABASE_NAME,
  assertTanTrackerUserTestSeedDatabaseUrl,
} from "../../dist/shared/tan-tracker-user-test-env.js";
import {
  FIXTURE,
  seedTanTrackerFixtures,
  upsertEmployeeLink,
} from "./seed-tt-fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "../..");

const CLIENT_A = "a1111111-1111-4111-8111-111111111111";
const CLIENT_B = "b2222222-2222-4222-8222-222222222222";

const USERS = [
  { email: "tt56-admin@tt56-user-test.local", role: "admin", fullName: "TT56 Admin" },
  { email: "tt56-director@tt56-user-test.local", role: "director", fullName: "TT56 Director" },
  { email: "tt56-rop@tt56-user-test.local", role: "regional_manager", fullName: "TT56 ROP" },
  { email: "tt56-employee-a@tt56-user-test.local", role: "manager", fullName: "TT56 Employee A" },
  { email: "tt56-employee-b@tt56-user-test.local", role: "manager", fullName: "TT56 Employee B" },
];

async function cleanupLegacyRoster(client) {
  await client.query(
    `DELETE FROM onec_wholesale_employee_team_memberships
     WHERE guid_team IN (
       SELECT guid_team FROM onec_wholesale_team_groups
       WHERE name_team = 'TT56 test team' AND guid_team <> $1::uuid
     )`,
    [FIXTURE.TEAM],
  );
  await client.query(
    `DELETE FROM onec_wholesale_team_groups
     WHERE name_team = 'TT56 test team' AND guid_team <> $1::uuid`,
    [FIXTURE.TEAM],
  );
  await client.query(
    `DELETE FROM onec_wholesale_employee_roster
     WHERE guid_manager NOT IN ($1::uuid, $2::uuid, $3::uuid)
       AND name_manager IN ('Employee A', 'Employee B', 'ROP Lead')`,
    [FIXTURE.EMP_A, FIXTURE.EMP_B, FIXTURE.EMP_ROP],
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  assertTanTrackerUserTestSeedDatabaseUrl(databaseUrl, "seed");

  const password = process.env.TT_USER_TEST_DEFAULT_PASSWORD?.trim();
  if (!password || password.length < 12) {
    throw new Error("Set TT_USER_TEST_DEFAULT_PASSWORD (min 12 chars) in env for seed.");
  }

  await runMigrations({ databaseUrl });
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const passwordHash = await hashPassword(password);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS tt56_user_test_fixture_provenance (
        storage_key TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO tt56_user_test_fixture_provenance (storage_key)
      SELECT storage_key FROM tt_transfer_attachments
      WHERE storage_key IN ('tt56-seed-active-a.txt', 'tt56-seed-wait-ab.txt')
      ON CONFLICT DO NOTHING
    `);

    for (const u of USERS) {
      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT ((LOWER(BTRIM(email)))) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           role = EXCLUDED.role,
           password_hash = users.password_hash`,
        [u.email, passwordHash, u.fullName, u.role],
      );
    }

    const ids = Object.fromEntries(
      (
        await client.query(`SELECT email, id::text FROM users WHERE email = ANY($1::text[])`, [
          USERS.map((u) => u.email),
        ])
      ).rows.map((r) => [r.email, r.id]),
    );
    const adminId = ids[USERS[0].email];
    const directorId = ids["tt56-director@tt56-user-test.local"];
    const ropId = ids["tt56-rop@tt56-user-test.local"];
    const userAId = ids["tt56-employee-a@tt56-user-test.local"];
    const userBId = ids["tt56-employee-b@tt56-user-test.local"];

    await cleanupLegacyRoster(client);

    for (const [guid, name, post] of [
      [FIXTURE.EMP_A, "Employee A", "Manager"],
      [FIXTURE.EMP_B, "Employee B", "Manager"],
      [FIXTURE.EMP_ROP, "ROP Lead", "ROP"],
    ]) {
      await client.query(
        `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
         VALUES ($1::uuid, $2, $3, '{}')
         ON CONFLICT (guid_manager) DO UPDATE SET name_manager = EXCLUDED.name_manager, post = EXCLUDED.post`,
        [guid, name, post],
      );
    }

    await upsertEmployeeLink(client, userAId, FIXTURE.EMP_A, adminId);
    await upsertEmployeeLink(client, userBId, FIXTURE.EMP_B, adminId);
    await upsertEmployeeLink(client, ropId, FIXTURE.EMP_ROP, adminId);

    await client.query(
      `INSERT INTO onec_wholesale_team_groups (guid_team, name_team, guid_team_leader, name_team_leader)
       VALUES ($1::uuid, 'TT56 test team', $2::uuid, 'ROP Lead')
       ON CONFLICT (guid_team) DO UPDATE SET
         guid_team_leader = EXCLUDED.guid_team_leader,
         name_team = EXCLUDED.name_team`,
      [FIXTURE.TEAM, FIXTURE.EMP_ROP],
    );
    await client.query(
      `UPDATE onec_wholesale_team_groups
       SET name_team_leader = 'ROP Lead'
       WHERE guid_team = $1::uuid
         AND name_team_leader = $2`,
      [FIXTURE.TEAM, FIXTURE.EMP_ROP],
    );
    await client.query(`DELETE FROM onec_wholesale_employee_team_memberships WHERE guid_team = $1::uuid`, [
      FIXTURE.TEAM,
    ]);
    await client.query(
      `INSERT INTO onec_wholesale_employee_team_memberships (guid_team, guid_manager, name_team)
       VALUES ($1::uuid, $2::uuid, 'TT56 test team'), ($1::uuid, $3::uuid, 'TT56 test team')`,
      [FIXTURE.TEAM, FIXTURE.EMP_ROP, FIXTURE.EMP_A],
    );

    const importRun = await client.query(`SELECT 1 FROM onec_client_import_runs LIMIT 1`);
    if (!importRun.rowCount) {
      await client.query(
        `INSERT INTO onec_client_import_runs (status, mode, source_sha256, source_record_count, finished_at)
         VALUES ('success', 'apply', $1, 2, NOW())`,
        ["b".repeat(64)],
      );
    }

    for (const [guid, name, managerGuid, managerName] of [
      [CLIENT_A, "TT56 Synthetic Client Alpha", FIXTURE.EMP_A, "Employee A"],
      [CLIENT_B, "TT56 Synthetic Client Beta", FIXTURE.EMP_B, "Employee B"],
    ]) {
      await client.query(
        `INSERT INTO onec_clients (
           guid_client, name_client, guid_holding, name_holding, guid_manager, name_manager,
           address, telephone, source_sha256, last_imported_at, manager_roster_state, baseline_status
         ) VALUES ($1::uuid, $2, NULL, '', $3::uuid, $4, '', '[]'::jsonb, $5, NOW(), 'in_wholesale_roster', 'active')
         ON CONFLICT (guid_client) DO UPDATE SET
           name_client = EXCLUDED.name_client,
           guid_manager = EXCLUDED.guid_manager,
           name_manager = EXCLUDED.name_manager`,
        [guid, name, managerGuid, managerName, "c".repeat(64)],
      );
    }

    for (const [userId, clientId] of [
      [userAId, CLIENT_A],
      [userBId, CLIENT_B],
      [ropId, CLIENT_A],
      [directorId, CLIENT_A],
      [directorId, CLIENT_B],
    ]) {
      await client.query(
        `DELETE FROM access_grants WHERE user_id = $1::uuid AND grant_type = 'client' AND object_id = $2::uuid`,
        [userId, clientId],
      );
      await client.query(
        `INSERT INTO access_grants (user_id, grant_type, object_id, basis, granted_by_user_id)
         VALUES ($1::uuid, 'client', $2::uuid, 'tt56 user test', $3::uuid)`,
        [userId, clientId, adminId],
      );
    }

    await seedTanTrackerFixtures(client, {
      userIds: { employeeA: userAId, employeeB: userBId, rop: ropId, director: directorId },
      adminId,
      repoRoot,
    });

    await client.query("COMMIT");

    const outDir = path.join(repoRoot, "var/tt56-user-test");
    fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(outDir, "operator-credentials.json"),
      JSON.stringify(
        {
          database: TT56_USER_TEST_DATABASE_NAME,
          users: USERS.map((u) => ({ email: u.email, role: u.role })),
          passwordSource: "TT_USER_TEST_DEFAULT_PASSWORD (runtime env, not stored here)",
          fixtureTransferIds: Object.values(FIXTURE).filter((v) => String(v).startsWith("TT56-S-")),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    console.log(`SEED_OK: ${TT56_USER_TEST_DATABASE_NAME}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
