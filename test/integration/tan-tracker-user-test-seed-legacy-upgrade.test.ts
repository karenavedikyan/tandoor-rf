import assert from "node:assert/strict";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import {
  FIXTURE,
  FIXTURE_ATTACHMENT_SPECS,
} from "../../scripts/tan-tracker-user-test/seed-tt-fixtures.mjs";
import {
  TT56_USER_TEST_DATABASE_NAME,
  TT56_USER_TEST_SEED_EXTRA_DATABASE_NAMES,
} from "../../src/shared/tan-tracker-user-test-env";
import { prepareDatabase } from "../helpers/test-db";

const repoRoot = path.join(path.dirname(new URL(import.meta.url).pathname), "../..");
const SEED_PASSWORD = "Tt56SeedLegacyUpgrade!2026";
const ATTACH_KEY = "tt56-seed-active-a.txt";
const A0FAC71_SHA = "a0fac71f32b528ed026d21a2df23e58382ec76e5";
const A0FAC71_WORKTREE = path.join(repoRoot, "var/git-worktrees/a0fac71-tt56-seed");

function seedDatabaseUrl(): string | null {
  const fromEnv = process.env.TT56_USER_TEST_SEED_DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  const pass = process.env.TT56_USER_TEST_DB_PASSWORD?.trim();
  if (!pass) return null;
  const user = process.env.TT56_USER_TEST_DB_USER?.trim() || "tt56_user_test";
  return `postgresql://${user}:${encodeURIComponent(pass)}@127.0.0.1:5432/${TT56_USER_TEST_DATABASE_NAME}?sslmode=disable`;
}

function withDatabaseName(baseUrl: string, dbName: string): string {
  const parsed = new URL(baseUrl.replace(/^postgresql:/i, "postgres:"));
  parsed.pathname = `/${dbName}`;
  return parsed.toString().replace(/^postgres:/, "postgresql:");
}

function adminPostgresUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl.replace(/^postgresql:/i, "postgres:"));
  parsed.pathname = "/postgres";
  return parsed.toString().replace(/^postgres:/, "postgresql:");
}

function resolveAdminPostgresUrl(): string {
  const integration = process.env.TEST_DATABASE_URL?.trim();
  if (integration) return adminPostgresUrl(integration);
  const fallback = process.env.TT56_USER_TEST_PG_ADMIN_URL?.trim();
  if (fallback) return fallback;
  return "postgresql://postgres:postgres@127.0.0.1:5432/postgres?sslmode=disable";
}

async function ensureSiblingTestDatabase(baseUrl: string, dbName: string): Promise<string> {
  const siblingUrl = withDatabaseName(baseUrl, dbName);
  const owner = new URL(baseUrl.replace(/^postgresql:/i, "postgres:")).username || "tt56_user_test";
  const admin = new Pool({ connectionString: resolveAdminPostgresUrl(), max: 1 });
  const exists = await admin.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS ok`,
    [dbName],
  );
  if (!exists.rows[0]?.ok) {
    const quotedDb = `"${dbName.replace(/"/g, '""')}"`;
    const quotedOwner = `"${owner.replace(/"/g, '""')}"`;
    await admin.query(`CREATE DATABASE ${quotedDb} OWNER ${quotedOwner}`);
  }
  await admin.end();
  return siblingUrl;
}

function runSeed(databaseUrl: string, attachmentsDir: string, cwd = repoRoot): void {
  const build = spawnSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe", encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const res = spawnSync(process.execPath, ["scripts/tan-tracker-user-test/seed.mjs"], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DATABASE_URL: databaseUrl,
      PGSSLMODE: "disable",
      TT_USER_TEST_DEFAULT_PASSWORD: SEED_PASSWORD,
      TT_ATTACHMENTS_DIR: attachmentsDir,
      TT_USER_TEST_OTP_DIR: path.join(attachmentsDir, "../otp"),
    },
    stdio: "pipe",
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);
}

function ensureA0fac71Worktree(): void {
  if (!existsSync(path.join(A0FAC71_WORKTREE, ".git"))) {
    const add = spawnSync(
      "git",
      ["worktree", "add", "--detach", A0FAC71_WORKTREE, A0FAC71_SHA],
      { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
    );
    assert.equal(add.status, 0, add.stderr || add.stdout);
  }
  const nodeModulesLink = path.join(A0FAC71_WORKTREE, "node_modules");
  if (!existsSync(nodeModulesLink)) {
    mkdirSync(path.dirname(nodeModulesLink), { recursive: true });
    spawnSync("ln", ["-sf", "../../../node_modules", nodeModulesLink], { cwd: repoRoot });
  }
  const build = spawnSync("npm", ["run", "build"], {
    cwd: A0FAC71_WORKTREE,
    stdio: "pipe",
    encoding: "utf8",
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
}

describe("tan-tracker user-test seed a0fac71 legacy upgrade", {
  concurrency: false,
  skip: !seedDatabaseUrl(),
}, () => {
  it("true a0fac71 seed upgrade keeps deleted attachment and custom leader", async () => {
    const databaseUrl = seedDatabaseUrl()!;
    await prepareDatabase(databaseUrl);

    const legacyAttachDir = path.join(repoRoot, "var/tt56-user-test-legacy-a0fac71/attachments");
    ensureA0fac71Worktree();
    runSeed(databaseUrl, legacyAttachDir, A0FAC71_WORKTREE);

    const customLeader = "QA user-edited leader";
    const legacyPool = new Pool({ connectionString: databaseUrl, max: 4 });
    try {
      const prov = await legacyPool.query(
        `SELECT to_regclass('public.tt56_user_test_fixture_provenance') AS rel`,
      );
      assert.equal(prov.rows[0]!.rel, null);

      await legacyPool.query(`DELETE FROM tt_transfer_attachments WHERE storage_key = $1`, [ATTACH_KEY]);
      const attachPath = path.join(legacyAttachDir, ATTACH_KEY);
      if (existsSync(attachPath)) unlinkSync(attachPath);
      await legacyPool.query(
        `UPDATE onec_wholesale_team_groups SET name_team_leader = $2 WHERE guid_team = $1::uuid`,
        [FIXTURE.TEAM, customLeader],
      );
      const userB = await legacyPool.query(
        `SELECT id::text FROM users WHERE email = 'tt56-employee-b@tt56-user-test.local'`,
      );
      await legacyPool.query(`UPDATE users SET status = 'disabled' WHERE id = $1::uuid`, [userB.rows[0]!.id]);
    } finally {
      await legacyPool.end();
    }

    runSeed(databaseUrl, legacyAttachDir);

    const afterPool = new Pool({ connectionString: databaseUrl, max: 4 });
    try {
      const rows = await afterPool.query(
        `SELECT COUNT(*)::int AS n FROM tt_transfer_attachments WHERE storage_key = $1`,
        [ATTACH_KEY],
      );
      assert.equal(rows.rows[0]!.n, 0);
      assert.equal(existsSync(path.join(legacyAttachDir, ATTACH_KEY)), false);

      const leader = await afterPool.query(
        `SELECT name_team_leader FROM onec_wholesale_team_groups WHERE guid_team = $1::uuid`,
        [FIXTURE.TEAM],
      );
      assert.equal(leader.rows[0]!.name_team_leader, customLeader);

      const status = await afterPool.query(
        `SELECT status FROM users WHERE email = 'tt56-employee-b@tt56-user-test.local'`,
      );
      assert.equal(status.rows[0]!.status, "disabled");
    } finally {
      await afterPool.end();
    }
  });
});

describe("tan-tracker user-test seed legacy upgrade", { concurrency: false, skip: !seedDatabaseUrl() }, () => {
  let databaseUrl = "";
  let pool: Pool;
  let attachmentsDir = "";

  before(async () => {
    databaseUrl = seedDatabaseUrl()!;
    attachmentsDir = path.join(repoRoot, "var/tt56-user-test-legacy-upgrade/attachments");
    runSeed(databaseUrl, attachmentsDir);
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
  });

  after(async () => {
    await pool?.end();
  });

  it("does not resurrect attachment after legacy state without provenance", async () => {
    await pool.query(`DROP TABLE IF EXISTS tt56_user_test_fixture_provenance`);
    await pool.query(`DELETE FROM tt_transfer_attachments WHERE storage_key = $1`, [ATTACH_KEY]);
    const attachPath = path.join(attachmentsDir, ATTACH_KEY);
    if (existsSync(attachPath)) unlinkSync(attachPath);

    const transfer = await pool.query(`SELECT 1 FROM tt_transfers WHERE id = $1`, [FIXTURE.TRANSFER_ACTIVE_A]);
    assert.equal(transfer.rowCount, 1);

    runSeed(databaseUrl, attachmentsDir);

    const rows = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tt_transfer_attachments WHERE storage_key = $1`,
      [ATTACH_KEY],
    );
    assert.equal(rows.rows[0]!.n, 0);
    assert.equal(existsSync(attachPath), false);

    const tombstone = await pool.query(
      `SELECT 1 FROM tt56_user_test_fixture_provenance WHERE storage_key = $1`,
      [ATTACH_KEY],
    );
    assert.equal(tombstone.rowCount, 1);
  });

  it("preserves custom team leader name on upgrade seed", async () => {
    const custom = "QA user-edited leader";
    await pool.query(
      `UPDATE onec_wholesale_team_groups SET name_team_leader = $2 WHERE guid_team = $1::uuid`,
      [FIXTURE.TEAM, custom],
    );
    runSeed(databaseUrl, attachmentsDir);
    const row = await pool.query(
      `SELECT name_team_leader FROM onec_wholesale_team_groups WHERE guid_team = $1::uuid`,
      [FIXTURE.TEAM],
    );
    assert.equal(row.rows[0]!.name_team_leader, custom);
  });

  it("repairs corrupted GUID team leader name on upgrade seed", async () => {
    await pool.query(
      `UPDATE onec_wholesale_team_groups SET name_team_leader = $2 WHERE guid_team = $1::uuid`,
      [FIXTURE.TEAM, FIXTURE.EMP_ROP],
    );
    runSeed(databaseUrl, attachmentsDir);
    const repaired = await pool.query(
      `SELECT name_team_leader FROM onec_wholesale_team_groups WHERE guid_team = $1::uuid`,
      [FIXTURE.TEAM],
    );
    assert.equal(repaired.rows[0]!.name_team_leader, "ROP Lead");
  });

  it("fresh database still receives fixture attachments", async () => {
    const baseUrl = seedDatabaseUrl()!;
    const fromEnv = process.env.TT56_USER_TEST_LEGACY_FRESH_DATABASE_URL?.trim();
    const dbName = TT56_USER_TEST_SEED_EXTRA_DATABASE_NAMES[0]!;
    const freshUrl = fromEnv || (await ensureSiblingTestDatabase(baseUrl, dbName));
    await prepareDatabase(freshUrl);
    const freshDir = path.join(repoRoot, "var/tt56-user-test-legacy-fresh/attachments");
    runSeed(freshUrl, freshDir);
    const freshPool = new Pool({ connectionString: freshUrl, max: 2 });
    try {
      for (const spec of FIXTURE_ATTACHMENT_SPECS) {
        const n = await freshPool.query(
          `SELECT COUNT(*)::int AS c FROM tt_transfer_attachments WHERE storage_key = $1`,
          [spec.storageKey],
        );
        assert.equal(n.rows[0]!.c, 1, spec.storageKey);
        assert.equal(existsSync(path.join(freshDir, spec.storageKey)), true, spec.storageKey);
      }
      const leader = await freshPool.query(
        `SELECT name_team_leader FROM onec_wholesale_team_groups WHERE guid_team = $1::uuid`,
        [FIXTURE.TEAM],
      );
      assert.equal(leader.rows[0]!.name_team_leader, "ROP Lead");
    } finally {
      await freshPool.end();
    }
  });
});
