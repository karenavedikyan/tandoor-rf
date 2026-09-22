import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import {
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";

const databaseUrl = getIntegrationDatabaseUrl();
const SECRET_PASSWORD = "PtySecretPass12345";

describe("bootstrap-admin PTY", { concurrency: false }, () => {
  beforeEach(async () => {
    setIntegrationEnv(databaseUrl);
    resetPoolForTests();
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("does not echo the password in PTY output", () => {
    const hasScript = spawnSync("command", ["-v", "script"]);
    if (hasScript.status !== 0) {
      return;
    }

    const result = spawnSync(
      "script",
      ["-q", "-c", "node dist/cli/bootstrap-admin.js", "/dev/null"],
      {
        input: `Bootstrap Admin\npty-admin@test.local\n${SECRET_PASSWORD}\n`,
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          NODE_ENV: "test",
          PGSSLMODE: "disable",
        },
      },
    );

    const combined = `${result.stdout}\n${result.stderr}`;
    assert.doesNotMatch(combined, new RegExp(SECRET_PASSWORD));
    assert.match(combined, /Administrator created successfully|Bootstrap failed/);
  });

  it("refuses second bootstrap when admin already exists", () => {
    const hasScript = spawnSync("command", ["-v", "script"]);
    if (hasScript.status !== 0) {
      return;
    }

    const env = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      PGSSLMODE: "disable",
    };

    const first = spawnSync(
      "script",
      ["-q", "-c", "node dist/cli/bootstrap-admin.js", "/dev/null"],
      {
        input: `First Admin\nfirst-admin@test.local\n${SECRET_PASSWORD}\n`,
        encoding: "utf8",
        env,
      },
    );
    assert.match(first.stdout + first.stderr, /Administrator created successfully/);

    const second = spawnSync(
      "script",
      ["-q", "-c", "node dist/cli/bootstrap-admin.js", "/dev/null"],
      {
        input: `Second Admin\nsecond-admin@test.local\n${SECRET_PASSWORD}\n`,
        encoding: "utf8",
        env,
      },
    );
    assert.match(second.stdout + second.stderr, /Administrator already exists/);
  });

  it("refuses concurrent bootstrap attempts", () => {
    const hasScript = spawnSync("command", ["-v", "script"]);
    if (hasScript.status !== 0) {
      return;
    }

    const env = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      PGSSLMODE: "disable",
    };
    const input = `Locked Admin\nlocked-admin@test.local\n${SECRET_PASSWORD}\n`;

    const first = spawnSync(
      "script",
      ["-q", "-c", "node dist/cli/bootstrap-admin.js", "/dev/null"],
      { input, encoding: "utf8", env },
    );
    assert.match(first.stdout + first.stderr, /Administrator created successfully/);

    const concurrent = spawnSync(
      "script",
      ["-q", "-c", "node dist/cli/bootstrap-admin.js", "/dev/null"],
      { input, encoding: "utf8", env },
    );
    assert.match(
      concurrent.stdout + concurrent.stderr,
      /Administrator already exists|Another bootstrap process is already running/,
    );
  });
});
