import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertTestDatabaseUrl } from "../../src/shared/test-database-guard";

describe("test database guard", () => {
  it("allows the local integration database", () => {
    assert.doesNotThrow(() =>
      assertTestDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test",
        "unit",
      ),
    );
  });

  it("refuses a remote host even when the database name looks like a test database", () => {
    assert.throws(
      () =>
        assertTestDatabaseUrl(
          "postgresql://postgres:postgres@db.example.com:5432/tandoor_rf_test",
          "unit",
        ),
      /non-local database host/,
    );
  });

  it("refuses the interactive demo database", () => {
    assert.throws(
      () =>
        assertTestDatabaseUrl(
          "postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_dev",
          "unit",
        ),
      /non-test database "tandoor_rf_dev"/,
    );
  });
});
