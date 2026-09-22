import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const databaseUrl = getIntegrationDatabaseUrl();
const SECRET_PASSWORD = "PtySecretPass12345";
const BOOTSTRAP_BIN = "dist/cli/bootstrap-admin.js";

type PtyModule = typeof import("node-pty");

type BootstrapSession = {
  output: string;
  exitCode: number;
};

let ptyModule: PtyModule | null = null;
let ptySkipReason: string | undefined;

async function initPtyModule(): Promise<void> {
  try {
    ptyModule = await import("node-pty");
    const probe = ptyModule.spawn(process.execPath, ["--version"], {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env,
    });
    await new Promise<void>((resolve, reject) => {
      probe.onExit(({ exitCode }) => {
        if (exitCode === 0) {
          resolve();
          return;
        }
        reject(new Error(`node-pty probe exited with code ${exitCode ?? "null"}`));
      });
    });
  } catch (error) {
    ptyModule = null;
    ptySkipReason =
      error instanceof Error
        ? `node-pty unavailable: ${error.message}`
        : "node-pty unavailable in this environment";
  }
}

function testEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    PGSSLMODE: "disable",
  };
}

async function countAdmins(): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin'",
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await pool.end();
  }
}

async function runBootstrapInteractive(input: {
  fullName: string;
  email: string;
  password: string;
  sendCtrlCAtPassword?: boolean;
}): Promise<BootstrapSession> {
  if (!ptyModule) {
    throw new Error(ptySkipReason ?? "node-pty unavailable");
  }

  return new Promise((resolve, reject) => {
    const outputChunks: string[] = [];
    let fullNameSent = false;
    let emailSent = false;
    let passwordSent = false;

    const shell = ptyModule.spawn(process.execPath, [BOOTSTRAP_BIN], {
      name: "xterm-color",
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: testEnv(),
    });

    shell.onData((data) => {
      outputChunks.push(data);

      if (!fullNameSent && data.includes("ФИО администратора:")) {
        fullNameSent = true;
        shell.write(`${input.fullName}\r`);
        return;
      }

      if (fullNameSent && !emailSent && data.includes("Email администратора:")) {
        emailSent = true;
        shell.write(`${input.email}\r`);
        return;
      }

      if (
        emailSent &&
        !passwordSent &&
        data.includes("Пароль администратора (ввод скрыт):")
      ) {
        passwordSent = true;
        if (input.sendCtrlCAtPassword) {
          shell.write("\u0003");
          return;
        }
        shell.write(`${input.password}\r`);
      }
    });

    shell.onExit(({ exitCode, signal }) => {
      if (exitCode === null && signal !== undefined) {
        resolve({ output: outputChunks.join(""), exitCode: 1 });
        return;
      }
      resolve({ output: outputChunks.join(""), exitCode: exitCode ?? 1 });
    });

    shell.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EIO") {
        return;
      }
      reject(error);
    });
  });
}

describe("bootstrap-admin PTY", { concurrency: false }, () => {
  before(async () => {
    await initPtyModule();
  });

  beforeEach(async () => {
    setIntegrationEnv(databaseUrl);
    resetPoolForTests();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("documents node-pty availability", () => {
    if (ptyModule) {
      assert.ok(true, "node-pty is available for bootstrap PTY tests");
      return;
    }
    assert.ok(ptySkipReason, "Expected explicit PTY skip reason when node-pty is unavailable");
  });

  it("does not echo the password in PTY output", { skip: ptySkipReason }, async () => {
    const session = await runBootstrapInteractive({
      fullName: "Bootstrap Admin",
      email: "pty-admin@test.local",
      password: SECRET_PASSWORD,
    });

    assert.doesNotMatch(session.output, new RegExp(SECRET_PASSWORD));
    assert.equal(session.exitCode, 0);
    assert.match(session.output, /Administrator created successfully/);
    assert.equal(await countAdmins(), 1);
  });

  it("refuses second bootstrap when admin already exists", { skip: ptySkipReason }, async () => {
    const first = await runBootstrapInteractive({
      fullName: "First Admin",
      email: "first-admin@test.local",
      password: SECRET_PASSWORD,
    });
    assert.equal(first.exitCode, 0);
    assert.match(first.output, /Administrator created successfully/);

    const second = await runBootstrapInteractive({
      fullName: "Second Admin",
      email: "second-admin@test.local",
      password: SECRET_PASSWORD,
    });
    assert.notEqual(second.exitCode, 0);
    assert.match(second.output, /Administrator already exists/);
    assert.equal(await countAdmins(), 1);
  });

  it("handles Ctrl+C during hidden password input", { skip: ptySkipReason }, async () => {
    const session = await runBootstrapInteractive({
      fullName: "Interrupted Admin",
      email: "interrupted-admin@test.local",
      password: SECRET_PASSWORD,
      sendCtrlCAtPassword: true,
    });

    assert.notEqual(session.exitCode, 0);
    assert.match(session.output, /Interrupted|Bootstrap failed/);
    assert.equal(await countAdmins(), 0);
  });

  it("refuses concurrent bootstrap attempts with overlapping processes", { skip: ptySkipReason }, async () => {
    const [first, second] = await Promise.all([
      runBootstrapInteractive({
        fullName: "Locked Admin",
        email: "locked-admin@test.local",
        password: SECRET_PASSWORD,
      }),
      runBootstrapInteractive({
        fullName: "Locked Admin Two",
        email: "locked-admin-two@test.local",
        password: SECRET_PASSWORD,
      }),
    ]);

    const outcomes = [first, second].map((session) => session.output).join("\n");
    const successCount = [first, second].filter((session) => session.exitCode === 0).length;

    assert.equal(successCount, 1, "Exactly one concurrent bootstrap should succeed");
    assert.match(outcomes, /Administrator created successfully/);
    assert.match(
      outcomes,
      /Administrator already exists|Another bootstrap process is already running/,
    );
    assert.equal(await countAdmins(), 1);
  });
});
