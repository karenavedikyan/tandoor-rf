import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { FIXTURE } from "../../scripts/tan-tracker-user-test/seed-tt-fixtures.mjs";
import { TT56_USER_TEST_DATABASE_NAME } from "../../src/shared/tan-tracker-user-test-env";

const repoRoot = path.join(path.dirname(new URL(import.meta.url).pathname), "../..");
const SEED_PASSWORD = "Tt56SeedIdempotencyTest!2026";

function seedDatabaseUrl(): string | null {
  const fromEnv = process.env.TT56_USER_TEST_SEED_DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  const user = process.env.TT56_USER_TEST_DB_USER?.trim() || "tt56_user_test";
  const pass = process.env.TT56_USER_TEST_DB_PASSWORD?.trim();
  if (!pass) return null;
  return `postgresql://${user}:${encodeURIComponent(pass)}@127.0.0.1:5432/${TT56_USER_TEST_DATABASE_NAME}?sslmode=disable`;
}

function runSeed(databaseUrl: string): void {
  const build = spawnSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe", encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const res = spawnSync(process.execPath, ["scripts/tan-tracker-user-test/seed.mjs"], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DATABASE_URL: databaseUrl,
      PGSSLMODE: "disable",
      TT_USER_TEST_DEFAULT_PASSWORD: SEED_PASSWORD,
      TT_ATTACHMENTS_DIR: path.join(repoRoot, "var/tt56-user-test/attachments"),
      TT_USER_TEST_OTP_DIR: path.join(repoRoot, "var/tt56-user-test/otp"),
    },
    stdio: "pipe",
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);
}

describe("tan-tracker user-test seed idempotency", { concurrency: false, skip: !seedDatabaseUrl() }, () => {
  let databaseUrl = "";
  let pool: Pool;

  before(async () => {
    databaseUrl = seedDatabaseUrl()!;
    runSeed(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
  });

  after(async () => {
    await pool?.end();
  });

  it("second seed keeps stable roster/team counts and fixture transfers", async () => {
    const userTransferId = "TT56-USER-CREATED-1";
    await pool.query(
      `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version, row_version)
       SELECT $1, $1, 'User created between seeds', 'active', p.id, p.id, 1, 1
       FROM tt_parties p
       JOIN users u ON u.id = p.user_id
       WHERE u.email = 'tt56-employee-a@tt56-user-test.local'
       LIMIT 1
       ON CONFLICT (id) DO NOTHING`,
      [userTransferId],
    );

    runSeed(databaseUrl);

    const roster = await pool.query(`SELECT COUNT(*)::int AS n FROM onec_wholesale_employee_roster`);
    assert.equal(roster.rows[0]!.n, 3);
    const teams = await pool.query(
      `SELECT COUNT(*)::int AS n FROM onec_wholesale_team_groups WHERE name_team = 'TT56 test team'`,
    );
    assert.equal(teams.rows[0]!.n, 1);

    const client = await pool.query(
      `SELECT guid_manager::text FROM onec_clients WHERE guid_client = $1::uuid`,
      ["a1111111-1111-4111-8111-111111111111"],
    );
    assert.equal(client.rows[0]!.guid_manager, FIXTURE.EMP_A);

    const userRow = await pool.query(`SELECT item_title FROM tt_transfers WHERE id = $1`, [userTransferId]);
    assert.equal(userRow.rowCount, 1);
    assert.equal(userRow.rows[0]!.item_title, "User created between seeds");

    const fixtures = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tt_transfers WHERE id LIKE 'TT56-S-%'`,
    );
    assert.equal(fixtures.rows[0]!.n, 4);

    const bootstrap = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tt_transfers t
       JOIN tt_parties p ON p.id = t.holder_party_id
       JOIN users u ON u.id = p.user_id
       WHERE u.email = 'tt56-employee-a@tt56-user-test.local'`,
    );
    assert.ok(bootstrap.rows[0]!.n >= 3);
  });
});
