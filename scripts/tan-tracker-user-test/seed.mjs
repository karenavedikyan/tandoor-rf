#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { runMigrations } from "../../dist/db/migrate-runner.js";
import { hashPassword } from "../../dist/auth/password.js";
import {
  TT56_USER_TEST_DATABASE_NAME,
  assertTanTrackerUserTestDatabaseUrl,
} from "../../dist/shared/tan-tracker-user-test-env.js";

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

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  assertTanTrackerUserTestDatabaseUrl(databaseUrl, "seed");

  const password = process.env.TT_USER_TEST_DEFAULT_PASSWORD?.trim();
  if (!password || password.length < 12) {
    throw new Error("Set TT_USER_TEST_DEFAULT_PASSWORD (min 12 chars) in env for seed.");
  }

  await runMigrations({ databaseUrl });
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const passwordHash = await hashPassword(password);

  const empA = randomUUID();
  const empB = randomUUID();
  const empRop = randomUUID();
  const teamId = randomUUID();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const u of USERS) {
      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT ((LOWER(BTRIM(email)))) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           role = EXCLUDED.role,
           status = 'active'`,
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
    const ropId = ids["tt56-rop@tt56-user-test.local"];
    const userAId = ids["tt56-employee-a@tt56-user-test.local"];
    const userBId = ids["tt56-employee-b@tt56-user-test.local"];

    await client.query(
      `INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
       VALUES ($1::uuid, 'Employee A', 'Manager', '{}'), ($2::uuid, 'Employee B', 'Manager', '{}'), ($3::uuid, 'ROP Lead', 'ROP', '{}')
       ON CONFLICT (guid_manager) DO NOTHING`,
      [empA, empB, empRop],
    );

    for (const [userId, employeeId] of [
      [userAId, empA],
      [userBId, empB],
      [ropId, empRop],
    ]) {
      await client.query(
        `DELETE FROM user_onec_employee_links WHERE user_id = $1::uuid AND revoked_at IS NULL`,
        [userId],
      );
      await client.query(
        `INSERT INTO user_onec_employee_links (user_id, employee_id, basis, confirmed_by_user_id)
         VALUES ($1::uuid, $2::uuid, 'tt56 user test seed', $3::uuid)`,
        [userId, employeeId, adminId],
      );
    }

    await client.query(
      `INSERT INTO onec_wholesale_team_groups (guid_team, name_team, guid_team_leader, name_team_leader)
       VALUES ($1::uuid, 'TT56 test team', $2::uuid, 'ROP Lead')
       ON CONFLICT (guid_team) DO NOTHING`,
      [teamId, empRop],
    );
    await client.query(`DELETE FROM onec_wholesale_employee_team_memberships WHERE guid_team = $1::uuid`, [
      teamId,
    ]);
    await client.query(
      `INSERT INTO onec_wholesale_employee_team_memberships (guid_team, guid_manager, name_team)
       VALUES ($1::uuid, $2::uuid, 'TT56 test team'), ($1::uuid, $3::uuid, 'TT56 test team')`,
      [teamId, empRop, empA],
    );

    await client.query(
      `INSERT INTO onec_client_import_runs (status, mode, source_sha256, source_record_count, finished_at)
       VALUES ('success', 'apply', $1, 2, NOW())`,
      ["b".repeat(64)],
    );

    for (const [guid, name, managerGuid, managerName] of [
      [CLIENT_A, "TT56 Synthetic Client Alpha", empA, "Employee A"],
      [CLIENT_B, "TT56 Synthetic Client Beta", empB, "Employee B"],
    ]) {
      await client.query(
        `INSERT INTO onec_clients (
           guid_client, name_client, guid_holding, name_holding, guid_manager, name_manager,
           address, telephone, source_sha256, last_imported_at, manager_roster_state, baseline_status
         ) VALUES ($1::uuid, $2, NULL, '', $3::uuid, $4, '', '[]'::jsonb, $5, NOW(), 'in_wholesale_roster', 'active')
         ON CONFLICT (guid_client) DO UPDATE SET name_client = EXCLUDED.name_client`,
        [guid, name, managerGuid, managerName, "c".repeat(64)],
      );
    }

    for (const [userId, clientId] of [
      [userAId, CLIENT_A],
      [userBId, CLIENT_B],
      [ropId, CLIENT_A],
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
