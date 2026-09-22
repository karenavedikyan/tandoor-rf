import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Client } from "pg";
import {
  InsecurePgTlsError,
  createPgPoolOptions,
  resolvePgSslConfig,
} from "../../src/config/pg-ssl";

const ORIGINAL_ENV = { ...process.env };

function clientSslFromPoolOptions(databaseUrl: string): unknown {
  const options = createPgPoolOptions(databaseUrl);
  const client = new Client({
    connectionString: options.connectionString,
    ssl: options.ssl === false ? false : options.ssl,
  });
  return client.connectionParameters.ssl;
}

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
    delete process.env.PGSSLMODE;
    process.env.PGSSLROOTCERT = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----";
    const ssl = resolvePgSslConfig("postgresql://user:pass@db.example.com:5432/tandoor_rf");
    assert.notEqual(ssl, false);
    assert.match(String(ssl.ca), /BEGIN CERTIFICATE/);
  });

  it("rejects contradictory sslmode values in URL", () => {
    process.env.NODE_ENV = "production";
    assert.throws(
      () =>
        createPgPoolOptions(
          "postgresql://user:pass@db.example.com:5432/tandoor_rf?sslmode=require&sslmode=disable",
        ),
      InsecurePgTlsError,
    );
  });

  it("rejects production uselibpqcompat in URL", () => {
    process.env.NODE_ENV = "production";
    assert.throws(
      () =>
        createPgPoolOptions(
          "postgresql://user:pass@db.example.com:5432/tandoor_rf?sslmode=require&uselibpqcompat=true",
        ),
      InsecurePgTlsError,
    );
  });

  it("rejects sslmode=no-verify outside production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.PGSSLMODE;
    assert.throws(
      () =>
        createPgPoolOptions(
          "postgresql://user:pass@db.example.com:5432/tandoor_rf?sslmode=no-verify",
        ),
      InsecurePgTlsError,
    );
  });

  it("keeps pg.Client ssl verified in production after stripping URL params", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PGSSLMODE;

    const options = createPgPoolOptions(
      "postgresql://user:pass@db.example.com:5432/tandoor_rf?sslmode=verify-full",
    );
    assert.doesNotMatch(options.connectionString, /sslmode=/);

    const ssl = clientSslFromPoolOptions(
      "postgresql://user:pass@db.example.com:5432/tandoor_rf?sslmode=verify-full",
    );
    assert.deepEqual(ssl, { rejectUnauthorized: true });
  });

  it("prevents pg driver from weakening production TLS via uselibpqcompat", () => {
    process.env.NODE_ENV = "production";
    assert.throws(
      () =>
        clientSslFromPoolOptions(
          "postgresql://user:pass@db.example.com:5432/tandoor_rf?sslmode=require&uselibpqcompat=true",
        ),
      InsecurePgTlsError,
    );
  });

  it("prevents pg driver from disabling TLS via ssl=0 in production", () => {
    process.env.NODE_ENV = "production";
    assert.throws(
      () =>
        clientSslFromPoolOptions(
          "postgresql://user:pass@db.example.com:5432/tandoor_rf?ssl=0",
        ),
      InsecurePgTlsError,
    );
  });

  it("prevents pg driver from downgrading verify-full to no-verify", () => {
    process.env.NODE_ENV = "production";
    assert.throws(
      () =>
        clientSslFromPoolOptions(
          "postgresql://user:pass@db.example.com:5432/tandoor_rf?sslmode=verify-full&sslmode=no-verify",
        ),
      InsecurePgTlsError,
    );
  });

  it("uses PGSSLROOTCERT for pg.Client ssl.ca in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PGSSLMODE;
    process.env.PGSSLROOTCERT = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----";

    const ssl = clientSslFromPoolOptions(
      "postgresql://user:pass@db.example.com:5432/tandoor_rf",
    );
    assert.match(String((ssl as { ca?: string }).ca), /BEGIN CERTIFICATE/);
  });

  it("rejects inline sslrootcert in production DATABASE_URL", () => {
    process.env.NODE_ENV = "production";
    assert.throws(
      () =>
        createPgPoolOptions(
          "postgresql://user:pass@db.example.com:5432/tandoor_rf?sslrootcert=/tmp/ignored.pem",
        ),
      InsecurePgTlsError,
    );
  });

  it("disables TLS for local test URLs after stripping ssl params", () => {
    process.env.NODE_ENV = "test";
    process.env.PGSSLMODE = "disable";

    const options = createPgPoolOptions(
      "postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test?sslmode=disable",
    );
    assert.doesNotMatch(options.connectionString, /sslmode=/);
    assert.equal(options.ssl, false);

    const ssl = clientSslFromPoolOptions(
      "postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test?sslmode=disable",
    );
    assert.equal(ssl, false);
  });
});
