import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { InsecurePgTlsError } from "../../src/config/pg-ssl";
import {
  createOneOffPgPool,
  databaseNameMismatchBlocker,
  fingerprintFromClusterAndDatabase,
  TargetDbIdentityError,
} from "../../src/onec-exchange-v3/target-db-identity";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("target db identity (exchange v3)", () => {
  it("fingerprint uses cluster system_identifier and database only", () => {
    const a = fingerprintFromClusterAndDatabase("12345", "tandoor_rf_test");
    const b = fingerprintFromClusterAndDatabase("12345", "tandoor_rf_test");
    const c = fingerprintFromClusterAndDatabase("99999", "tandoor_rf_test");
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^[a-f0-9]{64}$/);
  });

  it("does not treat localhost vs server IP as database mismatch when names match", () => {
    const identity = {
      host: "127.0.0.1",
      port: "5432",
      database: "tandoor_rf_test",
      fingerprint: fingerprintFromClusterAndDatabase("1", "tandoor_rf_test"),
      systemIdentifier: "1",
      serverHost: "127.0.0.1",
      serverPort: "5432",
      urlHost: "localhost",
      urlPort: "5432",
    };
    assert.equal(
      databaseNameMismatchBlocker(
        identity,
        "postgresql://postgres:postgres@localhost:5432/tandoor_rf_test",
      ),
      null,
    );
  });

  it("createOneOffPgPool rejects insecure TLS in production", () => {
    process.env.NODE_ENV = "production";
    assert.throws(
      () =>
        createOneOffPgPool(
          "postgresql://user:pass@db.example.com:5432/tandoor_rf?sslmode=disable",
        ),
      InsecurePgTlsError,
    );
  });

  it("flags DATABASE_URL database name different from current_database", () => {
    const identity = {
      host: "localhost",
      port: "5432",
      database: "tandoor_rf_test",
      fingerprint: "abc",
      systemIdentifier: "1",
      serverHost: "localhost",
      serverPort: "5432",
      urlHost: "localhost",
      urlPort: "5432",
    };
    const blocker = databaseNameMismatchBlocker(
      identity,
      "postgresql://postgres:postgres@localhost:5432/other_db",
    );
    assert.ok(blocker);
    assert.match(blocker!, /other_db/);
  });
});
