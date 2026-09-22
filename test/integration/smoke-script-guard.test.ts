import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { assertTestDatabaseUrl } from "../helpers/test-db";

describe("smoke script database guard", () => {
  it("refuses non-test database names", () => {
    assert.throws(
      () =>
        assertTestDatabaseUrl(
          "postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf",
          "smoke guard test",
        ),
      /Refusing smoke guard test on non-test database/,
    );
  });

  it("smoke-local.sh exits before destructive actions without TEST_DATABASE_URL", () => {
    const result = spawnSync("bash", ["scripts/smoke-local.sh"], {
      env: { ...process.env, TEST_DATABASE_URL: "" },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TEST_DATABASE_URL is required/);
  });

  it("smoke-local.sh refuses production-like DATABASE_URL", () => {
    const result = spawnSync("bash", ["scripts/smoke-local.sh"], {
      env: {
        ...process.env,
        TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf",
      },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /Refusing smoke-local.sh on non-test database/);
  });
});
