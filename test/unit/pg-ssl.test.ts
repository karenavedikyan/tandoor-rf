import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  InsecurePgTlsError,
  resolvePgSslConfig,
} from "../../src/config/pg-ssl";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("pg ssl config", () => {
  it("rejects production with PGSSLMODE=disable", () => {
    process.env.NODE_ENV = "production";
    process.env.PGSSLMODE = "disable";
    assert.throws(
      () => resolvePgSslConfig("postgresql://user:pass@db.example.com:5432/tandoor_rf"),
      InsecurePgTlsError,
    );
  });

  it("rejects production with sslmode=disable in URL", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PGSSLMODE;
    assert.throws(
      () =>
        resolvePgSslConfig(
          "postgresql://user:pass@db.example.com:5432/tandoor_rf?sslmode=disable",
        ),
      InsecurePgTlsError,
    );
  });

  it("rejects production with sslmode=no-verify in URL", () => {
    process.env.NODE_ENV = "production";
    assert.throws(
      () =>
        resolvePgSslConfig(
          "postgresql://user:pass@db.example.com:5432/tandoor_rf?sslmode=no-verify",
        ),
      InsecurePgTlsError,
    );
  });

  it("requires TLS with rejectUnauthorized in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PGSSLMODE;
    const ssl = resolvePgSslConfig("postgresql://user:pass@db.example.com:5432/tandoor_rf");
    assert.notEqual(ssl, false);
    assert.equal(ssl.rejectUnauthorized, true);
  });

  it("allows explicit disable for local test mode", () => {
    process.env.NODE_ENV = "test";
    process.env.PGSSLMODE = "disable";
    assert.equal(
      resolvePgSslConfig("postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test"),
      false,
    );
  });

  it("accepts PEM content in PGSSLROOTCERT", () => {
    process.env.NODE_ENV = "production";
    process.env.PGSSLROOTCERT = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----";
    const ssl = resolvePgSslConfig("postgresql://user:pass@db.example.com:5432/tandoor_rf");
    assert.notEqual(ssl, false);
    assert.match(String(ssl.ca), /BEGIN CERTIFICATE/);
  });
});
