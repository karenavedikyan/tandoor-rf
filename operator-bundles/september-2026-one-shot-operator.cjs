#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/onec-clients/uuid.ts
function normalizeUuid(value) {
  return value.trim().toLowerCase();
}
function isValidNonZeroUuid(value) {
  const normalized = normalizeUuid(value);
  if (normalized === NULL_UUID) {
    return false;
  }
  return UUID_PATTERN.test(normalized);
}
var UUID_PATTERN, NULL_UUID;
var init_uuid = __esm({
  "src/onec-clients/uuid.ts"() {
    "use strict";
    UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    NULL_UUID = "00000000-0000-0000-0000-000000000000";
  }
});

// src/onec-clients/holding-v2-pipeline-config.ts
var init_holding_v2_pipeline_config = __esm({
  "src/onec-clients/holding-v2-pipeline-config.ts"() {
    "use strict";
  }
});

// src/onec-clients/holding-v2-composition.ts
var init_holding_v2_composition = __esm({
  "src/onec-clients/holding-v2-composition.ts"() {
    "use strict";
  }
});

// src/onec-clients/holding-v2-diagnostics.ts
var init_holding_v2_diagnostics = __esm({
  "src/onec-clients/holding-v2-diagnostics.ts"() {
    "use strict";
  }
});

// src/onec-clients/field-value.ts
var init_field_value = __esm({
  "src/onec-clients/field-value.ts"() {
    "use strict";
  }
});

// src/onec-clients/extended-presence.ts
var init_extended_presence = __esm({
  "src/onec-clients/extended-presence.ts"() {
    "use strict";
    init_outlet_identity();
  }
});

// src/onec-clients/outlet-identity.ts
var init_outlet_identity = __esm({
  "src/onec-clients/outlet-identity.ts"() {
    "use strict";
    init_field_value();
    init_extended_presence();
  }
});

// src/onec-clients/holding-v2-structure.ts
var init_holding_v2_structure = __esm({
  "src/onec-clients/holding-v2-structure.ts"() {
    "use strict";
    init_holding_v2_composition();
    init_holding_v2_diagnostics();
    init_outlet_identity();
    init_uuid();
  }
});

// src/onec-clients/holding-v2-reconcile/desired-state.ts
var init_desired_state = __esm({
  "src/onec-clients/holding-v2-reconcile/desired-state.ts"() {
    "use strict";
    init_holding_v2_structure();
    init_uuid();
  }
});

// src/onec-clients/sha256.ts
var init_sha256 = __esm({
  "src/onec-clients/sha256.ts"() {
    "use strict";
  }
});

// src/onec-clients/holding-v2-reconcile/normalized-state.ts
var init_normalized_state = __esm({
  "src/onec-clients/holding-v2-reconcile/normalized-state.ts"() {
    "use strict";
    init_sha256();
  }
});

// src/onec-clients/holding-v2-reconcile/type-category-merge.ts
var init_type_category_merge = __esm({
  "src/onec-clients/holding-v2-reconcile/type-category-merge.ts"() {
    "use strict";
  }
});

// src/onec-clients/holding-v2-reconcile/projected-state.ts
var init_projected_state = __esm({
  "src/onec-clients/holding-v2-reconcile/projected-state.ts"() {
    "use strict";
    init_type_category_merge();
  }
});

// src/onec-clients/holding-v2-reconcile/repository.ts
var init_repository = __esm({
  "src/onec-clients/holding-v2-reconcile/repository.ts"() {
    "use strict";
  }
});

// src/onec-clients/client-code-exchange-fields.ts
var init_client_code_exchange_fields = __esm({
  "src/onec-clients/client-code-exchange-fields.ts"() {
    "use strict";
  }
});

// src/onec-clients/client-contract-exchange-fields.ts
var init_client_contract_exchange_fields = __esm({
  "src/onec-clients/client-contract-exchange-fields.ts"() {
    "use strict";
  }
});

// src/onec-clients/counterparty-exchange-fields.ts
var init_counterparty_exchange_fields = __esm({
  "src/onec-clients/counterparty-exchange-fields.ts"() {
    "use strict";
  }
});

// src/onec-clients/wholesale-client-exchange-fields.ts
var init_wholesale_client_exchange_fields = __esm({
  "src/onec-clients/wholesale-client-exchange-fields.ts"() {
    "use strict";
  }
});

// src/onec-clients/holding-link-policy.ts
var init_holding_link_policy = __esm({
  "src/onec-clients/holding-link-policy.ts"() {
    "use strict";
  }
});

// src/onec-clients/import-verification-fingerprint.ts
var init_import_verification_fingerprint = __esm({
  "src/onec-clients/import-verification-fingerprint.ts"() {
    "use strict";
    init_holding_link_policy();
  }
});

// src/onec-clients/roster-field-values.ts
var init_roster_field_values = __esm({
  "src/onec-clients/roster-field-values.ts"() {
    "use strict";
    init_roster_team_memberships();
  }
});

// src/onec-clients/roster-team-memberships.ts
var init_roster_team_memberships = __esm({
  "src/onec-clients/roster-team-memberships.ts"() {
    "use strict";
    init_roster_field_values();
    init_uuid();
  }
});

// src/onec-clients/roster-upsert.ts
var init_roster_upsert = __esm({
  "src/onec-clients/roster-upsert.ts"() {
    "use strict";
    init_roster_team_memberships();
    init_roster_field_values();
  }
});

// src/onec-sales/september-2026-one-shot/one-shot-operator-cli-entry.ts
var import_node_fs = require("node:fs");

// src/onec-exchange-v3/target-db-identity.ts
var import_node_crypto = require("node:crypto");
var import_pg = require("pg");

// src/config/pg-ssl.ts
var import_fs = __toESM(require("fs"));

// src/config.ts
var SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var LOGIN_RATE_WINDOW_MS = 15 * 60 * 1e3;
var LOGIN_LOCK_MS = 15 * 60 * 1e3;
var LOGIN_RATE_RETENTION_MS = 24 * 60 * 60 * 1e3;
function isProduction() {
  return process.env.NODE_ENV === "production";
}

// src/config/pg-ssl.ts
var InsecurePgTlsError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InsecurePgTlsError";
  }
};
var SSL_QUERY_PARAMS = [
  "sslmode",
  "ssl",
  "uselibpqcompat",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslnegotiation"
];
function parseDatabaseUrl(databaseUrl) {
  try {
    return new URL(databaseUrl);
  } catch {
    throw new InsecurePgTlsError("Invalid DATABASE_URL.");
  }
}
function collectSslUrlSignals(parsed) {
  const sslmodes = parsed.searchParams.getAll("sslmode").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const sslValues = parsed.searchParams.getAll("ssl").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const uselibpqcompat = parsed.searchParams.get("uselibpqcompat")?.trim().toLowerCase() ?? null;
  const hasSslMaterial = ["sslcert", "sslkey", "sslrootcert"].some(
    (param) => parsed.searchParams.has(param)
  );
  return { sslmodes, sslValues, uselibpqcompat, hasSslMaterial };
}
function effectiveUrlSslMode(signals) {
  return signals.sslmodes.at(-1) ?? null;
}
function urlRequestsDisable(signals) {
  const sslMode = effectiveUrlSslMode(signals);
  if (sslMode === "disable") {
    return true;
  }
  return signals.sslValues.some((value) => value === "0" || value === "false");
}
function urlRequestsNoVerify(signals) {
  const sslMode = effectiveUrlSslMode(signals);
  if (sslMode === "no-verify") {
    return true;
  }
  if (signals.uselibpqcompat === "true") {
    return sslMode === "require" || sslMode === "prefer" || sslMode === null;
  }
  return false;
}
function assertSslUrlSignalsAllowed(signals) {
  if (signals.sslmodes.length > 1 && new Set(signals.sslmodes).size > 1) {
    throw new InsecurePgTlsError("Contradictory sslmode values in DATABASE_URL.");
  }
  if (signals.sslValues.length > 1 && new Set(signals.sslValues).size > 1) {
    throw new InsecurePgTlsError("Contradictory ssl values in DATABASE_URL.");
  }
  const sslMode = effectiveUrlSslMode(signals);
  const sslDisabled = urlRequestsDisable(signals);
  if (sslDisabled && sslMode && sslMode !== "disable") {
    throw new InsecurePgTlsError("Contradictory SSL settings in DATABASE_URL.");
  }
  if (sslDisabled && urlRequestsNoVerify(signals)) {
    throw new InsecurePgTlsError("Contradictory SSL settings in DATABASE_URL.");
  }
  if (isProduction()) {
    if (sslDisabled || urlRequestsNoVerify(signals)) {
      throw new InsecurePgTlsError(
        "Insecure PostgreSQL TLS settings are not allowed in production."
      );
    }
    if (signals.uselibpqcompat === "true") {
      throw new InsecurePgTlsError(
        "uselibpqcompat is not allowed in production DATABASE_URL."
      );
    }
    if (signals.hasSslMaterial) {
      throw new InsecurePgTlsError(
        "Inline SSL certificate parameters are not allowed in production DATABASE_URL."
      );
    }
  }
}
function sanitizePgConnectionString(databaseUrl) {
  const parsed = parseDatabaseUrl(databaseUrl);
  const signals = collectSslUrlSignals(parsed);
  assertSslUrlSignalsAllowed(signals);
  for (const param of SSL_QUERY_PARAMS) {
    parsed.searchParams.delete(param);
  }
  return parsed.toString();
}
function resolvePgCa() {
  const raw = process.env.PGSSLROOTCERT?.trim();
  if (!raw) {
    return void 0;
  }
  if (raw.includes("-----BEGIN")) {
    return raw;
  }
  return import_fs.default.readFileSync(raw, "utf8");
}
function resolvePgSslConfig(databaseUrl) {
  const parsed = parseDatabaseUrl(databaseUrl);
  const signals = collectSslUrlSignals(parsed);
  assertSslUrlSignalsAllowed(signals);
  const envSslMode = process.env.PGSSLMODE?.trim().toLowerCase() ?? null;
  const disableRequested = envSslMode === "disable" || urlRequestsDisable(signals);
  const noVerifyRequested = envSslMode === "no-verify" || urlRequestsNoVerify(signals);
  if (isProduction()) {
    if (disableRequested || noVerifyRequested) {
      throw new InsecurePgTlsError(
        "Insecure PostgreSQL TLS settings are not allowed in production."
      );
    }
    const ca2 = resolvePgCa();
    return ca2 ? { rejectUnauthorized: true, ca: ca2 } : { rejectUnauthorized: true };
  }
  if (noVerifyRequested) {
    throw new InsecurePgTlsError(
      "sslmode=no-verify is not supported. Use PGSSLMODE=disable only for local/test."
    );
  }
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  if (disableRequested || nodeEnv === "test" || nodeEnv === "development") {
    return false;
  }
  const ca = resolvePgCa();
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}
function createPgPoolOptions(databaseUrl) {
  const connectionString = sanitizePgConnectionString(databaseUrl);
  return {
    connectionString,
    ssl: resolvePgSslConfig(databaseUrl)
  };
}

// src/onec-exchange-v3/target-db-fingerprint.ts
function parseTargetDbDescriptor(databaseUrl) {
  try {
    const normalized = databaseUrl.replace(/^postgresql:/i, "postgres:");
    const url = new URL(normalized);
    const database = url.pathname.replace(/^\//, "").split("/")[0] ?? "";
    if (!database) {
      return null;
    }
    return {
      host: url.hostname || "localhost",
      port: url.port || "5432",
      database
    };
  } catch {
    return null;
  }
}

// src/onec-exchange-v3/target-db-identity.ts
var ONE_OFF_QUERY_TIMEOUT_MS = 1e4;
var TargetDbIdentityError = class extends Error {
  code;
  timeoutKind;
  discardConnection;
  constructor(code, message, options) {
    super(message, options?.cause !== void 0 ? { cause: options.cause } : void 0);
    this.name = "TargetDbIdentityError";
    this.code = code;
    this.timeoutKind = options?.timeoutKind;
    this.discardConnection = options?.discardConnection ?? false;
  }
};
function fingerprintFromClusterAndDatabase(systemIdentifier, database) {
  const canonical = `pg|${systemIdentifier}|${database}`;
  return (0, import_node_crypto.createHash)("sha256").update(canonical, "utf8").digest("hex");
}
function pgQueryWithTimeout(client, text, queryTimeoutMs, values) {
  return client.query({
    text,
    values,
    query_timeout: queryTimeoutMs
  });
}
function isPgRawTransportOrQueryTimeout(error) {
  const msg = error instanceof Error ? error.message : String(error);
  return /Query read timeout|query timeout|timeout exceeded|connection terminated|ECONNRESET|ETIMEDOUT/i.test(
    msg
  );
}
function mapIdentityQueryError(error) {
  if (error instanceof TargetDbIdentityError) {
    throw error;
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (/canceling statement due to statement timeout/i.test(msg)) {
    throw new TargetDbIdentityError(
      "TARGET_DB_IDENTITY_TIMEOUT",
      "\u041F\u0440\u0435\u0432\u044B\u0448\u0435\u043D\u043E \u0432\u0440\u0435\u043C\u044F \u0447\u0442\u0435\u043D\u0438\u044F \u0438\u0434\u0435\u043D\u0442\u0438\u0447\u043D\u043E\u0441\u0442\u0438 \u0411\u0414 (statement_timeout)",
      {
        timeoutKind: "server_statement",
        discardConnection: false,
        cause: error
      }
    );
  }
  if (isPgRawTransportOrQueryTimeout(error)) {
    throw new TargetDbIdentityError(
      "TARGET_DB_IDENTITY_TIMEOUT",
      "\u041F\u0440\u0435\u0432\u044B\u0448\u0435\u043D\u043E \u0432\u0440\u0435\u043C\u044F \u0447\u0442\u0435\u043D\u0438\u044F \u0438\u0434\u0435\u043D\u0442\u0438\u0447\u043D\u043E\u0441\u0442\u0438 \u0411\u0414",
      {
        timeoutKind: "client_transport",
        discardConnection: true,
        cause: error
      }
    );
  }
  if (/permission denied|must be superuser|pg_control_system/i.test(msg)) {
    throw new TargetDbIdentityError(
      "TARGET_DB_IDENTITY_UNAVAILABLE",
      "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u043F\u0440\u0430\u0432 \u0434\u043B\u044F \u0447\u0442\u0435\u043D\u0438\u044F \u0438\u0434\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u043E\u0440\u0430 \u043A\u043B\u0430\u0441\u0442\u0435\u0440\u0430 (pg_control_system); \u043F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0440\u043E\u043B\u044C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F",
      { discardConnection: false, cause: error }
    );
  }
  throw error;
}
async function readTargetDbIdentityFromClient(client, databaseUrl, options) {
  const queryTimeoutMs = options?.queryTimeoutMs ?? ONE_OFF_QUERY_TIMEOUT_MS;
  try {
    if (options?.testPreSleepSec && options.testPreSleepSec > 0) {
      await pgQueryWithTimeout(
        client,
        `SELECT pg_sleep($1::double precision)`,
        queryTimeoutMs,
        [options.testPreSleepSec]
      );
    }
    const row = await pgQueryWithTimeout(
      client,
      `SELECT current_database() AS db,
              COALESCE(host(inet_server_addr())::text, '') AS host,
              COALESCE(inet_server_port()::text, '5432') AS port,
              (SELECT system_identifier::text FROM pg_control_system()) AS system_id`,
      queryTimeoutMs
    );
    const database = row.rows[0]?.db?.trim() ?? "";
    const systemIdentifier = row.rows[0]?.system_id?.trim() ?? "";
    if (!database || !systemIdentifier) {
      throw new TargetDbIdentityError(
        "TARGET_DB_IDENTITY_UNAVAILABLE",
        "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0438\u0442\u044C \u0438\u0434\u0435\u043D\u0442\u0438\u0447\u043D\u043E\u0441\u0442\u044C \u0446\u0435\u043B\u0435\u0432\u043E\u0439 \u0411\u0414",
        { discardConnection: false }
      );
    }
    const urlDesc = databaseUrl ? parseTargetDbDescriptor(databaseUrl) : null;
    const serverHost = row.rows[0]?.host?.trim() || urlDesc?.host || "localhost";
    const serverPort = row.rows[0]?.port?.trim() || urlDesc?.port || "5432";
    return {
      host: serverHost,
      port: serverPort,
      database,
      systemIdentifier,
      serverHost,
      serverPort,
      urlHost: urlDesc?.host ?? "",
      urlPort: urlDesc?.port ?? "",
      fingerprint: fingerprintFromClusterAndDatabase(systemIdentifier, database)
    };
  } catch (error) {
    mapIdentityQueryError(error);
  }
}

// src/onec-sales/matched-only/production/read-only-session.ts
var PREFLIGHT_STATEMENT_TIMEOUT_MS = 3e4;
var PREFLIGHT_LOCK_TIMEOUT_MS = 5e3;
async function withReadOnlyPreflightSession(pool, work) {
  const client = await pool.connect();
  let txOpen = false;
  try {
    await client.query(`SET statement_timeout = '${PREFLIGHT_STATEMENT_TIMEOUT_MS}ms'`);
    await client.query(`SET lock_timeout = '${PREFLIGHT_LOCK_TIMEOUT_MS}ms'`);
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    txOpen = true;
    const result = await work(client);
    await client.query("COMMIT");
    txOpen = false;
    return result;
  } catch (error) {
    if (txOpen) {
      await client.query("ROLLBACK").catch(() => void 0);
    }
    throw error;
  } finally {
    client.release();
  }
}

// src/onec-sales/september-2026-one-shot/read-only-preflight-core.ts
var import_pg2 = require("pg");

// src/onec-sales/september-2026-one-shot/scope-pins.ts
var SEPTEMBER_2026_SALE_MONTH_ISO = "2026-09-01";
var TIMEWEB_APP_ID = 258307;
var TIMEWEB_DB_ID = 4212461;
var EXPECTED_TARGET_DB_FINGERPRINT = "42946d0cc9e541918783dbd963c483227afb20428cad51af64481c3b2ab38f0f";
var EXPECTED_CATALOG_LEGAL_ENTITY_COUNT = 2747;
var EXPECTED_CATALOG_GUID_SET_SHA256 = "33cd0d4220afdbd310b54db4564117ee4112f58305bb022e104e80f450c607be";
var EXPECTED_UNKNOWN_CATALOG_GUID_COUNT = 414;
var FIXED_SOURCE_SNAPSHOT_DIRECTORY = "/tmp/tandoor-source-snapshot-20261024-4c64a1a4";
var EXPECTED_SOURCE_MANIFEST_SHA256 = "cb390602949e493ce678706c471dc19bd502c7eb3ff1886b250eb0791b556cb5";
var EXPECTED_OPERATOR_DATA_SCOPE_SHA256 = "f1daa71dce9172f93ab8590148634c0d09013ae07b60f5f8a6675392c793d9aa";
var EXPECTED_EMPTY_BEFORE_STATE_DIGEST = "b8b0946873bc8079c559c9b5f746e7388bfa6c4555c2d33bcc611947b14b8ce5";
var EXPECTED_MATCHED_ROW_TOTAL = 28556;
var EXPECTED_EXCLUDED_ROW_TOTAL = 4024;
var EXPECTED_APPLY_MATCHED_ROWS = {
  saleAggregate: 3416,
  saleItems: 24030,
  returnsAggregate: 413,
  returnItems: 697
};
var EXPECTED_SOURCE_FILES = {
  saleAggregate: {
    path: "/LC/sale/sale.json",
    fileName: "sale.json",
    sha256: "93892acff9ae8c99aba3cd6d78257e6c9e68c320d65b387cb085a8910c784361",
    counts: { full: 4415, matched: 3416, excluded: 999 }
  },
  saleItems: {
    path: "/LC/sale/sale(items).json",
    fileName: "sale(items).json",
    sha256: "63dc03737858ddabe34aa0f7e7001caeefe8f7b961eb9f264c8ba545dda43def",
    counts: { full: 26928, matched: 24030, excluded: 2898 }
  },
  returnsAggregate: {
    path: "/LC/sale/returne.json",
    fileName: "returne.json",
    sha256: "dc31bbb982e081b26c0587163164303f6e14c083ee55b1f69760eadc7e161dbb",
    counts: { full: 462, matched: 413, excluded: 49 }
  },
  returnItems: {
    path: "/LC/sale/returne(items).json",
    fileName: "returne(items).json",
    sha256: "755560ee94a1001802cee6c91e5ddca40a296447f011999a76fa97d6bb7e7164",
    counts: { full: 775, matched: 697, excluded: 78 }
  }
};
var REQUIRED_MIGRATIONS_047_048 = [
  "047_onec_v3_legal_sales_items_returns.sql",
  "048_onec_v3_sales_month_activation.sql"
];
var APP_RELEASE_REF_FOR_COMPATIBILITY = "6109c1a23a2528a1471da92c4a126b492ff6ca84";

// src/onec-sales/september-2026-one-shot/schema-047-048.ts
async function assertSchema047048Ready(client) {
  const applied = await client.query(
    `SELECT filename FROM schema_migrations WHERE filename = ANY($1::text[])`,
    [REQUIRED_MIGRATIONS_047_048]
  );
  const have = new Set(applied.rows.map((r) => r.filename));
  const missing = REQUIRED_MIGRATIONS_047_048.filter((f) => !have.has(f));
  if (missing.length > 0) {
    return {
      ok: false,
      code: "SCHEMA_047_048_NOT_READY",
      message: `Missing migrations: ${missing.join(", ")}`
    };
  }
  const tables = [
    "onec_v3_legal_sales_lines",
    "onec_v3_legal_sale_item_lines",
    "onec_v3_legal_return_lines",
    "onec_v3_legal_return_item_lines",
    "onec_v3_legal_sales_import_state",
    "onec_v3_legal_sale_item_import_state",
    "onec_v3_legal_return_import_state",
    "onec_v3_legal_return_item_import_state",
    "onec_v3_legal_sales_month_activation"
  ];
  for (const table of tables) {
    await client.query(`SELECT 1 FROM ${table} LIMIT 0`);
  }
  return { ok: true };
}

// src/onec-sales/september-2026-one-shot/catalog-pin.ts
var import_node_crypto2 = require("node:crypto");
function catalogGuidSetSha256FromRows(guids) {
  const sorted = guids.map((g) => g.toLowerCase()).sort();
  return (0, import_node_crypto2.createHash)("sha256").update(JSON.stringify(sorted), "utf8").digest("hex");
}
async function verifyCatalogPin(client) {
  const rows = await client.query(
    `SELECT lower(guid_client::text) AS guid_client FROM onec_v3_legal_entities ORDER BY guid_client`
  );
  const guids = rows.rows.map((r) => r.guid_client);
  if (guids.length !== EXPECTED_CATALOG_LEGAL_ENTITY_COUNT) {
    return {
      ok: false,
      code: "CATALOG_COUNT_MISMATCH",
      message: `Expected ${EXPECTED_CATALOG_LEGAL_ENTITY_COUNT} legal entities, found ${guids.length}.`
    };
  }
  const sha256 = catalogGuidSetSha256FromRows(guids);
  if (sha256 !== EXPECTED_CATALOG_GUID_SET_SHA256) {
    return {
      ok: false,
      code: "CATALOG_SHA_MISMATCH",
      message: "Catalog GUID set SHA256 does not match frozen operator pin."
    };
  }
  return { ok: true, count: guids.length, sha256 };
}

// src/onec-sales/matched-only/canonical-json.ts
var import_node_crypto3 = require("node:crypto");
function sha256CanonicalJson(value) {
  const canonical = stableStringify(value);
  return (0, import_node_crypto3.createHash)("sha256").update(canonical, "utf8").digest("hex");
}
function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}
function sortValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  const record = value;
  const sorted = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortValue(record[key]);
  }
  return sorted;
}

// src/onec-sales/september-2026-one-shot/scoped-pg-json-snapshot.ts
async function capturePgJsonRowset(client, sql, params = []) {
  const result = await client.query(sql, params);
  const text = result.rows[0]?.snapshot_json;
  if (text === void 0 || text === null) {
    return "[]";
  }
  return text;
}
async function restorePgJsonRowset(client, tableName, jsonText) {
  if (jsonText === "[]") {
    return;
  }
  await client.query(
    `
      INSERT INTO ${tableName}
      SELECT *
      FROM json_populate_recordset(null::${tableName}, $1::json)
    `,
    [jsonText]
  );
}

// src/onec-sales/september-2026-one-shot/before-state-047-048.ts
async function captureSeptember047048BeforeState(client) {
  const months = [SEPTEMBER_2026_SALE_MONTH_ISO];
  const [
    saleAggregateLinesJson,
    saleItemLinesJson,
    returnLinesJson,
    returnItemLinesJson,
    importStatesJson,
    monthActivationsJson
  ] = await Promise.all([
    capturePgJsonRowset(
      client,
      `
        SELECT COALESCE(
          (SELECT json_agg(row_to_json(t) ORDER BY t.legal_guid, t.sale_month, t.product_type)::text
           FROM onec_v3_legal_sales_lines t
           WHERE t.sale_month = ANY($1::date[])),
          '[]'
        ) AS snapshot_json
      `,
      [months]
    ),
    capturePgJsonRowset(
      client,
      `
        SELECT COALESCE(
          (SELECT json_agg(row_to_json(t) ORDER BY t.source_sha256, t.source_row_index)::text
           FROM onec_v3_legal_sale_item_lines t
           WHERE t.sale_month = ANY($1::date[])),
          '[]'
        ) AS snapshot_json
      `,
      [months]
    ),
    capturePgJsonRowset(
      client,
      `
        SELECT COALESCE(
          (SELECT json_agg(row_to_json(t) ORDER BY t.source_sha256, t.source_row_index)::text
           FROM onec_v3_legal_return_lines t
           WHERE t.sale_month = ANY($1::date[])),
          '[]'
        ) AS snapshot_json
      `,
      [months]
    ),
    capturePgJsonRowset(
      client,
      `
        SELECT COALESCE(
          (SELECT json_agg(row_to_json(t) ORDER BY t.source_sha256, t.source_row_index)::text
           FROM onec_v3_legal_return_item_lines t
           WHERE t.sale_month = ANY($1::date[])),
          '[]'
        ) AS snapshot_json
      `,
      [months]
    ),
    capturePgJsonRowset(
      client,
      `
        SELECT COALESCE(
          (SELECT json_agg(row_to_json(x) ORDER BY x.dataset)::text
           FROM (
             SELECT 'sale_aggregate'::text AS dataset, s.source_sha256, s.row_count, s.imported_at
             FROM onec_v3_legal_sales_import_state s WHERE s.id = 1
             UNION ALL
             SELECT 'sale_items', s.source_sha256, s.row_count, s.imported_at
             FROM onec_v3_legal_sale_item_import_state s WHERE s.id = 1
             UNION ALL
             SELECT 'return_aggregate', s.source_sha256, s.row_count, s.imported_at
             FROM onec_v3_legal_return_import_state s WHERE s.id = 1
             UNION ALL
             SELECT 'return_items', s.source_sha256, s.row_count, s.imported_at
             FROM onec_v3_legal_return_item_import_state s WHERE s.id = 1
           ) x),
          '[]'
        ) AS snapshot_json
      `
    ),
    capturePgJsonRowset(
      client,
      `
        SELECT COALESCE(
          (SELECT json_agg(row_to_json(t) ORDER BY t.dataset, t.sale_month)::text
           FROM onec_v3_legal_sales_month_activation t
           WHERE t.sale_month = ANY($1::date[])),
          '[]'
        ) AS snapshot_json
      `,
      [months]
    )
  ]);
  const snapshot = {
    v: 2,
    saleMonthIso: SEPTEMBER_2026_SALE_MONTH_ISO,
    saleAggregateLinesJson,
    saleItemLinesJson,
    returnLinesJson,
    returnItemLinesJson,
    importStatesJson,
    monthActivationsJson
  };
  return { digest: sha256CanonicalJson(snapshot), snapshot };
}

// src/onec-sales/september-2026-one-shot/source-pins.ts
var import_node_crypto8 = require("node:crypto");

// src/onec-sales/parse-sale-json.ts
var import_node_crypto4 = require("node:crypto");

// src/onec-sales/client-info-legal-guid.ts
init_uuid();
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseUuidField(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!isValidNonZeroUuid(trimmed)) {
    return null;
  }
  return normalizeUuid(trimmed);
}
function readLegalEntityGuidFromClientInfo(clientInfo) {
  if (!isPlainObject(clientInfo)) {
    return { ok: false, code: "MISSING_CLIENT_INFO" };
  }
  const guidParsed = parseUuidField(clientInfo.guid);
  const idParsed = parseUuidField(clientInfo.id);
  const hasGuidKey = "guid" in clientInfo && clientInfo.guid != null && String(clientInfo.guid).trim() !== "";
  const hasIdKey = "id" in clientInfo && clientInfo.id != null && String(clientInfo.id).trim() !== "";
  if (hasGuidKey && hasIdKey && guidParsed && idParsed && guidParsed !== idParsed) {
    return { ok: false, code: "CLIENT_INFO_GUID_ID_CONFLICT" };
  }
  if (hasGuidKey) {
    if (!guidParsed) {
      return { ok: false, code: "INVALID_LEGAL_GUID" };
    }
    return { ok: true, legalGuid: guidParsed, source: "guid" };
  }
  if (hasIdKey) {
    if (!idParsed) {
      return { ok: false, code: "INVALID_LEGAL_GUID" };
    }
    return { ok: true, legalGuid: idParsed, source: "legacy_id" };
  }
  return { ok: false, code: "INVALID_LEGAL_GUID" };
}

// src/onec-clients/constants.ts
var MAX_SOURCE_BYTES = 32 * 1024 * 1024;
var IMPORT_ADVISORY_LOCK_KEY = 902451002;

// src/onec-sales/constants.ts
var MAX_LEGAL_SALES_BYTES = MAX_SOURCE_BYTES;

// src/onec-sales/parse-sale-shared.ts
init_uuid();

// src/onec-catalog/decimal.ts
var NUMERIC_INTEGER_DIGITS = 14;
var NUMERIC_FRACTION_DIGITS = 4;
function parseCatalogDecimal(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, raw: trimmed, code: "EMPTY" };
  }
  if (!/^-?\d+(,\d+)?$/.test(trimmed)) {
    return { ok: false, raw: trimmed, code: "INVALID_FORMAT" };
  }
  const normalized = trimmed.replace(",", ".");
  const sign = normalized.startsWith("-") ? "-" : "";
  const unsigned = sign ? normalized.slice(1) : normalized;
  const [integerPart, fractionPart = ""] = unsigned.split(".");
  if (integerPart.length > NUMERIC_INTEGER_DIGITS) {
    return { ok: false, raw: trimmed, code: "NUMERIC_OVERFLOW" };
  }
  if (fractionPart.length > NUMERIC_FRACTION_DIGITS) {
    return { ok: false, raw: trimmed, code: "NUMERIC_SCALE" };
  }
  return { ok: true, numeric: `${sign}${unsigned}`, raw: trimmed };
}

// src/onec-sales/decimal.ts
function parseSaleDecimal(value) {
  if (value === null || value === void 0) {
    return { ok: false, raw: "", code: "EMPTY" };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { ok: false, raw: String(value), code: "INVALID_FORMAT" };
    }
    const raw = String(value);
    if (raw.includes("e") || raw.includes("E")) {
      return { ok: false, raw, code: "INVALID_FORMAT" };
    }
    return parseCatalogDecimal(raw.replace(".", ","));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.includes(".")) {
      return parseCatalogDecimal(trimmed.replace(".", ","));
    }
    return parseCatalogDecimal(trimmed);
  }
  return { ok: false, raw: String(value), code: "INVALID_FORMAT" };
}
var NUMERIC_SCALE = 4;
function canonicalSaleDecimalNumeric(numeric) {
  const sign = numeric.startsWith("-") ? "-" : "";
  const unsigned = sign ? numeric.slice(1) : numeric;
  const [integerPart, fractionPart = ""] = unsigned.split(".");
  const paddedFraction = fractionPart.padEnd(NUMERIC_SCALE, "0").slice(0, NUMERIC_SCALE);
  return `${sign}${integerPart}.${paddedFraction}`;
}
function saleDecimalStringsEqual(a, b) {
  const left = parseSaleDecimal(a);
  const right = parseSaleDecimal(b);
  if (!left.ok || !right.ok) {
    return a === b;
  }
  return canonicalSaleDecimalNumeric(left.numeric) === canonicalSaleDecimalNumeric(right.numeric);
}

// src/shared/calendar-date.ts
function isValidCalendarParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}
function parseCalendarDateInput(value) {
  if (value === null || value === void 0) {
    return { ok: false, code: "EMPTY" };
  }
  if (typeof value !== "string") {
    return { ok: false, code: "INVALID_TYPE" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: "EMPTY" };
  }
  if (/[Zz]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return { ok: false, code: "INVALID_DATE_FORMAT" };
  }
  const dotted = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(trimmed);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    const year = Number(dotted[3]);
    if (!isValidCalendarParts(year, month, day)) {
      return { ok: false, code: "INVALID_DATE_FORMAT" };
    }
    const isoDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { ok: true, isoDate };
  }
  const dateTimeMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (dateTimeMatch) {
    const [, datePart, hour, minute, second] = dateTimeMatch;
    if (!isValidCalendarParts(
      Number(datePart.slice(0, 4)),
      Number(datePart.slice(5, 7)),
      Number(datePart.slice(8, 10))
    ) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
      return { ok: false, code: "INVALID_DATE_FORMAT" };
    }
    return { ok: true, isoDate: datePart };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(5, 7));
    const day = Number(trimmed.slice(8, 10));
    if (!isValidCalendarParts(year, month, day)) {
      return { ok: false, code: "INVALID_DATE_FORMAT" };
    }
    return { ok: true, isoDate: trimmed };
  }
  return { ok: false, code: "INVALID_DATE_FORMAT" };
}

// src/onec-sales/sale-month.ts
function normalizeSaleMonth(value) {
  if (value === null || value === void 0) {
    return { ok: false, code: "EMPTY" };
  }
  if (typeof value !== "string") {
    return { ok: false, code: "INVALID_TYPE" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: "EMPTY" };
  }
  const yyyyMmOnly = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (yyyyMmOnly) {
    const year = Number(yyyyMmOnly[1]);
    const month = Number(yyyyMmOnly[2]);
    if (month < 1 || month > 12) {
      return { ok: false, code: "INVALID_MONTH" };
    }
    const monthStartIso = `${yyyyMmOnly[1]}-${yyyyMmOnly[2]}-01`;
    return { ok: true, yyyyMm: `${yyyyMmOnly[1]}-${yyyyMmOnly[2]}`, monthStartIso };
  }
  const parsed = parseCalendarDateInput(trimmed);
  if (!parsed.ok) {
    return { ok: false, code: "INVALID_MONTH" };
  }
  const yyyyMm = parsed.isoDate.slice(0, 7);
  return { ok: true, yyyyMm, monthStartIso: `${yyyyMm}-01` };
}

// src/onec-sales/parse-sale-shared.ts
function isPlainObject2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readProductType(info) {
  const value = info.type;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function readMonthFields(raw, inner) {
  const top = "month" in raw ? normalizeSaleMonth(raw.month) : null;
  const nested = "month" in inner ? normalizeSaleMonth(inner.month) : null;
  if (top && !top.ok && nested && nested.ok) {
    return nested;
  }
  if (nested && !nested.ok && top && top.ok) {
    return top;
  }
  if (top && top.ok && nested && nested.ok && top.yyyyMm !== nested.yyyyMm) {
    return { ok: false, code: "MONTH_FIELD_CONFLICT" };
  }
  if (top && top.ok) {
    return top;
  }
  if (nested && nested.ok) {
    return nested;
  }
  if (top && !top.ok) {
    return top;
  }
  if (nested && !nested.ok) {
    return nested;
  }
  return { ok: false, code: "EMPTY" };
}
function readSaleMetrics(saleInfo, index) {
  if (!isPlainObject2(saleInfo.discounts)) {
    return { ok: false, message: `Missing sale_info.discounts at index ${index}.` };
  }
  const numericFields = {
    quantity: parseSaleDecimal(saleInfo.quantity),
    income: parseSaleDecimal(saleInfo.income),
    manualDiscount: parseSaleDecimal(saleInfo.discounts.manual_discount),
    automaticDiscount: parseSaleDecimal(saleInfo.discounts.automatic_discount),
    totalDiscount: parseSaleDecimal(saleInfo.discounts.total_discount),
    costPrice: parseSaleDecimal(saleInfo.cost_price),
    additionalExpenses: parseSaleDecimal(saleInfo.additional_expenses),
    grossProfit: parseSaleDecimal(saleInfo.gross_profit),
    profitability: parseSaleDecimal(saleInfo.profitability)
  };
  for (const [field, result] of Object.entries(numericFields)) {
    if (!result.ok) {
      return { ok: false, message: `Invalid ${field} at index ${index}.` };
    }
  }
  return {
    ok: true,
    metrics: {
      quantity: numericFields.quantity.ok ? numericFields.quantity.numeric : "0",
      income: numericFields.income.ok ? numericFields.income.numeric : "0",
      manualDiscount: numericFields.manualDiscount.ok ? numericFields.manualDiscount.numeric : "0",
      automaticDiscount: numericFields.automaticDiscount.ok ? numericFields.automaticDiscount.numeric : "0",
      totalDiscount: numericFields.totalDiscount.ok ? numericFields.totalDiscount.numeric : "0",
      costPrice: numericFields.costPrice.ok ? numericFields.costPrice.numeric : "0",
      additionalExpenses: numericFields.additionalExpenses.ok ? numericFields.additionalExpenses.numeric : "0",
      grossProfit: numericFields.grossProfit.ok ? numericFields.grossProfit.numeric : "0",
      profitability: numericFields.profitability.ok ? numericFields.profitability.numeric : "0"
    }
  };
}
function readGuidItem(saleInfo) {
  const raw = saleInfo.guid_item;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!isValidNonZeroUuid(trimmed)) {
    return null;
  }
  return normalizeUuid(trimmed);
}
function readNameItem(saleInfo) {
  const raw = saleInfo.name_item;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// src/onec-sales/parse-sale-json.ts
function lineKey(legalGuid, yyyyMm, productType) {
  return `${legalGuid.toLowerCase()}|${yyyyMm}|${productType}`;
}
function linesEqual(a, b) {
  return a.quantity === b.quantity && a.income === b.income && a.manualDiscount === b.manualDiscount && a.automaticDiscount === b.automaticDiscount && a.totalDiscount === b.totalDiscount && a.costPrice === b.costPrice && a.additionalExpenses === b.additionalExpenses && a.grossProfit === b.grossProfit && a.profitability === b.profitability;
}
function parseLegalSalesJsonBytes(bytes) {
  if (bytes.length > MAX_LEGAL_SALES_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE", message: "sale.json exceeds size limit." };
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: "INVALID_UTF8", message: "sale.json is not valid UTF-8." };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: "INVALID_JSON", message: "sale.json is not valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, code: "INVALID_ROOT", message: "sale.json root must be a JSON array." };
  }
  const byKey = /* @__PURE__ */ new Map();
  const lines = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (!isPlainObject2(item)) {
      return { ok: false, code: "INVALID_RECORD", message: `Invalid record at index ${index}.`, index };
    }
    const legalParsed = readLegalEntityGuidFromClientInfo(item.client_info);
    if (!legalParsed.ok) {
      const code = legalParsed.code === "CLIENT_INFO_GUID_ID_CONFLICT" ? "CLIENT_INFO_GUID_ID_CONFLICT" : "INVALID_FIELD";
      const message = legalParsed.code === "CLIENT_INFO_GUID_ID_CONFLICT" ? `Conflicting client_info.guid and client_info.id at index ${index}.` : legalParsed.code === "MISSING_CLIENT_INFO" ? `Missing client_info at index ${index}.` : `Invalid client_info legal guid at index ${index}.`;
      return { ok: false, code, message, index };
    }
    const legalGuid = legalParsed.legalGuid;
    const saleInfo = item.sale_info;
    if (!isPlainObject2(saleInfo)) {
      return {
        ok: false,
        code: "INVALID_FIELD",
        message: `Missing sale_info at index ${index}.`,
        index
      };
    }
    const monthParsed = readMonthFields(item, saleInfo);
    if (!monthParsed.ok) {
      const code = "code" in monthParsed && monthParsed.code === "MONTH_FIELD_CONFLICT" ? "MONTH_FIELD_CONFLICT" : "INVALID_FIELD";
      return {
        ok: false,
        code,
        message: code === "MONTH_FIELD_CONFLICT" ? `Conflicting month values at index ${index}.` : `Invalid month at index ${index}.`,
        index
      };
    }
    const productType = readProductType(saleInfo);
    if (!productType) {
      return {
        ok: false,
        code: "INVALID_FIELD",
        message: `Invalid sale_info.type at index ${index}.`,
        index
      };
    }
    const metricsParsed = readSaleMetrics(saleInfo, index);
    if (!metricsParsed.ok) {
      return { ok: false, code: "INVALID_FIELD", message: metricsParsed.message, index };
    }
    const metrics = metricsParsed.metrics;
    const row = {
      sourceRowIndex: index,
      legalGuid,
      saleMonthYyyyMm: monthParsed.yyyyMm,
      saleMonthStartIso: monthParsed.monthStartIso,
      productType,
      ...metrics
    };
    const key = lineKey(legalGuid, monthParsed.yyyyMm, productType);
    const existing = byKey.get(key);
    if (existing && !linesEqual(existing, row)) {
      return {
        ok: false,
        code: "DUPLICATE_KEY_CONFLICT",
        message: `Conflicting duplicate for legal ${legalGuid}, month ${monthParsed.yyyyMm}, type ${productType}.`,
        index
      };
    }
    if (!existing) {
      byKey.set(key, row);
      lines.push(row);
    }
  }
  return {
    ok: true,
    roster: {
      sourceSha256: (0, import_node_crypto4.createHash)("sha256").update(bytes).digest("hex"),
      lines,
      lineCount: lines.length
    }
  };
}

// src/onec-sales/parse-sale-items-json.ts
var import_node_crypto5 = require("node:crypto");
function parseLegalSaleItemsJsonBytes(bytes) {
  if (bytes.length > MAX_LEGAL_SALES_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE", message: "sale(items).json exceeds size limit." };
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, code: "INVALID_JSON", message: "sale(items).json is not valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, code: "INVALID_ROOT", message: "sale(items).json root must be a JSON array." };
  }
  const lines = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (!isPlainObject2(item)) {
      return { ok: false, code: "INVALID_RECORD", message: `Invalid record at index ${index}.`, index };
    }
    const legalParsed = readLegalEntityGuidFromClientInfo(item.client_info);
    if (!legalParsed.ok) {
      const code = legalParsed.code === "CLIENT_INFO_GUID_ID_CONFLICT" ? "CLIENT_INFO_GUID_ID_CONFLICT" : "INVALID_FIELD";
      return {
        ok: false,
        code,
        message: legalParsed.code === "CLIENT_INFO_GUID_ID_CONFLICT" ? `Conflicting client_info.guid and client_info.id at index ${index}.` : `Invalid client_info at index ${index}.`,
        index
      };
    }
    const saleInfo = item.sale_info;
    if (!isPlainObject2(saleInfo)) {
      return { ok: false, code: "INVALID_FIELD", message: `Missing sale_info at index ${index}.`, index };
    }
    const monthParsed = readMonthFields(item, saleInfo);
    if (!monthParsed.ok) {
      const code = "code" in monthParsed && monthParsed.code === "MONTH_FIELD_CONFLICT" ? "MONTH_FIELD_CONFLICT" : "INVALID_FIELD";
      return {
        ok: false,
        code,
        message: code === "MONTH_FIELD_CONFLICT" ? `Conflicting month at index ${index}.` : `Invalid month at index ${index}.`,
        index
      };
    }
    const productType = readProductType(saleInfo);
    if (!productType) {
      return { ok: false, code: "INVALID_FIELD", message: `Invalid sale_info.type at index ${index}.`, index };
    }
    const guidItem = readGuidItem(saleInfo);
    const nameItem = readNameItem(saleInfo);
    if (!guidItem || !nameItem) {
      return {
        ok: false,
        code: "INVALID_FIELD",
        message: `Missing sale_info.guid_item or name_item at index ${index}.`,
        index
      };
    }
    const metricsParsed = readSaleMetrics(saleInfo, index);
    if (!metricsParsed.ok) {
      return { ok: false, code: "INVALID_FIELD", message: metricsParsed.message, index };
    }
    lines.push({
      sourceRowIndex: index,
      legalGuid: legalParsed.legalGuid,
      saleMonthYyyyMm: monthParsed.yyyyMm,
      saleMonthStartIso: monthParsed.monthStartIso,
      productType,
      guidItem,
      nameItem,
      ...metricsParsed.metrics
    });
  }
  return {
    ok: true,
    roster: {
      sourceSha256: (0, import_node_crypto5.createHash)("sha256").update(bytes).digest("hex"),
      lines,
      lineCount: lines.length
    }
  };
}

// src/onec-sales/parse-returne-json.ts
var import_node_crypto6 = require("node:crypto");
function parseLegalReturnsJsonBytes(bytes) {
  if (bytes.length > MAX_LEGAL_SALES_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE", message: "returne.json exceeds size limit." };
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, code: "INVALID_JSON", message: "returne.json is not valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, code: "INVALID_ROOT", message: "returne.json root must be a JSON array." };
  }
  const lines = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (!isPlainObject2(item)) {
      return { ok: false, code: "INVALID_RECORD", message: `Invalid record at index ${index}.`, index };
    }
    const legalParsed = readLegalEntityGuidFromClientInfo(item.client_info);
    if (!legalParsed.ok) {
      return { ok: false, code: "INVALID_FIELD", message: `Invalid client_info at index ${index}.`, index };
    }
    const returnInfo = item.returne_info;
    if (!isPlainObject2(returnInfo)) {
      return { ok: false, code: "INVALID_FIELD", message: `Missing returne_info at index ${index}.`, index };
    }
    const monthParsed = readMonthFields(item, returnInfo);
    if (!monthParsed.ok) {
      const code = "code" in monthParsed && monthParsed.code === "MONTH_FIELD_CONFLICT" ? "MONTH_FIELD_CONFLICT" : "INVALID_FIELD";
      return {
        ok: false,
        code,
        message: code === "MONTH_FIELD_CONFLICT" ? `Conflicting month at index ${index}.` : `Invalid month at index ${index}.`,
        index
      };
    }
    const productType = readProductType(returnInfo);
    if (!productType) {
      return { ok: false, code: "INVALID_FIELD", message: `Invalid returne_info.type at index ${index}.`, index };
    }
    const quantity = parseSaleDecimal(returnInfo.quantity);
    const income = parseSaleDecimal(returnInfo.income);
    if (!quantity.ok || !income.ok) {
      return { ok: false, code: "INVALID_FIELD", message: `Invalid quantity/income at index ${index}.`, index };
    }
    lines.push({
      sourceRowIndex: index,
      legalGuid: legalParsed.legalGuid,
      saleMonthYyyyMm: monthParsed.yyyyMm,
      saleMonthStartIso: monthParsed.monthStartIso,
      productType,
      quantity: quantity.numeric,
      income: income.numeric
    });
  }
  return {
    ok: true,
    roster: {
      sourceSha256: (0, import_node_crypto6.createHash)("sha256").update(bytes).digest("hex"),
      lines,
      lineCount: lines.length
    }
  };
}

// src/onec-sales/parse-returne-items-json.ts
var import_node_crypto7 = require("node:crypto");
function parseLegalReturnItemsJsonBytes(bytes) {
  if (bytes.length > MAX_LEGAL_SALES_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE", message: "returne(items).json exceeds size limit." };
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, code: "INVALID_JSON", message: "returne(items).json is not valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, code: "INVALID_ROOT", message: "returne(items).json root must be a JSON array." };
  }
  const lines = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (!isPlainObject2(item)) {
      return { ok: false, code: "INVALID_RECORD", message: `Invalid record at index ${index}.`, index };
    }
    const legalParsed = readLegalEntityGuidFromClientInfo(item.client_info);
    if (!legalParsed.ok) {
      return { ok: false, code: "INVALID_FIELD", message: `Invalid client_info at index ${index}.`, index };
    }
    const returnInfo = item.returne_info;
    if (!isPlainObject2(returnInfo)) {
      return { ok: false, code: "INVALID_FIELD", message: `Missing returne_info at index ${index}.`, index };
    }
    const monthParsed = readMonthFields(item, returnInfo);
    if (!monthParsed.ok) {
      const code = "code" in monthParsed && monthParsed.code === "MONTH_FIELD_CONFLICT" ? "MONTH_FIELD_CONFLICT" : "INVALID_FIELD";
      return {
        ok: false,
        code,
        message: code === "MONTH_FIELD_CONFLICT" ? `Conflicting month at index ${index}.` : `Invalid month at index ${index}.`,
        index
      };
    }
    const productType = readProductType(returnInfo);
    if (!productType) {
      return { ok: false, code: "INVALID_FIELD", message: `Invalid returne_info.type at index ${index}.`, index };
    }
    const guidItem = readGuidItem(returnInfo);
    const nameItem = readNameItem(returnInfo);
    if (!guidItem || !nameItem) {
      return {
        ok: false,
        code: "INVALID_FIELD",
        message: `Missing returne_info.guid_item or name_item at index ${index}.`,
        index
      };
    }
    const quantity = parseSaleDecimal(returnInfo.quantity);
    const income = parseSaleDecimal(returnInfo.income);
    if (!quantity.ok || !income.ok) {
      return { ok: false, code: "INVALID_FIELD", message: `Invalid quantity/income at index ${index}.`, index };
    }
    lines.push({
      sourceRowIndex: index,
      legalGuid: legalParsed.legalGuid,
      saleMonthYyyyMm: monthParsed.yyyyMm,
      saleMonthStartIso: monthParsed.monthStartIso,
      productType,
      guidItem,
      nameItem,
      quantity: quantity.numeric,
      income: income.numeric
    });
  }
  return {
    ok: true,
    roster: {
      sourceSha256: (0, import_node_crypto7.createHash)("sha256").update(bytes).digest("hex"),
      lines,
      lineCount: lines.length
    }
  };
}

// src/onec-sales/matched-only/catalog.ts
async function loadKnownLegalGuidSet(client) {
  const result = await client.query(
    `SELECT lower(guid_client::text) AS guid_client FROM onec_v3_legal_entities`
  );
  return new Set(result.rows.map((row) => row.guid_client));
}
function computeCatalogFingerprint(knownGuids) {
  const sorted = [...knownGuids].map((g) => g.toLowerCase()).sort();
  return sha256CanonicalJson({ v: 1, legalEntityGuids: sorted });
}
function computeUnknownUnionDigest(unknownGuids) {
  const sorted = [...unknownGuids].map((g) => g.toLowerCase()).sort();
  return sha256CanonicalJson({ v: 1, unknownLegalGuids: sorted });
}
function isKnownGuid(known, legalGuid) {
  return known.has(legalGuid.toLowerCase());
}

// src/onec-sales/september-2026-one-shot/source-pins.ts
function sha256File(bytes) {
  return (0, import_node_crypto8.createHash)("sha256").update(bytes).digest("hex");
}
function verifySourceBufferPin(key, bytes) {
  const pin = EXPECTED_SOURCE_FILES[key];
  const sha = sha256File(bytes);
  if (sha !== pin.sha256) {
    return { ok: false, code: "SOURCE_SHA_MISMATCH", message: `${pin.path} SHA mismatch.` };
  }
  const parsers = {
    saleAggregate: parseLegalSalesJsonBytes,
    saleItems: parseLegalSaleItemsJsonBytes,
    returnsAggregate: parseLegalReturnsJsonBytes,
    returnItems: parseLegalReturnItemsJsonBytes
  };
  const parsed = parsers[key](bytes);
  if (!parsed.ok || !parsed.roster) {
    return { ok: false, code: "SOURCE_PARSE_FAILED", message: `${pin.path} parse failed.` };
  }
  const lines = parsed.roster.lines;
  const full = lines.length;
  if (full !== pin.counts.full) {
    return { ok: false, code: "SOURCE_ROW_COUNT_MISMATCH", message: `${pin.path} full row count mismatch.` };
  }
  for (const line of lines) {
    if (line.saleMonthStartIso !== SEPTEMBER_2026_SALE_MONTH_ISO) {
      return { ok: false, code: "SOURCE_PERIOD_MISMATCH", message: `${pin.path} contains non-September rows.` };
    }
  }
  return {
    ok: true,
    full,
    matched: pin.counts.matched,
    excluded: pin.counts.excluded,
    sha256: sha,
    path: pin.path,
    periodOk: true
  };
}
function parseSeptemberSourceRosters(sources) {
  const saleAggregate = parseLegalSalesJsonBytes(sources.saleAggregate);
  const saleItems = parseLegalSaleItemsJsonBytes(sources.saleItems);
  const returnsAggregate = parseLegalReturnsJsonBytes(sources.returnsAggregate);
  const returnItems = parseLegalReturnItemsJsonBytes(sources.returnItems);
  if (!saleAggregate.ok || !saleAggregate.roster) {
    throw new Error("SOURCE_PARSE_FAILED:saleAggregate");
  }
  if (!saleItems.ok || !saleItems.roster) {
    throw new Error("SOURCE_PARSE_FAILED:saleItems");
  }
  if (!returnsAggregate.ok || !returnsAggregate.roster) {
    throw new Error("SOURCE_PARSE_FAILED:returnsAggregate");
  }
  if (!returnItems.ok || !returnItems.roster) {
    throw new Error("SOURCE_PARSE_FAILED:returnItems");
  }
  return {
    saleAggregate: saleAggregate.roster,
    saleItems: saleItems.roster,
    returnsAggregate: returnsAggregate.roster,
    returnItems: returnItems.roster
  };
}
async function verifyMatchedCountsFromSources(client, sources) {
  const known = await loadKnownLegalGuidSet(client);
  const unknown = /* @__PURE__ */ new Set();
  const entries = [
    ["saleAggregate", parseLegalSalesJsonBytes(sources.saleAggregate)],
    ["saleItems", parseLegalSaleItemsJsonBytes(sources.saleItems)],
    ["returnsAggregate", parseLegalReturnsJsonBytes(sources.returnsAggregate)],
    ["returnItems", parseLegalReturnItemsJsonBytes(sources.returnItems)]
  ];
  for (const [key, parsed] of entries) {
    if (!parsed.ok || !parsed.roster) {
      return { ok: false, code: "SOURCE_PARSE_FAILED", message: String(key) };
    }
    let matched = 0;
    for (const line of parsed.roster.lines) {
      if (isKnownGuid(known, line.legalGuid)) matched += 1;
      else unknown.add(line.legalGuid.toLowerCase());
    }
    const pin = EXPECTED_SOURCE_FILES[key];
    if (matched !== pin.counts.matched || parsed.roster.lines.length - matched !== pin.counts.excluded) {
      return { ok: false, code: "SOURCE_MATCHED_COUNT_MISMATCH", message: `${key} matched/excluded mismatch.` };
    }
  }
  if (unknown.size !== EXPECTED_UNKNOWN_CATALOG_GUID_COUNT) {
    return {
      ok: false,
      code: "UNKNOWN_GUID_COUNT_MISMATCH",
      message: `Expected ${EXPECTED_UNKNOWN_CATALOG_GUID_COUNT} unknown GUIDs, found ${unknown.size}.`
    };
  }
  return { ok: true };
}

// src/onec-sales/september-2026-one-shot/operator-guard.ts
function assertExternalWriteAuthorization() {
  const ref = process.env.SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF?.trim();
  if (!ref) {
    return {
      ok: false,
      code: "EXTERNAL_AUTHORIZATION_REQUIRED",
      message: "Set SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF after separate human approval before backup/apply/rollback."
    };
  }
  if (process.env.TEST_DATABASE_URL?.trim() && process.env.DATABASE_URL?.trim() === process.env.TEST_DATABASE_URL?.trim()) {
    return {
      ok: false,
      code: "PRODUCTION_URL_TEST_MIXED",
      message: "DATABASE_URL must not equal TEST_DATABASE_URL for operator write paths."
    };
  }
  return { ok: true, ref };
}
function assertProductionReadOnlyPreflightDatabaseUrl(databaseUrl, testContext) {
  if (process.env.SEPTEMBER_2026_SYNTHETIC_HARNESS?.trim()) {
    return {
      ok: false,
      code: "OPERATOR_BYPASS_FORBIDDEN",
      message: "Production read-only entry does not accept SEPTEMBER_2026_SYNTHETIC_HARNESS."
    };
  }
  const test = process.env.TEST_DATABASE_URL?.trim();
  if (test && databaseUrl === test) {
    if (testContext?.allowNonProductionDatabaseUrl) {
      return { ok: true };
    }
    return {
      ok: false,
      code: "TEST_DATABASE_URL_NOT_ALLOWED",
      message: "Operator read-only preflight must not use TEST_DATABASE_URL."
    };
  }
  if (test && process.env.DATABASE_URL?.trim() === test) {
    return {
      ok: false,
      code: "PRODUCTION_URL_TEST_MIXED",
      message: "DATABASE_URL must not equal TEST_DATABASE_URL."
    };
  }
  return { ok: true };
}

// src/onec-sales/september-2026-one-shot/job-state-047-048.ts
async function readSeptemberPreflightJobState(client) {
  const [importRow, diagnosticRow] = await Promise.all([
    client.query(
      `SELECT COUNT(*)::text AS count FROM onec_import_jobs WHERE status IN ('pending', 'running')`
    ),
    client.query(
      `SELECT COUNT(*)::text AS count FROM onec_diagnostic_jobs WHERE status IN ('pending', 'running')`
    )
  ]);
  return {
    pendingOrRunningImportJobs: Number(importRow.rows[0]?.count ?? "0"),
    pendingOrRunningDiagnosticJobs: Number(diagnosticRow.rows[0]?.count ?? "0")
  };
}

// src/onec-sales/decimal-sum.ts
var MONEY_SCALE = 4;
var QTY_SCALE = 6;
var QTY_INTEGER_DIGITS = 14;
function parseSaleQuantityString(value) {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false };
  }
  const sign = trimmed.startsWith("-") ? -1n : 1n;
  const unsigned = sign < 0n ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = unsigned.split(".");
  if (intPart.replace(/^0+/, "").length > QTY_INTEGER_DIGITS) {
    return { ok: false };
  }
  if (fracPart.length > QTY_SCALE) {
    return { ok: false };
  }
  const padded = fracPart.padEnd(QTY_SCALE, "0");
  const scaled = sign * (BigInt(intPart || "0") * 10n ** BigInt(QTY_SCALE) + BigInt(padded || "0"));
  return { ok: true, scaled };
}
function toScaledInt(value, scale) {
  if (scale === QTY_SCALE) {
    const parsed2 = parseSaleQuantityString(value);
    return parsed2.ok ? parsed2.scaled : null;
  }
  const parsed = parseSaleDecimal(value);
  if (!parsed.ok) {
    return null;
  }
  const sign = parsed.numeric.startsWith("-") ? -1n : 1n;
  const unsigned = parsed.numeric.startsWith("-") ? parsed.numeric.slice(1) : parsed.numeric;
  const [intPart, fracPart = ""] = unsigned.split(".");
  const padded = fracPart.padEnd(scale, "0").slice(0, scale);
  return sign * (BigInt(intPart || "0") * 10n ** BigInt(scale) + BigInt(padded || "0"));
}
function fromScaledInt(value, scale) {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const intPart = abs / divisor;
  const frac = abs % divisor;
  const fracStr = frac.toString().padStart(scale, "0");
  return `${sign}${intPart}.${fracStr}`;
}
function addSaleMoneyStrings(values) {
  let sum = 0n;
  for (const v of values) {
    const scaled = toScaledInt(v, MONEY_SCALE);
    if (scaled != null) {
      sum += scaled;
    }
  }
  return fromScaledInt(sum, MONEY_SCALE);
}
function addSaleQuantityStrings(values) {
  let sum = 0n;
  for (const v of values) {
    const parsed = parseSaleQuantityString(v);
    if (parsed.ok) {
      sum += parsed.scaled;
    }
  }
  return fromScaledInt(sum, QTY_SCALE);
}
function saleMoneyStringsExactEqual(a, b) {
  const left = toScaledInt(a, MONEY_SCALE);
  const right = toScaledInt(b, MONEY_SCALE);
  if (left == null || right == null) {
    return a === b;
  }
  return left === right;
}
function saleQuantityStringsExactEqual(a, b) {
  const left = parseSaleQuantityString(a);
  const right = parseSaleQuantityString(b);
  if (!left.ok || !right.ok) {
    return a === b;
  }
  return left.scaled === right.scaled;
}

// src/onec-sales/bundle-analyze.ts
function aggregateKey(legalGuid, month, productType) {
  return `${legalGuid.toLowerCase()}|${month}|${productType}`;
}
function itemAggregateKey(legalGuid, month, productType) {
  return aggregateKey(legalGuid, month, productType);
}
function sumItemMetrics(lines) {
  const map = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const key = itemAggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        sourceRowIndex: line.sourceRowIndex,
        legalGuid: line.legalGuid,
        saleMonthYyyyMm: line.saleMonthYyyyMm,
        saleMonthStartIso: line.saleMonthStartIso,
        productType: line.productType,
        quantity: line.quantity,
        income: line.income,
        manualDiscount: line.manualDiscount,
        automaticDiscount: line.automaticDiscount,
        totalDiscount: line.totalDiscount,
        costPrice: line.costPrice,
        additionalExpenses: line.additionalExpenses,
        grossProfit: line.grossProfit,
        profitability: line.profitability
      });
      continue;
    }
    map.set(key, {
      ...existing,
      quantity: addSaleQuantityStrings([existing.quantity, line.quantity]),
      income: addSaleMoneyStrings([existing.income, line.income]),
      manualDiscount: addSaleMoneyStrings([existing.manualDiscount, line.manualDiscount]),
      automaticDiscount: addSaleMoneyStrings([existing.automaticDiscount, line.automaticDiscount]),
      totalDiscount: addSaleMoneyStrings([existing.totalDiscount, line.totalDiscount]),
      costPrice: addSaleMoneyStrings([existing.costPrice, line.costPrice]),
      additionalExpenses: addSaleMoneyStrings([existing.additionalExpenses, line.additionalExpenses]),
      grossProfit: addSaleMoneyStrings([existing.grossProfit, line.grossProfit]),
      profitability: existing.profitability
    });
  }
  return map;
}
function duplicateKeyStats(lines, itemKey) {
  const groups = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const key = itemKey ? itemKey(line) : aggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  let distinct = 0;
  let extra = 0;
  for (const count of groups.values()) {
    distinct += 1;
    if (count > 1) {
      extra += count - 1;
    }
  }
  return { rawRowCount: lines.length, distinctGroupCount: distinct, extraRows: extra };
}
function isBundleParityOk(report) {
  return report.parity.onlyAggregate === 0 && report.parity.onlyItems === 0 && report.parity.metricMismatches === 0 && report.returnsParity.parityOk;
}
function analyzeSalesBundle(input) {
  const salesAggDup = duplicateKeyStats(input.salesAggregate.lines);
  const salesItemsDup = duplicateKeyStats(
    input.salesItems.lines,
    (line) => `${aggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType)}|${line.guidItem?.toLowerCase() ?? ""}`
  );
  const returnsAggDup = duplicateKeyStats(input.returnsAggregate.lines);
  const returnsItemsDup = duplicateKeyStats(
    input.returnsItems.lines,
    (line) => `${aggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType)}|${line.guidItem?.toLowerCase() ?? ""}`
  );
  const allGuids = /* @__PURE__ */ new Set();
  for (const roster of [
    input.salesAggregate.lines,
    input.salesItems.lines,
    input.returnsAggregate.lines,
    input.returnsItems.lines
  ]) {
    for (const line of roster) {
      allGuids.add(line.legalGuid.toLowerCase());
    }
  }
  const unmatched = [...allGuids].filter((g) => !input.knownCatalogLegalGuids.has(g)).sort();
  const aggMap = /* @__PURE__ */ new Map();
  for (const line of input.salesAggregate.lines) {
    const key = aggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType);
    const existing = aggMap.get(key);
    if (!existing) {
      aggMap.set(key, line);
      continue;
    }
    aggMap.set(key, {
      ...existing,
      quantity: addSaleQuantityStrings([existing.quantity, line.quantity]),
      income: addSaleMoneyStrings([existing.income, line.income]),
      manualDiscount: addSaleMoneyStrings([existing.manualDiscount, line.manualDiscount]),
      automaticDiscount: addSaleMoneyStrings([existing.automaticDiscount, line.automaticDiscount]),
      totalDiscount: addSaleMoneyStrings([existing.totalDiscount, line.totalDiscount]),
      costPrice: addSaleMoneyStrings([existing.costPrice, line.costPrice]),
      additionalExpenses: addSaleMoneyStrings([existing.additionalExpenses, line.additionalExpenses]),
      grossProfit: addSaleMoneyStrings([existing.grossProfit, line.grossProfit]),
      profitability: existing.profitability
    });
  }
  const itemsRolled = sumItemMetrics(input.salesItems.lines);
  let onlyAggregate = 0;
  let onlyItems = 0;
  let metricMismatches = 0;
  for (const key of /* @__PURE__ */ new Set([...aggMap.keys(), ...itemsRolled.keys()])) {
    const a = aggMap.get(key);
    const b = itemsRolled.get(key);
    if (a && !b) {
      onlyAggregate += 1;
      continue;
    }
    if (b && !a) {
      onlyItems += 1;
      continue;
    }
    if (!a || !b) {
      continue;
    }
    const fields = [
      "quantity",
      "income",
      "manualDiscount",
      "automaticDiscount",
      "totalDiscount",
      "costPrice",
      "additionalExpenses",
      "grossProfit"
    ];
    for (const field of fields) {
      const ok = field === "quantity" ? saleQuantityStringsExactEqual(a[field], b[field]) : saleMoneyStringsExactEqual(a[field], b[field]);
      if (!ok) {
        metricMismatches += 1;
        break;
      }
    }
  }
  const retAggGroups = /* @__PURE__ */ new Map();
  for (const line of input.returnsAggregate.lines) {
    const key = aggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType);
    const existing = retAggGroups.get(key);
    if (!existing) {
      retAggGroups.set(key, { quantity: line.quantity, income: line.income });
    } else {
      retAggGroups.set(key, {
        quantity: addSaleQuantityStrings([existing.quantity, line.quantity]),
        income: addSaleMoneyStrings([existing.income, line.income])
      });
    }
  }
  const retItemGroups = /* @__PURE__ */ new Map();
  for (const line of input.returnsItems.lines) {
    const key = aggregateKey(line.legalGuid, line.saleMonthYyyyMm, line.productType);
    const existing = retItemGroups.get(key);
    if (!existing) {
      retItemGroups.set(key, { quantity: line.quantity, income: line.income });
    } else {
      retItemGroups.set(key, {
        quantity: addSaleQuantityStrings([existing.quantity, line.quantity]),
        income: addSaleMoneyStrings([existing.income, line.income])
      });
    }
  }
  let returnsOnlyAggregate = 0;
  let returnsOnlyItems = 0;
  let returnsMismatches = 0;
  for (const key of /* @__PURE__ */ new Set([...retAggGroups.keys(), ...retItemGroups.keys()])) {
    const a = retAggGroups.get(key);
    const b = retItemGroups.get(key);
    if (a && !b) {
      returnsOnlyAggregate += 1;
      continue;
    }
    if (b && !a) {
      returnsOnlyItems += 1;
      continue;
    }
    if (!a || !b) {
      continue;
    }
    if (!saleQuantityStringsExactEqual(a.quantity, b.quantity) || !saleMoneyStringsExactEqual(a.income, b.income)) {
      returnsMismatches += 1;
    }
  }
  return {
    salesAggregate: {
      sha256: input.salesAggregate.sourceSha256,
      rows: input.salesAggregate.lineCount,
      duplicateKeys: salesAggDup
    },
    salesItems: {
      sha256: input.salesItems.sourceSha256,
      rows: input.salesItems.lineCount,
      duplicateKeys: salesItemsDup
    },
    returnsAggregate: {
      sha256: input.returnsAggregate.sourceSha256,
      rows: input.returnsAggregate.lineCount,
      duplicateKeys: returnsAggDup
    },
    returnsItems: {
      sha256: input.returnsItems.sourceSha256,
      rows: input.returnsItems.lineCount,
      duplicateKeys: returnsItemsDup
    },
    distinctClientGuids: {
      salesAggregate: new Set(input.salesAggregate.lines.map((l) => l.legalGuid.toLowerCase())).size,
      salesItems: new Set(input.salesItems.lines.map((l) => l.legalGuid.toLowerCase())).size,
      returnsAggregate: new Set(input.returnsAggregate.lines.map((l) => l.legalGuid.toLowerCase())).size,
      returnsItems: new Set(input.returnsItems.lines.map((l) => l.legalGuid.toLowerCase())).size
    },
    unmatchedCatalogGuids: unmatched,
    parity: {
      groupCountAggregate: aggMap.size,
      groupCountItemsRolledUp: itemsRolled.size,
      onlyAggregate,
      onlyItems,
      metricMismatches
    },
    returnsParity: {
      groupCountAggregate: retAggGroups.size,
      groupCountItemsRolledUp: retItemGroups.size,
      onlyAggregate: returnsOnlyAggregate,
      onlyItems: returnsOnlyItems,
      quantityIncomeMismatches: returnsMismatches,
      parityOk: returnsOnlyAggregate === 0 && returnsOnlyItems === 0 && returnsMismatches === 0
    }
  };
}

// src/onec-sales/matched-only/partition.ts
function partitionLines(lines, known) {
  const matched = [];
  const excluded = [];
  for (const line of lines) {
    if (isKnownGuid(known, line.legalGuid)) {
      matched.push(line);
    } else {
      excluded.push(line);
    }
  }
  return {
    matched,
    excluded,
    counts: {
      full: lines.length,
      matched: matched.length,
      excluded: excluded.length
    }
  };
}
function partitionSalesBundle(input) {
  const saleAggregate = partitionLines(input.saleAggregate.lines, input.known);
  const saleItems = partitionLines(input.saleItems.lines, input.known);
  const returnsAggregate = partitionLines(input.returnsAggregate.lines, input.known);
  const returnItems = partitionLines(input.returnItems.lines, input.known);
  const unknown = /* @__PURE__ */ new Set();
  for (const line of [
    ...input.saleAggregate.lines,
    ...input.saleItems.lines,
    ...input.returnsAggregate.lines,
    ...input.returnItems.lines
  ]) {
    if (!isKnownGuid(input.known, line.legalGuid)) {
      unknown.add(line.legalGuid.toLowerCase());
    }
  }
  return {
    saleAggregate,
    saleItems,
    returnsAggregate,
    returnItems,
    unknownGuids: [...unknown].sort()
  };
}

// src/onec-sales/matched-only/apply-persist-metadata.ts
var DEFAULT_QUARANTINE_REASON = "unknown_catalog_guid";
var DEFAULT_SOURCE_PATH = "/LC/sale/";
async function verifyExpectedImportMetadata(client, plan, partition, rosters, planHash, options) {
  const activationPairs = [];
  const pushMonths = (dataset, sha, lines) => {
    for (const month of new Set(lines.map((l) => l.saleMonthStartIso))) {
      activationPairs.push({ dataset, month, sha });
    }
  };
  pushMonths("sale_aggregate", rosters.saleAggregate.sourceSha256, rosters.saleAggregate.lines);
  pushMonths("sale_items", rosters.saleItems.sourceSha256, rosters.saleItems.lines);
  pushMonths("return_aggregate", rosters.returnsAggregate.sourceSha256, rosters.returnsAggregate.lines);
  pushMonths("return_items", rosters.returnItems.sourceSha256, rosters.returnItems.lines);
  for (const pair of activationPairs) {
    const row = await client.query(
      `SELECT source_sha256 FROM onec_v3_legal_sales_month_activation
       WHERE dataset = $1 AND sale_month = $2::date`,
      [pair.dataset, pair.month]
    );
    const sha = row.rows[0]?.source_sha256?.trim();
    if (sha !== pair.sha) {
      return { ok: false, code: "PERSISTED_ACTIVATION_MISMATCH", message: "Month activation SHA mismatch." };
    }
  }
  const stateExpectations = [
    { table: "onec_v3_legal_sales_import_state", sha: rosters.saleAggregate.sourceSha256, count: partition.saleAggregate.matched.length },
    { table: "onec_v3_legal_sale_item_import_state", sha: rosters.saleItems.sourceSha256, count: partition.saleItems.matched.length },
    { table: "onec_v3_legal_return_import_state", sha: rosters.returnsAggregate.sourceSha256, count: partition.returnsAggregate.matched.length },
    { table: "onec_v3_legal_return_item_import_state", sha: rosters.returnItems.sourceSha256, count: partition.returnItems.matched.length }
  ];
  for (const state of stateExpectations) {
    const row = await client.query(
      `SELECT row_count, trim(source_sha256) AS source_sha256 FROM ${state.table} WHERE id = 1`
    );
    if ((row.rows[0]?.row_count ?? -1) !== state.count) {
      return { ok: false, code: "PERSISTED_IMPORT_STATE_MISMATCH", message: `${state.table} row_count mismatch.` };
    }
    if (row.rows[0]?.source_sha256 !== state.sha) {
      return { ok: false, code: "PERSISTED_IMPORT_STATE_MISMATCH", message: `${state.table} source_sha256 mismatch.` };
    }
  }
  const statsCases = [
    { dataset: "sale_aggregate", roster: rosters.saleAggregate, partition: partition.saleAggregate },
    { dataset: "sale_items", roster: rosters.saleItems, partition: partition.saleItems },
    { dataset: "return_aggregate", roster: rosters.returnsAggregate, partition: partition.returnsAggregate },
    { dataset: "return_items", roster: rosters.returnItems, partition: partition.returnItems }
  ];
  for (const item of statsCases) {
    const sourceSha = item.roster.sourceSha256;
    const monthsInRoster = [...new Set(item.roster.lines.map((l) => l.saleMonthStartIso))];
    for (const month of monthsInRoster) {
      const full = item.roster.lines.filter((l) => l.saleMonthStartIso === month).length;
      const matched = item.partition.matched.filter((l) => l.saleMonthStartIso === month).length;
      const excluded = full - matched;
      const row = await client.query(
        `SELECT full_row_count, matched_row_count, excluded_row_count, trim(last_plan_hash) AS last_plan_hash
         FROM onec_v3_legal_sales_import_month_stats
         WHERE dataset = $1 AND sale_month = $2::date AND source_sha256 = $3`,
        [item.dataset, month, sourceSha]
      );
      const stats = row.rows[0];
      if (!stats || stats.full_row_count !== full || stats.matched_row_count !== matched || stats.excluded_row_count !== excluded || stats.last_plan_hash !== planHash) {
        return { ok: false, code: "PERSISTED_MONTH_STATS_MISMATCH", message: "Month stats mismatch." };
      }
    }
  }
  const expectedQuarantine = [];
  const pushExcluded = (dataset, sourceSha, lines) => {
    for (const line of lines) {
      expectedQuarantine.push(
        `${dataset}|${sourceSha}|${line.sourceRowIndex}|${line.legalGuid.toLowerCase()}|${line.saleMonthStartIso}|${DEFAULT_QUARANTINE_REASON}|${DEFAULT_SOURCE_PATH}`
      );
    }
  };
  pushExcluded("sale_aggregate", rosters.saleAggregate.sourceSha256, partition.saleAggregate.excluded);
  pushExcluded("sale_items", rosters.saleItems.sourceSha256, partition.saleItems.excluded);
  pushExcluded("return_aggregate", rosters.returnsAggregate.sourceSha256, partition.returnsAggregate.excluded);
  pushExcluded("return_items", rosters.returnItems.sourceSha256, partition.returnItems.excluded);
  expectedQuarantine.sort();
  const quarantine = await client.query(
    `SELECT dataset, trim(source_sha256) AS source_sha256, source_row_index, legal_guid::text,
            sale_month::text, quarantine_reason, source_path
     FROM onec_v3_legal_sales_import_quarantine_rows
     WHERE plan_hash = $1`,
    [planHash]
  );
  const actualQuarantine = quarantine.rows.map(
    (r) => `${r.dataset}|${r.source_sha256}|${r.source_row_index}|${r.legal_guid.toLowerCase()}|${r.sale_month.slice(0, 10)}|${r.quarantine_reason}|${r.source_path}`
  ).sort();
  if (actualQuarantine.join("\n") !== expectedQuarantine.join("\n")) {
    return { ok: false, code: "PERSISTED_QUARANTINE_MISMATCH", message: "Quarantine rows mismatch." };
  }
  return { ok: true };
}

// src/onec-sales/matched-only/apply-persist-materialization.ts
function money(values) {
  return addSaleMoneyStrings(values);
}
function qty(values) {
  return addSaleQuantityStrings(values);
}
function normSha(sha) {
  return sha.trim();
}
function normMonth(value) {
  return value.slice(0, 10);
}
function financialRollup(full, matched, excluded) {
  const sum = (lines) => ({
    income: money(lines.map((l) => String(l.income))),
    quantity: qty(lines.map((l) => String(l.quantity)))
  });
  return { full: sum(full), matched: sum(matched), excluded: sum(excluded) };
}
function saleItemsFinancialRollup(partition) {
  const sum = (lines) => ({
    income: money(lines.map((l) => String(l.income))),
    quantity: qty(lines.map((l) => String(l.quantity))),
    costPrice: money(lines.map((l) => String(l.costPrice)))
  });
  return {
    full: sum(allPartitionLines(partition)),
    matched: sum(partition.matched),
    excluded: sum(partition.excluded)
  };
}
function allPartitionLines(part) {
  return [...part.matched, ...part.excluded];
}
function buildFinancialTotalsFromPartition(partition) {
  return {
    saleAggregate: financialRollup(
      allPartitionLines(partition.saleAggregate),
      partition.saleAggregate.matched,
      partition.saleAggregate.excluded
    ),
    saleItems: saleItemsFinancialRollup(partition.saleItems),
    returnsAggregate: financialRollup(
      allPartitionLines(partition.returnsAggregate),
      partition.returnsAggregate.matched,
      partition.returnsAggregate.excluded
    ),
    returnItems: financialRollup(
      allPartitionLines(partition.returnItems),
      partition.returnItems.matched,
      partition.returnItems.excluded
    )
  };
}
function multisetMismatch(actual, expected) {
  if (actual.length !== expected.length) {
    return true;
  }
  const a = [...actual].sort();
  const e = [...expected].sort();
  return a.join("\n") !== e.join("\n");
}
async function verifyMatchedMaterializedRows(client, plan, partition, rosters, planHash, options) {
  const months = plan.scope.saleMonthsIso;
  const saleAggKeys = [];
  for (const line of partition.saleAggregate.matched) {
    saleAggKeys.push(`${line.legalGuid.toLowerCase()}|${line.saleMonthStartIso}|${line.productType}`);
    const row = await client.query(
      `SELECT legal_guid::text, sale_month::text, product_type,
              quantity::text, income::text, manual_discount::text, automatic_discount::text,
              total_discount::text, cost_price::text, additional_expenses::text, gross_profit::text,
              profitability::text, trim(source_sha256) AS source_sha256
       FROM onec_v3_legal_sales_lines
       WHERE legal_guid = $1::uuid AND sale_month = $2::date AND product_type = $3`,
      [line.legalGuid, line.saleMonthStartIso, line.productType]
    );
    if (row.rows.length !== 1) {
      return { ok: false, code: "PERSISTED_ROW_KEY_MISSING", message: "Sale aggregate row missing." };
    }
    const p = row.rows[0];
    const checks = [
      ["income", p.income, String(line.income)],
      ["quantity", p.quantity, String(line.quantity)],
      ["manual_discount", p.manual_discount, String(line.manualDiscount)],
      ["automatic_discount", p.automatic_discount, String(line.automaticDiscount)],
      ["total_discount", p.total_discount, String(line.totalDiscount)],
      ["cost_price", p.cost_price, String(line.costPrice)],
      ["additional_expenses", p.additional_expenses, String(line.additionalExpenses)],
      ["gross_profit", p.gross_profit, String(line.grossProfit)],
      ["profitability", p.profitability, String(line.profitability)],
      ["source_sha256", p.source_sha256, rosters.saleAggregate.sourceSha256]
    ];
    for (const [field, actual, expected] of checks) {
      const equal = field === "quantity" ? saleQuantityStringsExactEqual(actual, expected) : field === "source_sha256" ? normSha(actual) === normSha(expected) : saleDecimalStringsEqual(actual, expected);
      if (!equal) {
        return { ok: false, code: "PERSISTED_ROW_VALUE_MISMATCH", message: `Sale aggregate ${field} mismatch.` };
      }
    }
  }
  const saleItemKeys = [];
  for (const line of partition.saleItems.matched) {
    saleItemKeys.push(`${rosters.saleItems.sourceSha256}|${line.sourceRowIndex}`);
    const row = await client.query(
      `SELECT legal_guid::text, sale_month::text, product_type, guid_item::text, name_item,
              quantity::text, income::text, manual_discount::text, automatic_discount::text,
              total_discount::text, cost_price::text, additional_expenses::text, gross_profit::text,
              profitability::text, trim(source_sha256) AS source_sha256, source_row_index::text,
              catalog_matched::text
       FROM onec_v3_legal_sale_item_lines
       WHERE source_sha256 = $1 AND source_row_index = $2`,
      [rosters.saleItems.sourceSha256, line.sourceRowIndex]
    );
    if (row.rows.length !== 1) {
      return { ok: false, code: "PERSISTED_ROW_KEY_MISSING", message: "Sale item row missing." };
    }
    const p = row.rows[0];
    const checks = [
      ["legal_guid", p.legal_guid, line.legalGuid],
      ["product_type", p.product_type, line.productType],
      ["guid_item", p.guid_item, line.guidItem],
      ["name_item", p.name_item, line.nameItem],
      ["income", p.income, String(line.income)],
      ["quantity", p.quantity, String(line.quantity)],
      ["manual_discount", p.manual_discount, String(line.manualDiscount)],
      ["automatic_discount", p.automatic_discount, String(line.automaticDiscount)],
      ["total_discount", p.total_discount, String(line.totalDiscount)],
      ["cost_price", p.cost_price, String(line.costPrice)],
      ["additional_expenses", p.additional_expenses, String(line.additionalExpenses)],
      ["gross_profit", p.gross_profit, String(line.grossProfit)],
      ["profitability", p.profitability, String(line.profitability)],
      ["source_sha256", p.source_sha256, rosters.saleItems.sourceSha256],
      ["sale_month", normMonth(p.sale_month), line.saleMonthStartIso],
      ["catalog_matched", p.catalog_matched, "true"]
    ];
    for (const [field, actual, expected] of checks) {
      const equal = field === "quantity" ? saleQuantityStringsExactEqual(actual, expected) : field === "source_sha256" ? normSha(actual) === normSha(expected) : field === "legal_guid" || field === "guid_item" ? actual.toLowerCase() === expected.toLowerCase() : field === "name_item" || field === "product_type" || field === "catalog_matched" || field === "sale_month" ? actual === expected : saleDecimalStringsEqual(actual, expected);
      if (!equal) {
        return { ok: false, code: "PERSISTED_ROW_VALUE_MISMATCH", message: `Sale item ${field} mismatch.` };
      }
    }
  }
  const retAggKeys = [];
  for (const line of partition.returnsAggregate.matched) {
    retAggKeys.push(`${rosters.returnsAggregate.sourceSha256}|${line.sourceRowIndex}`);
    const row = await client.query(
      `SELECT legal_guid::text, sale_month::text, product_type, quantity::text, income::text,
              trim(source_sha256) AS source_sha256, source_row_index::text
       FROM onec_v3_legal_return_lines
       WHERE source_sha256 = $1 AND source_row_index = $2`,
      [rosters.returnsAggregate.sourceSha256, line.sourceRowIndex]
    );
    if (row.rows.length !== 1) {
      return { ok: false, code: "PERSISTED_ROW_KEY_MISSING", message: "Return aggregate row missing." };
    }
    const p = row.rows[0];
    if (p.legal_guid.toLowerCase() !== line.legalGuid.toLowerCase() || p.product_type !== line.productType || normMonth(p.sale_month) !== line.saleMonthStartIso || !saleDecimalStringsEqual(p.income, String(line.income)) || !saleQuantityStringsExactEqual(p.quantity, String(line.quantity))) {
      return { ok: false, code: "PERSISTED_ROW_VALUE_MISMATCH", message: "Return aggregate values mismatch." };
    }
  }
  const retItemKeys = [];
  for (const line of partition.returnItems.matched) {
    retItemKeys.push(`${rosters.returnItems.sourceSha256}|${line.sourceRowIndex}`);
    const row = await client.query(
      `SELECT legal_guid::text, sale_month::text, product_type, guid_item::text, name_item,
              quantity::text, income::text, trim(source_sha256) AS source_sha256, source_row_index::text,
              catalog_matched::text
       FROM onec_v3_legal_return_item_lines
       WHERE source_sha256 = $1 AND source_row_index = $2`,
      [rosters.returnItems.sourceSha256, line.sourceRowIndex]
    );
    if (row.rows.length !== 1) {
      return { ok: false, code: "PERSISTED_ROW_KEY_MISSING", message: "Return item row missing." };
    }
    const p = row.rows[0];
    if (p.legal_guid.toLowerCase() !== line.legalGuid.toLowerCase() || p.product_type !== line.productType || p.guid_item.toLowerCase() !== line.guidItem.toLowerCase() || p.name_item !== line.nameItem || normMonth(p.sale_month) !== line.saleMonthStartIso || p.catalog_matched !== "true" || !saleDecimalStringsEqual(p.income, String(line.income)) || !saleQuantityStringsExactEqual(p.quantity, String(line.quantity))) {
      return { ok: false, code: "PERSISTED_ROW_VALUE_MISMATCH", message: "Return item values mismatch." };
    }
  }
  const saleAggPersisted = await client.query(
    `SELECT legal_guid::text || '|' || sale_month::text || '|' || product_type AS key
     FROM onec_v3_legal_sales_lines WHERE sale_month = ANY($1::date[])`,
    [months]
  );
  if (multisetMismatch(saleAggPersisted.rows.map((r) => r.key), saleAggKeys)) {
    return { ok: false, code: "PERSISTED_KEYSET_MISMATCH", message: "Sale aggregate key multiset mismatch." };
  }
  const saleItemsPersisted = await client.query(
    `SELECT trim(source_sha256) || '|' || source_row_index::text AS key
     FROM onec_v3_legal_sale_item_lines
     WHERE sale_month = ANY($1::date[])`,
    [months]
  );
  if (multisetMismatch(saleItemsPersisted.rows.map((r) => r.key), saleItemKeys)) {
    return { ok: false, code: "PERSISTED_KEYSET_MISMATCH", message: "Sale items key multiset mismatch." };
  }
  const retAggPersisted = await client.query(
    `SELECT trim(source_sha256) || '|' || source_row_index::text AS key
     FROM onec_v3_legal_return_lines
     WHERE sale_month = ANY($1::date[])`,
    [months]
  );
  if (multisetMismatch(retAggPersisted.rows.map((r) => r.key), retAggKeys)) {
    return { ok: false, code: "PERSISTED_KEYSET_MISMATCH", message: "Return aggregate key multiset mismatch." };
  }
  const retItemsPersisted = await client.query(
    `SELECT trim(source_sha256) || '|' || source_row_index::text AS key
     FROM onec_v3_legal_return_item_lines
     WHERE sale_month = ANY($1::date[])`,
    [months]
  );
  if (multisetMismatch(retItemsPersisted.rows.map((r) => r.key), retItemKeys)) {
    return { ok: false, code: "PERSISTED_KEYSET_MISMATCH", message: "Return items key multiset mismatch." };
  }
  if (!options?.skip049Metadata) {
    const metadata = await verifyExpectedImportMetadata(client, plan, partition, rosters, planHash, options);
    if (!metadata.ok) {
      return metadata;
    }
  }
  return { ok: true };
}

// src/onec-sales/september-2026-one-shot/read-only-preflight-core.ts
function pgJsonArrayLength(jsonText) {
  const parsed = JSON.parse(jsonText);
  return Array.isArray(parsed) ? parsed.length : 0;
}
function buildSourcePinReports(buffers) {
  const sources = {};
  let firstError = null;
  for (const key of Object.keys(EXPECTED_SOURCE_FILES)) {
    const r = verifySourceBufferPin(key, buffers[key]);
    if (!r.ok) {
      sources[key] = { ok: false, code: r.code };
      if (!firstError) {
        firstError = { code: r.code, message: r.message };
      }
      continue;
    }
    sources[key] = {
      ok: true,
      path: r.path,
      sha256: r.sha256,
      sha256Ok: true,
      full: r.full,
      matched: r.matched,
      excluded: r.excluded,
      periodOk: true
    };
  }
  return { sources, firstError };
}
async function runSeptember2026ReadOnlyPreflight(input) {
  const urlCheck = assertProductionReadOnlyPreflightDatabaseUrl(input.databaseUrl, input.testContext);
  if (!urlCheck.ok) {
    const report = {
      v: 2,
      mode: "read-only-preflight",
      saleMonth: SEPTEMBER_2026_SALE_MONTH_ISO,
      target: {
        timewebAppId: TIMEWEB_APP_ID,
        timewebDbId: TIMEWEB_DB_ID,
        fingerprint: "",
        fingerprintOk: false
      },
      appReleaseRef: { kind: "compatibility_constraint", ref: APP_RELEASE_REF_FOR_COMPATIBILITY },
      readOnlyProof: {
        transactionIsolation: "REPEATABLE READ",
        readOnly: true,
        noPersistence: true,
        noWriteOperationsInvoked: true
      },
      schema047048Ok: null,
      jobState: null,
      catalog: { ok: false, code: urlCheck.code },
      sources: buildSourcePinReports(input.sources).sources,
      unknownUniqueGuidCount: null,
      parity: null,
      financialTotals: null,
      beforeStateDigest: null,
      beforeCounts: null,
      authorization: "read-only"
    };
    return { ok: false, code: urlCheck.code, message: urlCheck.message, report };
  }
  const sourcePins = input.testContext?.skipSourcePinChecks ? {
    sources: Object.fromEntries(
      Object.keys(EXPECTED_SOURCE_FILES).map((key) => [
        key,
        {
          ok: true,
          path: EXPECTED_SOURCE_FILES[key].path,
          sha256: EXPECTED_SOURCE_FILES[key].sha256,
          sha256Ok: true,
          full: EXPECTED_SOURCE_FILES[key].counts.full,
          matched: EXPECTED_SOURCE_FILES[key].counts.matched,
          excluded: EXPECTED_SOURCE_FILES[key].counts.excluded,
          periodOk: true
        }
      ])
    ),
    firstError: null
  } : buildSourcePinReports(input.sources);
  const pgOptions = createPgPoolOptions(input.databaseUrl);
  const pool = new import_pg2.Pool({
    connectionString: pgOptions.connectionString,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl,
    max: 1
  });
  try {
    return await withReadOnlyPreflightSession(pool, async (client) => {
      const identity = await readTargetDbIdentityFromClient(client, input.databaseUrl);
      const fingerprintOk = input.testContext?.skipTargetFingerprintPin === true || identity.fingerprint === EXPECTED_TARGET_DB_FINGERPRINT;
      const baseReport = () => ({
        v: 2,
        mode: "read-only-preflight",
        saleMonth: SEPTEMBER_2026_SALE_MONTH_ISO,
        target: {
          timewebAppId: TIMEWEB_APP_ID,
          timewebDbId: TIMEWEB_DB_ID,
          fingerprint: identity.fingerprint,
          fingerprintOk
        },
        appReleaseRef: { kind: "compatibility_constraint", ref: APP_RELEASE_REF_FOR_COMPATIBILITY },
        readOnlyProof: {
          transactionIsolation: "REPEATABLE READ",
          readOnly: true,
          noPersistence: true,
          noWriteOperationsInvoked: true
        },
        schema047048Ok: null,
        jobState: null,
        catalog: { ok: false, code: "NOT_RUN_WRONG_TARGET" },
        sources: sourcePins.sources,
        unknownUniqueGuidCount: null,
        parity: null,
        financialTotals: null,
        beforeStateDigest: null,
        beforeCounts: null,
        authorization: "read-only"
      });
      if (!fingerprintOk) {
        const report2 = baseReport();
        report2.catalog = { ok: false, code: "NOT_RUN_WRONG_TARGET" };
        return {
          ok: false,
          code: "TARGET_FINGERPRINT_MISMATCH",
          message: "Database fingerprint mismatch.",
          report: report2
        };
      }
      const schema = await assertSchema047048Ready(client);
      const jobState = await readSeptemberPreflightJobState(client);
      const catalog = input.testContext?.skipCatalogPin === true ? { ok: true, count: 0, sha256: "test-skipped" } : await verifyCatalogPin(client);
      const before = await captureSeptember047048BeforeState(client);
      let unknownUniqueGuidCount = null;
      let parity = null;
      let financialTotals = null;
      if (sourcePins.firstError) {
        const report2 = baseReport();
        report2.schema047048Ok = schema.ok;
        report2.jobState = jobState;
        report2.catalog = catalog.ok ? { ok: true, count: catalog.count, sha256: catalog.sha256 } : { ok: false, code: catalog.code };
        report2.beforeStateDigest = before.digest;
        report2.beforeCounts = {
          saleAggregateLines: pgJsonArrayLength(before.snapshot.saleAggregateLinesJson),
          saleItemLines: pgJsonArrayLength(before.snapshot.saleItemLinesJson),
          returnLines: pgJsonArrayLength(before.snapshot.returnLinesJson),
          returnItemLines: pgJsonArrayLength(before.snapshot.returnItemLinesJson)
        };
        report2.sources = sourcePins.sources;
        return {
          ok: false,
          code: sourcePins.firstError.code,
          message: sourcePins.firstError.message,
          report: report2
        };
      }
      if (!input.testContext?.skipSourcePinChecks) {
        const matched = await verifyMatchedCountsFromSources(client, input.sources);
        if (!matched.ok) {
          const report2 = baseReport();
          report2.schema047048Ok = schema.ok;
          report2.jobState = jobState;
          report2.catalog = catalog.ok ? { ok: true, count: catalog.count, sha256: catalog.sha256 } : { ok: false, code: catalog.code };
          report2.beforeStateDigest = before.digest;
          report2.beforeCounts = {
            saleAggregateLines: pgJsonArrayLength(before.snapshot.saleAggregateLinesJson),
            saleItemLines: pgJsonArrayLength(before.snapshot.saleItemLinesJson),
            returnLines: pgJsonArrayLength(before.snapshot.returnLinesJson),
            returnItemLines: pgJsonArrayLength(before.snapshot.returnItemLinesJson)
          };
          report2.sources = sourcePins.sources;
          return { ok: false, code: matched.code, message: matched.message, report: report2 };
        }
        const rosters = parseSeptemberSourceRosters(input.sources);
        const known = await loadKnownLegalGuidSet(client);
        const partition = partitionSalesBundle({ ...rosters, known });
        const analyze = analyzeSalesBundle({
          salesAggregate: rosters.saleAggregate,
          salesItems: rosters.saleItems,
          returnsAggregate: rosters.returnsAggregate,
          returnsItems: rosters.returnItems,
          knownCatalogLegalGuids: known
        });
        unknownUniqueGuidCount = analyze.unmatchedCatalogGuids.length;
        parity = {
          salesOk: analyze.parity.onlyAggregate === 0 && analyze.parity.onlyItems === 0 && analyze.parity.metricMismatches === 0,
          returnsOk: analyze.returnsParity.parityOk
        };
        financialTotals = buildFinancialTotalsFromPartition(partition);
      }
      const report = {
        ...baseReport(),
        schema047048Ok: schema.ok,
        jobState,
        catalog: catalog.ok ? { ok: true, count: catalog.count, sha256: catalog.sha256 } : { ok: false, code: catalog.code },
        sources: sourcePins.sources,
        unknownUniqueGuidCount,
        parity,
        financialTotals,
        beforeStateDigest: before.digest,
        beforeCounts: {
          saleAggregateLines: pgJsonArrayLength(before.snapshot.saleAggregateLinesJson),
          saleItemLines: pgJsonArrayLength(before.snapshot.saleItemLinesJson),
          returnLines: pgJsonArrayLength(before.snapshot.returnLinesJson),
          returnItemLines: pgJsonArrayLength(before.snapshot.returnItemLinesJson)
        }
      };
      if (!schema.ok) {
        return { ok: false, code: schema.code, message: schema.message, report };
      }
      if (!catalog.ok) {
        return { ok: false, code: catalog.code, message: catalog.message, report };
      }
      if (!input.testContext?.skipSourcePinChecks) {
        if (unknownUniqueGuidCount !== EXPECTED_UNKNOWN_CATALOG_GUID_COUNT) {
          return {
            ok: false,
            code: "UNKNOWN_GUID_COUNT_MISMATCH",
            message: `Expected ${EXPECTED_UNKNOWN_CATALOG_GUID_COUNT} unknown GUIDs.`,
            report
          };
        }
        if (!parity?.salesOk || !parity?.returnsOk) {
          return { ok: false, code: "SOURCE_PARITY_FAILED", message: "Aggregate/items parity check failed.", report };
        }
      }
      return { ok: true, report };
    });
  } finally {
    await pool.end();
  }
}

// src/onec-sales/september-2026-one-shot/read-only-preflight-runtime-config.ts
var SOURCE_KEYS = Object.keys(EXPECTED_SOURCE_FILES);
function parseSeptemberReadOnlyRuntimeConfig(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, code: "RUNTIME_CONFIG_INVALID", message: "Runtime config must be a JSON object." };
  }
  const obj = raw;
  if (obj.v !== 1) {
    return { ok: false, code: "RUNTIME_CONFIG_VERSION", message: "Expected runtime config v: 1." };
  }
  const databaseUrl = typeof obj.databaseUrl === "string" ? obj.databaseUrl.trim() : "";
  if (!databaseUrl) {
    return { ok: false, code: "DATABASE_URL_MISSING", message: "databaseUrl required in runtime config." };
  }
  if (!obj.sources || typeof obj.sources !== "object") {
    return { ok: false, code: "SOURCES_MISSING", message: "sources object required with all four FTP inputs." };
  }
  const sourcesObj = obj.sources;
  const buffers = {};
  for (const key of SOURCE_KEYS) {
    const entry = sourcesObj[key];
    if (!entry || typeof entry !== "object") {
      return { ok: false, code: "SOURCE_INPUT_MISSING", message: `Missing source config: ${key}` };
    }
    const path = typeof entry.path === "string" ? entry.path : "";
    const contentBase64 = typeof entry.contentBase64 === "string" ? entry.contentBase64 : "";
    if (path !== EXPECTED_SOURCE_FILES[key].path) {
      return {
        ok: false,
        code: "SOURCE_PATH_PIN_MISMATCH",
        message: `Source path for ${key} must be pinned FTP path ${EXPECTED_SOURCE_FILES[key].path}.`
      };
    }
    if (!contentBase64) {
      return { ok: false, code: "SOURCE_CONTENT_MISSING", message: `contentBase64 required for ${key}.` };
    }
    buffers[key] = Buffer.from(contentBase64, "base64");
    if (buffers[key].length === 0) {
      return { ok: false, code: "SOURCE_CONTENT_EMPTY", message: `Empty buffer for ${key}.` };
    }
  }
  const config = {
    v: 1,
    databaseUrl,
    sources: SOURCE_KEYS.reduce(
      (acc, key) => {
        acc[key] = {
          path: EXPECTED_SOURCE_FILES[key].path,
          contentBase64: sourcesObj[key].contentBase64
        };
        return acc;
      },
      {}
    )
  };
  return { ok: true, config, buffers };
}

// src/onec-clients/import-lock.ts
async function tryAcquireImportLock(client) {
  const result = await client.query(
    "SELECT pg_try_advisory_lock($1) AS locked",
    [IMPORT_ADVISORY_LOCK_KEY]
  );
  return result.rows[0]?.locked === true;
}

// src/onec-clients/apply.ts
var import_pg4 = require("pg");

// src/onec-exchange/state.ts
var import_pg3 = require("pg");

// src/onec-clients/apply.ts
init_holding_v2_pipeline_config();

// src/onec-clients/holding-v2-pipeline-apply.ts
init_desired_state();

// src/onec-clients/holding-v2-reconcile/apply-internals.ts
init_normalized_state();
init_projected_state();

// src/onec-clients/holding-v2-reconcile/reconcile-validation.ts
init_holding_v2_structure();

// src/onec-clients/holding-v2-reconcile/apply-internals.ts
init_repository();
init_type_category_merge();

// src/onec-clients/holding-v2-pipeline-apply.ts
init_type_category_merge();

// src/onec-clients/extended-apply.ts
init_extended_presence();
init_outlet_identity();

// src/onec-clients/commercial-fields.ts
function createEmptyCommercial() {
  return {
    discountProgram: null,
    discountAmount: null,
    markups: [],
    fieldPresence: {
      discountProgram: false,
      discountAmount: false,
      markups: false
    }
  };
}
var EMPTY_COMMERCIAL = createEmptyCommercial();

// src/onec-clients/extended-apply.ts
init_client_code_exchange_fields();
init_client_contract_exchange_fields();
init_counterparty_exchange_fields();
init_wholesale_client_exchange_fields();

// src/onec-clients/apply.ts
init_outlet_identity();
init_import_verification_fingerprint();

// src/onec-clients/manager-status.ts
init_uuid();

// src/onec-clients/apply.ts
init_roster_upsert();
var DB_CONNECT_TIMEOUT_MS = 5e3;
function createImportPool(databaseUrl) {
  const pgOptions = createPgPoolOptions(databaseUrl);
  const pool = new import_pg4.Pool({
    connectionString: pgOptions.connectionString,
    max: 1,
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl
  });
  pool.on("error", () => {
  });
  return pool;
}

// src/onec-sales/month-activation.ts
async function activateSalesMonthSnapshots(client, dataset, sourceSha256, saleMonthIsos) {
  for (const monthIso of saleMonthIsos) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_month_activation (dataset, sale_month, source_sha256, activated_at)
        VALUES ($1, $2::date, $3, NOW())
        ON CONFLICT (dataset, sale_month) DO UPDATE SET
          source_sha256 = EXCLUDED.source_sha256,
          activated_at = EXCLUDED.activated_at
      `,
      [dataset, monthIso, sourceSha256]
    );
  }
}

// src/onec-sales/matched-only/apply-ops.ts
function distinctMonthsIso(lines) {
  return [...new Set(lines.map((l) => l.saleMonthStartIso))].sort();
}
async function insertQuarantineRows(client, planHash, dataset, sourceSha256, lines) {
  for (const line of lines) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_import_quarantine_rows (
          plan_hash, dataset, source_sha256, source_row_index, legal_guid, sale_month
        )
        VALUES ($1, $2, $3, $4, $5::uuid, $6::date)
      `,
      [planHash, dataset, sourceSha256, line.sourceRowIndex, line.legalGuid, line.saleMonthStartIso]
    );
  }
}
async function upsertMonthStats(client, planHash, dataset, sourceSha256, saleMonthIso, full, matched, excluded) {
  await client.query(
    `
      INSERT INTO onec_v3_legal_sales_import_month_stats (
        dataset, sale_month, source_sha256, full_row_count, matched_row_count, excluded_row_count, last_plan_hash, updated_at
      )
      VALUES ($1, $2::date, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (dataset, sale_month, source_sha256) DO UPDATE SET
        full_row_count = EXCLUDED.full_row_count,
        matched_row_count = EXCLUDED.matched_row_count,
        excluded_row_count = EXCLUDED.excluded_row_count,
        last_plan_hash = EXCLUDED.last_plan_hash,
        updated_at = NOW()
    `,
    [dataset, saleMonthIso, sourceSha256, full, matched, excluded, planHash]
  );
}
function countByMonth(lines) {
  const map = /* @__PURE__ */ new Map();
  for (const line of lines) {
    map.set(line.saleMonthStartIso, (map.get(line.saleMonthStartIso) ?? 0) + 1);
  }
  return map;
}
async function recordMonthStatsForRoster(client, planHash, dataset, sourceSha256, fullLines, matchedLines) {
  const fullByMonth = countByMonth(fullLines);
  const matchedByMonth = countByMonth(matchedLines);
  for (const [month, full] of fullByMonth) {
    const matched = matchedByMonth.get(month) ?? 0;
    await upsertMonthStats(client, planHash, dataset, sourceSha256, month, full, matched, full - matched);
  }
}
async function applyMatchedOnlySaleAggregate(client, roster, partition, planHash, options = {}) {
  const sidecar049 = options.sidecar049 !== false;
  const months = distinctMonthsIso(roster.lines);
  if (months.length > 0) {
    await client.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = ANY($1::date[])`, [
      months
    ]);
  }
  let inserted = 0;
  for (const line of partition.matched) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sales_lines (
          legal_guid, sale_month, product_type,
          quantity, income, manual_discount, automatic_discount, total_discount,
          cost_price, additional_expenses, gross_profit, profitability,
          source_sha256, imported_at
        )
        VALUES (
          $1::uuid, $2::date, $3,
          $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric,
          $9::numeric, $10::numeric, $11::numeric, $12::numeric,
          $13, NOW()
        )
        ON CONFLICT (legal_guid, sale_month, product_type) DO UPDATE SET
          quantity = EXCLUDED.quantity,
          income = EXCLUDED.income,
          manual_discount = EXCLUDED.manual_discount,
          automatic_discount = EXCLUDED.automatic_discount,
          total_discount = EXCLUDED.total_discount,
          cost_price = EXCLUDED.cost_price,
          additional_expenses = EXCLUDED.additional_expenses,
          gross_profit = EXCLUDED.gross_profit,
          profitability = EXCLUDED.profitability,
          source_sha256 = EXCLUDED.source_sha256,
          imported_at = NOW()
      `,
      [
        line.legalGuid,
        line.saleMonthStartIso,
        line.productType,
        line.quantity,
        line.income,
        line.manualDiscount,
        line.automaticDiscount,
        line.totalDiscount,
        line.costPrice,
        line.additionalExpenses,
        line.grossProfit,
        line.profitability,
        roster.sourceSha256
      ]
    );
    inserted += 1;
  }
  await activateSalesMonthSnapshots(client, "sale_aggregate", roster.sourceSha256, months);
  await client.query(
    `
      INSERT INTO onec_v3_legal_sales_import_state (id, source_sha256, row_count, imported_at)
      VALUES (1, $1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET
        source_sha256 = EXCLUDED.source_sha256,
        row_count = EXCLUDED.row_count,
        imported_at = EXCLUDED.imported_at
    `,
    [roster.sourceSha256, partition.matched.length]
  );
  if (sidecar049) {
    await insertQuarantineRows(
      client,
      planHash,
      "sale_aggregate",
      roster.sourceSha256,
      partition.excluded
    );
    await recordMonthStatsForRoster(
      client,
      planHash,
      "sale_aggregate",
      roster.sourceSha256,
      roster.lines,
      partition.matched
    );
  }
  return inserted;
}
async function applyMatchedOnlySaleItems(client, roster, partition, planHash, options = {}) {
  const sidecar049 = options.sidecar049 !== false;
  const months = distinctMonthsIso(roster.lines);
  await client.query(
    `DELETE FROM onec_v3_legal_sale_item_lines WHERE sale_month = ANY($1::date[]) AND source_sha256 <> $2`,
    [months, roster.sourceSha256]
  );
  await client.query(
    `DELETE FROM onec_v3_legal_sale_item_lines WHERE source_sha256 = $1 AND sale_month = ANY($2::date[])`,
    [roster.sourceSha256, months]
  );
  let inserted = 0;
  for (const line of partition.matched) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_sale_item_lines (
          source_sha256, source_row_index, legal_guid, sale_month, product_type,
          guid_item, name_item, quantity, income,
          manual_discount, automatic_discount, total_discount,
          cost_price, additional_expenses, gross_profit, profitability,
          catalog_matched, imported_at
        )
        VALUES (
          $1, $2, $3::uuid, $4::date, $5,
          $6::uuid, $7, $8::numeric, $9::numeric,
          $10::numeric, $11::numeric, $12::numeric,
          $13::numeric, $14::numeric, $15::numeric, $16::numeric,
          TRUE, NOW()
        )
      `,
      [
        roster.sourceSha256,
        line.sourceRowIndex,
        line.legalGuid,
        line.saleMonthStartIso,
        line.productType,
        line.guidItem,
        line.nameItem,
        line.quantity,
        line.income,
        line.manualDiscount,
        line.automaticDiscount,
        line.totalDiscount,
        line.costPrice,
        line.additionalExpenses,
        line.grossProfit,
        line.profitability
      ]
    );
    inserted += 1;
  }
  await client.query(
    `
      INSERT INTO onec_v3_legal_sale_item_import_state (id, source_sha256, row_count, imported_at)
      VALUES (1, $1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET
        source_sha256 = EXCLUDED.source_sha256,
        row_count = EXCLUDED.row_count,
        imported_at = EXCLUDED.imported_at
    `,
    [roster.sourceSha256, partition.matched.length]
  );
  await activateSalesMonthSnapshots(client, "sale_items", roster.sourceSha256, months);
  if (sidecar049) {
    await insertQuarantineRows(client, planHash, "sale_items", roster.sourceSha256, partition.excluded);
    await recordMonthStatsForRoster(
      client,
      planHash,
      "sale_items",
      roster.sourceSha256,
      roster.lines,
      partition.matched
    );
  }
  return inserted;
}
async function applyMatchedReturnTable(client, table, stateTable, dataset, roster, partition, planHash, withItems, options = {}) {
  const sidecar049 = options.sidecar049 !== false;
  const months = distinctMonthsIso(roster.lines);
  await client.query(
    `DELETE FROM ${table} WHERE sale_month = ANY($1::date[]) AND source_sha256 <> $2`,
    [months, roster.sourceSha256]
  );
  await client.query(
    `DELETE FROM ${table} WHERE source_sha256 = $1 AND sale_month = ANY($2::date[])`,
    [roster.sourceSha256, months]
  );
  let inserted = 0;
  for (const line of partition.matched) {
    if (withItems && "guidItem" in line) {
      await client.query(
        `
          INSERT INTO onec_v3_legal_return_item_lines (
            source_sha256, source_row_index, legal_guid, sale_month, product_type,
            guid_item, name_item, quantity, income, catalog_matched, imported_at
          )
          VALUES ($1, $2, $3::uuid, $4::date, $5, $6::uuid, $7, $8::numeric, $9::numeric, TRUE, NOW())
        `,
        [
          roster.sourceSha256,
          line.sourceRowIndex,
          line.legalGuid,
          line.saleMonthStartIso,
          line.productType,
          line.guidItem,
          line.nameItem,
          line.quantity,
          line.income
        ]
      );
    } else {
      await client.query(
        `
          INSERT INTO onec_v3_legal_return_lines (
            source_sha256, source_row_index, legal_guid, sale_month, product_type,
            quantity, income, catalog_matched, imported_at
          )
          VALUES ($1, $2, $3::uuid, $4::date, $5, $6::numeric, $7::numeric, TRUE, NOW())
        `,
        [
          roster.sourceSha256,
          line.sourceRowIndex,
          line.legalGuid,
          line.saleMonthStartIso,
          line.productType,
          line.quantity,
          line.income
        ]
      );
    }
    inserted += 1;
  }
  await client.query(
    `
      INSERT INTO ${stateTable} (id, source_sha256, row_count, imported_at)
      VALUES (1, $1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET
        source_sha256 = EXCLUDED.source_sha256,
        row_count = EXCLUDED.row_count,
        imported_at = EXCLUDED.imported_at
    `,
    [roster.sourceSha256, partition.matched.length]
  );
  await activateSalesMonthSnapshots(client, dataset, roster.sourceSha256, months);
  if (sidecar049) {
    await insertQuarantineRows(client, planHash, dataset, roster.sourceSha256, partition.excluded);
    await recordMonthStatsForRoster(
      client,
      planHash,
      dataset,
      roster.sourceSha256,
      roster.lines,
      partition.matched
    );
  }
  return inserted;
}
async function applyMatchedOnlyReturnsAggregate(client, roster, partition, planHash, options = {}) {
  return applyMatchedReturnTable(
    client,
    "onec_v3_legal_return_lines",
    "onec_v3_legal_return_import_state",
    "return_aggregate",
    roster,
    partition,
    planHash,
    false,
    options
  );
}
async function applyMatchedOnlyReturnItems(client, roster, partition, planHash, options = {}) {
  return applyMatchedReturnTable(
    client,
    "onec_v3_legal_return_item_lines",
    "onec_v3_legal_return_item_import_state",
    "return_items",
    roster,
    partition,
    planHash,
    true,
    options
  );
}

// src/onec-sales/matched-only/scope.ts
function deriveSaleMonthsIsoFromRosters(rosters) {
  return [
    .../* @__PURE__ */ new Set([
      ...rosters.saleAggregate.lines.map((l) => l.saleMonthStartIso),
      ...rosters.saleItems.lines.map((l) => l.saleMonthStartIso),
      ...rosters.returnsAggregate.lines.map((l) => l.saleMonthStartIso),
      ...rosters.returnItems.lines.map((l) => l.saleMonthStartIso)
    ])
  ].sort();
}
function computeOperationsDigest(sourceHashes, saleMonthsIso) {
  return sha256CanonicalJson({
    v: 1,
    sourceHashes,
    saleMonthsIso: [...saleMonthsIso].sort()
  });
}

// src/onec-sales/matched-only/state-digest.ts
async function captureScopedBeforeState(client, saleMonthsIso, options) {
  const months = [...saleMonthsIso].sort();
  const [
    saleAggregateLines,
    saleItemLines,
    returnLines,
    returnItemLines,
    importStates,
    monthActivations,
    monthStats,
    quarantineRows
  ] = await Promise.all([
    client.query(
      `SELECT * FROM onec_v3_legal_sales_lines WHERE sale_month = ANY($1::date[]) ORDER BY legal_guid, sale_month, product_type`,
      [months]
    ),
    client.query(
      `SELECT * FROM onec_v3_legal_sale_item_lines WHERE sale_month = ANY($1::date[]) ORDER BY source_sha256, source_row_index`,
      [months]
    ),
    client.query(
      `SELECT * FROM onec_v3_legal_return_lines WHERE sale_month = ANY($1::date[]) ORDER BY source_sha256, source_row_index`,
      [months]
    ),
    client.query(
      `SELECT * FROM onec_v3_legal_return_item_lines WHERE sale_month = ANY($1::date[]) ORDER BY source_sha256, source_row_index`,
      [months]
    ),
    client.query(
      `
        SELECT 'sale_aggregate' AS dataset, source_sha256, row_count::text, imported_at::text
        FROM onec_v3_legal_sales_import_state WHERE id = 1
        UNION ALL
        SELECT 'sale_items', source_sha256, row_count::text, imported_at::text
        FROM onec_v3_legal_sale_item_import_state WHERE id = 1
        UNION ALL
        SELECT 'return_aggregate', source_sha256, row_count::text, imported_at::text
        FROM onec_v3_legal_return_import_state WHERE id = 1
        UNION ALL
        SELECT 'return_items', source_sha256, row_count::text, imported_at::text
        FROM onec_v3_legal_return_item_import_state WHERE id = 1
      `
    ),
    client.query(
      `SELECT dataset, sale_month::text, source_sha256, activated_at::text
       FROM onec_v3_legal_sales_month_activation
       WHERE sale_month = ANY($1::date[])
       ORDER BY dataset, sale_month`,
      [months]
    ),
    options?.omit049SidecarTables ? Promise.resolve({ rows: [] }) : safeQuery(
      client,
      `SELECT dataset, sale_month::text, source_sha256, full_row_count, matched_row_count, excluded_row_count, last_plan_hash, updated_at::text
       FROM onec_v3_legal_sales_import_month_stats
       WHERE sale_month = ANY($1::date[])
       ORDER BY dataset, sale_month, source_sha256`,
      [months]
    ),
    options?.omit049SidecarTables ? Promise.resolve({ rows: [] }) : safeQuery(
      client,
      `SELECT plan_hash, dataset, source_sha256, source_row_index, lower(legal_guid::text) AS legal_guid, sale_month::text, quarantine_reason, source_path
       FROM onec_v3_legal_sales_import_quarantine_rows
       WHERE sale_month = ANY($1::date[])
       ORDER BY dataset, source_sha256, source_row_index, plan_hash, legal_guid`,
      [months]
    )
  ]);
  const payload = {
    v: 1,
    saleMonthsIso: months,
    saleAggregateLines: saleAggregateLines.rows,
    saleItemLines: saleItemLines.rows,
    returnLines: returnLines.rows,
    returnItemLines: returnItemLines.rows,
    importStates: importStates.rows,
    monthActivations: monthActivations.rows,
    monthStats: monthStats.rows,
    quarantineRows: quarantineRows.rows
  };
  const businessPayload = payload;
  return {
    digest: sha256CanonicalJson(businessPayload),
    payload,
    businessDigest: sha256CanonicalJson(businessPayload)
  };
}
async function safeQuery(client, sql, params) {
  try {
    return await client.query(sql, params);
  } catch (error) {
    const code = error.code;
    if (code === "42P01") {
      return { rows: [] };
    }
    throw error;
  }
}

// src/onec-sales/matched-only/plan-build.ts
function planHashFromPlan(plan) {
  return sha256CanonicalJson(plan);
}
async function buildMatchedOnlyBundlePlan(client, input, options) {
  const known = await loadKnownLegalGuidSet(client);
  const report = analyzeSalesBundle({
    salesAggregate: input.saleAggregate,
    salesItems: input.saleItems,
    returnsAggregate: input.returnsAggregate,
    returnsItems: input.returnItems,
    knownCatalogLegalGuids: known
  });
  if (!isBundleParityOk(report)) {
    throw new Error("BUNDLE_PARITY_FAILED");
  }
  const partition = partitionSalesBundle({
    saleAggregate: input.saleAggregate,
    saleItems: input.saleItems,
    returnsAggregate: input.returnsAggregate,
    returnItems: input.returnItems,
    known
  });
  const saleMonthsIso = deriveSaleMonthsIsoFromRosters({
    saleAggregate: input.saleAggregate,
    saleItems: input.saleItems,
    returnsAggregate: input.returnsAggregate,
    returnItems: input.returnItems
  });
  const periods = [
    .../* @__PURE__ */ new Set([
      ...input.saleAggregate.lines.map((l) => l.saleMonthYyyyMm),
      ...input.saleItems.lines.map((l) => l.saleMonthYyyyMm),
      ...input.returnsAggregate.lines.map((l) => l.saleMonthYyyyMm),
      ...input.returnItems.lines.map((l) => l.saleMonthYyyyMm)
    ])
  ].sort();
  const trustedBefore = options?.trustedBeforeStateSha256?.trim();
  const beforeStateSha256 = trustedBefore ? trustedBefore : (await captureScopedBeforeState(client, saleMonthsIso)).businessDigest;
  const sourceHashes = {
    saleAggregate: input.saleAggregate.sourceSha256,
    saleItems: input.saleItems.sourceSha256,
    returnsAggregate: input.returnsAggregate.sourceSha256,
    returnItems: input.returnItems.sourceSha256
  };
  const scope = {
    saleMonthsIso,
    operationsDigest: computeOperationsDigest(sourceHashes, saleMonthsIso)
  };
  const plan = {
    v: 1,
    policy: "matched-only",
    sourceHashes,
    periods,
    parity: {
      salesParityOk: report.parity.onlyAggregate === 0 && report.parity.onlyItems === 0 && report.parity.metricMismatches === 0,
      returnsParityOk: report.returnsParity.parityOk
    },
    identity: {
      targetDbFingerprint: input.targetDbFingerprint
    },
    catalog: {
      fingerprint: computeCatalogFingerprint(known),
      knownLegalEntityCount: known.size,
      unknownUnionDigest: computeUnknownUnionDigest(partition.unknownGuids),
      unknownUnionCount: partition.unknownGuids.length
    },
    counts: {
      saleAggregate: partition.saleAggregate.counts,
      saleItems: partition.saleItems.counts,
      returnsAggregate: partition.returnsAggregate.counts,
      returnItems: partition.returnItems.counts
    },
    scope,
    beforeStateSha256
  };
  return { plan, planHash: planHashFromPlan(plan), report };
}

// src/onec-sales/matched-only/commit-outcome.ts
function isCommitTransportUncertainty(error) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error;
  const code = record.code ?? "";
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "57P01") {
    return true;
  }
  const message = record.message?.toLowerCase() ?? "";
  return message.includes("timeout") || message.includes("connection terminated") || message.includes("connection terminated unexpectedly");
}

// src/onec-sales/september-2026-one-shot/before-state-empty-verify.ts
function pgJsonArrayLength2(jsonText) {
  const parsed = JSON.parse(jsonText);
  return Array.isArray(parsed) ? parsed.length : 0;
}
async function assertSeptember047048EmptyBeforeState(client, expectedDigest) {
  const before = await captureSeptember047048BeforeState(client);
  if (before.digest !== expectedDigest) {
    return { ok: false, code: "BEFORE_STATE_DIGEST_MISMATCH", message: "Before-state digest mismatch." };
  }
  const counts = {
    saleAggregateLines: pgJsonArrayLength2(before.snapshot.saleAggregateLinesJson),
    saleItemLines: pgJsonArrayLength2(before.snapshot.saleItemLinesJson),
    returnLines: pgJsonArrayLength2(before.snapshot.returnLinesJson),
    returnItemLines: pgJsonArrayLength2(before.snapshot.returnItemLinesJson),
    importStates: pgJsonArrayLength2(before.snapshot.importStatesJson),
    monthActivations: pgJsonArrayLength2(before.snapshot.monthActivationsJson)
  };
  if (counts.saleAggregateLines !== 0 || counts.saleItemLines !== 0 || counts.returnLines !== 0 || counts.returnItemLines !== 0 || counts.monthActivations !== 0) {
    return { ok: false, code: "BEFORE_STATE_NOT_EMPTY", message: "September line tables must be empty before apply." };
  }
  if (counts.importStates !== 0) {
    return { ok: false, code: "BEFORE_IMPORT_STATE_PRESENT", message: "Import state id=1 rows must be absent." };
  }
  return { ok: true };
}

// src/onec-sales/september-2026-one-shot/operator-data-scope.ts
var import_node_crypto9 = require("node:crypto");
var import_promises = require("node:fs/promises");
var FROZEN_OPERATOR_DATA_SCOPE_KIND = "FROZEN_SEPTEMBER_MATCHED_ONLY_SCOPE_CANDIDATE_NOT_WRITE_AUTHORIZATION";
function operatorDataScopeSha256(bytes) {
  return (0, import_node_crypto9.createHash)("sha256").update(bytes).digest("hex");
}
function unknownUnionSha256FromGuids(guids) {
  const sorted = guids.map((g) => g.toLowerCase()).sort();
  return (0, import_node_crypto9.createHash)("sha256").update(JSON.stringify(sorted), "utf8").digest("hex");
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateOperatorDataScopeDocument(doc, options) {
  if (doc.v !== 1 || doc.kind !== FROZEN_OPERATOR_DATA_SCOPE_KIND) {
    return { ok: false, code: "SCOPE_VERSION", message: "Invalid scope version/kind." };
  }
  if (doc.appId !== TIMEWEB_APP_ID || doc.databaseId !== TIMEWEB_DB_ID) {
    return { ok: false, code: "SCOPE_TARGET_IDS", message: "App/DB id mismatch." };
  }
  if (!options?.skipTargetFingerprintPin && doc.targetFingerprint !== EXPECTED_TARGET_DB_FINGERPRINT) {
    return { ok: false, code: "SCOPE_TARGET_FINGERPRINT", message: "Target fingerprint mismatch." };
  }
  if (doc.appRelease !== APP_RELEASE_REF_FOR_COMPATIBILITY) {
    return { ok: false, code: "SCOPE_APP_RELEASE", message: "App release mismatch." };
  }
  if (doc.saleMonth !== SEPTEMBER_2026_SALE_MONTH_ISO) {
    return { ok: false, code: "SCOPE_SALE_MONTH", message: "Sale month mismatch." };
  }
  if (!options?.skipProductionPins && doc.sourceDirectory !== FIXED_SOURCE_SNAPSHOT_DIRECTORY) {
    return { ok: false, code: "SCOPE_SOURCE_DIRECTORY", message: "Source directory mismatch." };
  }
  if (!options?.skipProductionPins && doc.manifestSha256 !== EXPECTED_SOURCE_MANIFEST_SHA256) {
    return { ok: false, code: "SCOPE_MANIFEST_SHA", message: "Manifest SHA mismatch." };
  }
  if (typeof doc.allowedMetadata !== "string" || !doc.allowedMetadata.trim()) {
    return { ok: false, code: "SCOPE_ALLOWED_METADATA", message: "allowedMetadata must be a non-empty string." };
  }
  for (const key of Object.keys(EXPECTED_SOURCE_FILES)) {
    const pin = EXPECTED_SOURCE_FILES[key];
    const src = doc.sources[key];
    const counts = doc.counts[key];
    if (!src || typeof src.guidFields !== "number" || typeof src.legacyIdFields !== "number") {
      return { ok: false, code: "SCOPE_SOURCE_FIELDS", message: `Invalid source field counters: ${key}` };
    }
    if (!options?.skipProductionPins && (src.sha256 !== pin.sha256 || src.rawRows !== pin.counts.full)) {
      return { ok: false, code: "SCOPE_SOURCE_PIN", message: `Source pin mismatch: ${key}` };
    }
    if (!options?.skipProductionPins) {
      if (counts.full !== pin.counts.full || counts.matched !== pin.counts.matched || counts.excluded !== pin.counts.excluded) {
        return { ok: false, code: "SCOPE_SOURCE_COUNTS", message: `Source counts mismatch: ${key}` };
      }
    }
  }
  if (!options?.skipProductionPins) {
    if (doc.catalog.count !== EXPECTED_CATALOG_LEGAL_ENTITY_COUNT) {
      return { ok: false, code: "SCOPE_CATALOG_COUNT", message: "Catalog count mismatch." };
    }
    if (doc.catalog.sha256 !== EXPECTED_CATALOG_GUID_SET_SHA256) {
      return { ok: false, code: "SCOPE_CATALOG_SHA", message: "Catalog SHA mismatch." };
    }
    if (doc.unknownUniqueGuidCount !== EXPECTED_UNKNOWN_CATALOG_GUID_COUNT) {
      return { ok: false, code: "SCOPE_UNKNOWN_COUNT", message: "Unknown GUID count mismatch." };
    }
  }
  if (!options?.skipProductionPins && doc.beforeStateDigest !== EXPECTED_EMPTY_BEFORE_STATE_DIGEST) {
    return { ok: false, code: "SCOPE_BEFORE_DIGEST", message: "Before digest mismatch." };
  }
  const bc = doc.beforeCounts;
  if (bc.saleAggregateLinesJson !== 0 || bc.saleItemLinesJson !== 0 || bc.returnLinesJson !== 0 || bc.returnItemLinesJson !== 0 || bc.importStatesJson !== 0 || bc.monthActivationsJson !== 0) {
    return { ok: false, code: "SCOPE_BEFORE_COUNTS", message: "Before counts must be empty." };
  }
  if (!options?.skipProductionPins) {
    if (doc.expectedMatchedRows !== EXPECTED_MATCHED_ROW_TOTAL || doc.excludedRows !== EXPECTED_EXCLUDED_ROW_TOTAL) {
      return { ok: false, code: "SCOPE_ROW_TOTALS", message: "Matched/excluded totals mismatch." };
    }
    if (doc.migrationsAllowed !== false || doc.sourceFtpRefreshAllowed !== false || doc.backupBusinessValuesAuthorized !== false || doc.applyAuthorized !== false || doc.rollbackAuthorized !== false) {
      return { ok: false, code: "CANDIDATE_NOT_WRITE_AUTHORIZATION", message: "Write flags must remain false." };
    }
  }
  if (!isRecord(doc.financialTotals)) {
    return { ok: false, code: "SCOPE_FINANCIAL_TOTALS", message: "financialTotals must be an object." };
  }
  return { ok: true };
}
async function loadAndVerifyOperatorDataScope(input) {
  const bytes = await (0, import_promises.readFile)(input.scopeFilePath);
  const sha = operatorDataScopeSha256(bytes);
  if (!input.skipProductionShaPin && sha !== input.expectedSha256) {
    return { ok: false, code: "OPERATOR_DATA_SCOPE_SHA_MISMATCH", message: "Operator data scope SHA mismatch." };
  }
  if (!input.skipProductionShaPin && sha !== EXPECTED_OPERATOR_DATA_SCOPE_SHA256) {
    return { ok: false, code: "OPERATOR_DATA_SCOPE_SHA_MISMATCH", message: "Pinned operator data scope SHA mismatch." };
  }
  const doc = JSON.parse(bytes.toString("utf8"));
  const valid = validateOperatorDataScopeDocument(doc, {
    skipProductionPins: input.skipProductionShaPin,
    skipTargetFingerprintPin: input.skipTargetFingerprintPin
  });
  if (!valid.ok) return valid;
  return { ok: true, scope: doc, sha256: sha };
}

// src/onec-sales/september-2026-one-shot/source-snapshot-loader.ts
var import_node_crypto10 = require("node:crypto");
var import_promises3 = require("node:fs/promises");

// src/onec-sales/september-2026-one-shot/snapshot-path-security.ts
var import_promises2 = require("node:fs/promises");
var import_node_path = require("node:path");
var SNAPSHOT_MAX_FILE_BYTES = 32 * 1024 * 1024;
async function assertSnapshotDirectorySecurity(directory) {
  const root = (0, import_node_path.resolve)(directory);
  try {
    const stat = await (0, import_promises2.lstat)(root);
    if (stat.isSymbolicLink()) {
      return { ok: false, code: "SNAPSHOT_SYMLINK", message: "Snapshot directory must not be a symlink." };
    }
    const mode = stat.mode & 511;
    if (mode & 63) {
      return { ok: false, code: "SNAPSHOT_DIR_NOT_PRIVATE", message: "Snapshot directory must be mode 0700." };
    }
  } catch {
    return { ok: false, code: "SNAPSHOT_DIR_MISSING", message: "Snapshot directory missing." };
  }
  return { ok: true };
}
async function readSnapshotFileSecure(directory, fileName) {
  const root = (0, import_node_path.resolve)(directory);
  const filePath = (0, import_node_path.resolve)(root, fileName);
  if ((0, import_node_path.dirname)(filePath) !== root && !filePath.startsWith(`${root}/`)) {
    return { ok: false, code: "SNAPSHOT_PATH_ESCAPE", message: "Snapshot path escapes directory." };
  }
  try {
    const stat = await (0, import_promises2.lstat)(filePath);
    if (stat.isSymbolicLink()) {
      return { ok: false, code: "SNAPSHOT_SYMLINK", message: `${fileName} must not be a symlink.` };
    }
    const mode = stat.mode & 511;
    if (mode & 63) {
      return { ok: false, code: "SNAPSHOT_FILE_NOT_PRIVATE", message: `${fileName} must be mode 0600.` };
    }
    if (stat.size > SNAPSHOT_MAX_FILE_BYTES) {
      return { ok: false, code: "SNAPSHOT_FILE_TOO_LARGE", message: `${fileName} exceeds 32MiB bound.` };
    }
    const bytes = await (0, import_promises2.readFile)(filePath);
    if (bytes.length > SNAPSHOT_MAX_FILE_BYTES) {
      return { ok: false, code: "SNAPSHOT_FILE_TOO_LARGE", message: `${fileName} exceeds 32MiB bound.` };
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, code: "SOURCE_FILE_MISSING", message: `Missing snapshot file ${fileName}.` };
  }
}

// src/onec-sales/september-2026-one-shot/source-snapshot-loader.ts
var MANIFEST_FILE = "manifest.json";
var FIXED_SNAPSHOT_FILE_NAMES = [
  MANIFEST_FILE,
  ...Object.values(EXPECTED_SOURCE_FILES).map((f) => f.fileName)
];
function sha256Buffer(bytes) {
  return (0, import_node_crypto10.createHash)("sha256").update(bytes).digest("hex");
}
async function loadVerifiedSourceSnapshotFromDirectory(input) {
  if (!input.skipPathSecurity) {
    const dirSec = await assertSnapshotDirectorySecurity(input.directory);
    if (!dirSec.ok) return dirSec;
  }
  let entries;
  try {
    entries = await (0, import_promises3.readdir)(input.directory);
  } catch {
    return { ok: false, code: "SNAPSHOT_DIR_MISSING", message: "Snapshot directory missing." };
  }
  const expectedSet = new Set(FIXED_SNAPSHOT_FILE_NAMES);
  if (entries.length !== expectedSet.size || !entries.every((e) => expectedSet.has(e))) {
    return {
      ok: false,
      code: "SNAPSHOT_FILE_SET_MISMATCH",
      message: "Snapshot directory must contain exactly manifest.json and four pinned source files."
    };
  }
  const manifestRead = input.skipPathSecurity ? await readFileUnsafe(input.directory, MANIFEST_FILE) : await readSnapshotFileSecure(input.directory, MANIFEST_FILE);
  if (!manifestRead.ok) return manifestRead;
  const manifestBytes = manifestRead.bytes;
  if (manifestBytes.length > SNAPSHOT_MAX_FILE_BYTES) {
    return { ok: false, code: "SNAPSHOT_FILE_TOO_LARGE", message: "manifest.json exceeds 32MiB bound." };
  }
  const manifestSha256 = sha256Buffer(manifestBytes);
  const expectedManifest = input.expectedManifestSha256 ?? EXPECTED_SOURCE_MANIFEST_SHA256;
  if (!input.skipManifestShaPin && manifestSha256 !== expectedManifest) {
    return { ok: false, code: "MANIFEST_SHA_MISMATCH", message: "Snapshot manifest SHA mismatch." };
  }
  if (input.scope && !input.skipManifestShaPin && manifestSha256 !== input.scope.manifestSha256) {
    return { ok: false, code: "MANIFEST_SCOPE_MISMATCH", message: "Manifest SHA does not match operator scope." };
  }
  const buffers = {};
  for (const key of Object.keys(EXPECTED_SOURCE_FILES)) {
    const fileName = EXPECTED_SOURCE_FILES[key].fileName;
    const fileRead = input.skipPathSecurity ? await readFileUnsafe(input.directory, fileName) : await readSnapshotFileSecure(input.directory, fileName);
    if (!fileRead.ok) return fileRead;
    const bytes = fileRead.bytes;
    if (!input.skipSourcePinVerification) {
      const pin = verifySourceBufferPin(key, bytes);
      if (!pin.ok) {
        return pin;
      }
      if (input.scope) {
        const scopeSrc = input.scope.sources[key];
        const fileSha = sha256Buffer(bytes);
        if (scopeSrc.sha256 !== fileSha || scopeSrc.bytes !== bytes.length) {
          return { ok: false, code: "SOURCE_SCOPE_MISMATCH", message: `Source bytes/SHA mismatch vs scope: ${key}` };
        }
      }
    }
    buffers[key] = bytes;
  }
  return { ok: true, buffers, manifestSha256 };
}
async function readFileUnsafe(directory, fileName) {
  const { readFile: readFile6 } = await import("node:fs/promises");
  const { join: joinPath } = await import("node:path");
  try {
    const bytes = await readFile6(joinPath(directory, fileName));
    return { ok: true, bytes };
  } catch {
    return { ok: false, code: "SOURCE_FILE_MISSING", message: `Missing snapshot file ${fileName}.` };
  }
}

// src/onec-sales/september-2026-one-shot/write-grants.ts
var ENV_BY_KIND = {
  backup: "SEPTEMBER_2026_BACKUP_GRANT_REF",
  apply: "SEPTEMBER_2026_APPLY_GRANT_REF",
  rollback: "SEPTEMBER_2026_ROLLBACK_GRANT_REF"
};
function scopeWriteFlag(scope, kind) {
  if (kind === "backup") return scope.backupBusinessValuesAuthorized;
  if (kind === "apply") return scope.applyAuthorized;
  return scope.rollbackAuthorized;
}
function assertSeptemberWriteGrant(kind, scope, humanGrantRef, options) {
  const flag = scopeWriteFlag(scope, kind);
  if (options?.allowAuthorizedScope) {
    if (!flag) {
      return {
        ok: false,
        code: "WRITE_SCOPE_NOT_AUTHORIZED",
        message: `Scope write flag must be true for this write operation.`
      };
    }
  } else if (flag) {
    return {
      ok: false,
      code: "CANDIDATE_NOT_WRITE_AUTHORIZATION",
      message: `Scope write flags must remain false until separate human grant.`
    };
  }
  const envName = ENV_BY_KIND[kind];
  const ref = process.env[envName]?.trim();
  if (!ref) {
    return {
      ok: false,
      code: "WRITE_GRANT_REQUIRED",
      message: `${envName} is required for ${kind} operations.`
    };
  }
  if (ref !== humanGrantRef) {
    return { ok: false, code: "WRITE_GRANT_MISMATCH", message: "Human grant ref mismatch." };
  }
  if (process.env.TEST_DATABASE_URL?.trim() && process.env.DATABASE_URL?.trim() === process.env.TEST_DATABASE_URL?.trim()) {
    return {
      ok: false,
      code: "PRODUCTION_URL_TEST_MIXED",
      message: "DATABASE_URL must not equal TEST_DATABASE_URL on write paths."
    };
  }
  return { ok: true, ref };
}

// src/onec-nightly-exchange/config.ts
var SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
var WINDOW_MINUTES_DECIMAL_PATTERN = /^\d+$/;
var MIN_WINDOW_MINUTES = 1;
var MAX_WINDOW_MINUTES = 180;
function parseBoolean(value) {
  if (value == null || value.trim() === "") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return null;
}
function parseRequiredScheduleTime(raw) {
  const value = raw?.trim();
  if (!value) {
    return null;
  }
  if (!SCHEDULE_TIME_PATTERN.test(value)) {
    return null;
  }
  return value;
}
function parseRequiredWindowMinutes(raw) {
  const value = raw?.trim();
  if (!value || !WINDOW_MINUTES_DECIMAL_PATTERN.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < MIN_WINDOW_MINUTES || parsed > MAX_WINDOW_MINUTES) {
    return null;
  }
  return parsed;
}
function loadNightlyExchangeConfig(env = process.env) {
  const enabledFlag = parseBoolean(env.ONEC_NIGHTLY_EXCHANGE_ENABLED);
  const enabled = enabledFlag === true;
  if (!enabled) {
    return { ok: true, enabled: false };
  }
  const scheduleTime = parseRequiredScheduleTime(env.ONEC_NIGHTLY_EXCHANGE_TIME);
  if (!env.ONEC_NIGHTLY_EXCHANGE_TIME?.trim()) {
    return {
      ok: false,
      error: "ONEC_NIGHTLY_EXCHANGE_TIME is required when ONEC_NIGHTLY_EXCHANGE_ENABLED=true."
    };
  }
  if (!scheduleTime) {
    return {
      ok: false,
      error: `Invalid ONEC_NIGHTLY_EXCHANGE_TIME: ${env.ONEC_NIGHTLY_EXCHANGE_TIME.trim()}`
    };
  }
  const windowRaw = env.ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES?.trim();
  if (!windowRaw) {
    return {
      ok: false,
      error: "ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES is required when ONEC_NIGHTLY_EXCHANGE_ENABLED=true."
    };
  }
  const windowMinutes = parseRequiredWindowMinutes(env.ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES);
  if (windowMinutes == null) {
    return {
      ok: false,
      error: `Invalid ONEC_NIGHTLY_EXCHANGE_WINDOW_MINUTES: ${windowRaw}`
    };
  }
  return {
    ok: true,
    enabled: true,
    config: {
      scheduleTime,
      timezone: "Europe/Moscow",
      windowMinutes
    }
  };
}
function isNightlyExchangeScheduleEnabled(env = process.env) {
  const loaded = loadNightlyExchangeConfig(env);
  return loaded.ok && loaded.enabled;
}

// src/onec-sales/september-2026-one-shot/write-preflight-gates.ts
async function assertWritePreflightGatesAfterImportLock(client, testContext) {
  const schema = await assertSchema047048Ready(client);
  if (!schema.ok) {
    return { ok: false, code: schema.code, message: schema.message };
  }
  const jobs = await readSeptemberPreflightJobState(client);
  if (jobs.pendingOrRunningImportJobs > 0) {
    return { ok: false, code: "IMPORT_JOBS_ACTIVE", message: "Active import jobs present." };
  }
  if (jobs.pendingOrRunningDiagnosticJobs > 0) {
    return { ok: false, code: "DIAGNOSTIC_JOBS_ACTIVE", message: "Active diagnostic jobs present." };
  }
  if (!testContext?.skipNightlySchedulerPin && isNightlyExchangeScheduleEnabled()) {
    return {
      ok: false,
      code: "NIGHTLY_SCHEDULER_ENABLED",
      message: "Nightly exchange scheduler must be disabled (ONEC_NIGHTLY_EXCHANGE_ENABLED not true)."
    };
  }
  const blocked = await client.query(
    `SELECT apply_blocked FROM onec_exchange_state WHERE id = 1`
  );
  if (blocked.rows[0]?.apply_blocked) {
    return { ok: false, code: "EXCHANGE_APPLY_BLOCKED", message: "Exchange apply_blocked is set." };
  }
  if (testContext?.skipCatalogPin !== true) {
    const catalog = await verifyCatalogPin(client);
    if (!catalog.ok) {
      return { ok: false, code: catalog.code, message: catalog.message };
    }
  }
  return { ok: true };
}

// src/onec-sales/september-2026-one-shot/verify-047-048-metadata.ts
async function verifySeptember047048Metadata(client, partition, rosters) {
  const states = [
    { table: "onec_v3_legal_sales_import_state", sha: rosters.saleAggregate.sourceSha256, count: partition.saleAggregate.matched.length },
    { table: "onec_v3_legal_sale_item_import_state", sha: rosters.saleItems.sourceSha256, count: partition.saleItems.matched.length },
    { table: "onec_v3_legal_return_import_state", sha: rosters.returnsAggregate.sourceSha256, count: partition.returnsAggregate.matched.length },
    { table: "onec_v3_legal_return_item_import_state", sha: rosters.returnItems.sourceSha256, count: partition.returnItems.matched.length }
  ];
  for (const s of states) {
    const row = await client.query(
      `SELECT row_count, trim(source_sha256) AS source_sha256 FROM ${s.table} WHERE id = 1`
    );
    if ((row.rows[0]?.row_count ?? -1) !== s.count) {
      return { ok: false, code: "PERSISTED_IMPORT_STATE_MISMATCH", message: `${s.table} row_count mismatch.` };
    }
    if (row.rows[0]?.source_sha256 !== s.sha) {
      return { ok: false, code: "PERSISTED_IMPORT_STATE_MISMATCH", message: `${s.table} source_sha256 mismatch.` };
    }
  }
  const activationPairs = [
    { dataset: "sale_aggregate", sha: rosters.saleAggregate.sourceSha256 },
    { dataset: "sale_items", sha: rosters.saleItems.sourceSha256 },
    { dataset: "return_aggregate", sha: rosters.returnsAggregate.sourceSha256 },
    { dataset: "return_items", sha: rosters.returnItems.sourceSha256 }
  ];
  const month = rosters.saleAggregate.lines[0]?.saleMonthStartIso ?? "2026-09-01";
  for (const pair of activationPairs) {
    const matchedCount = pair.dataset === "sale_aggregate" ? partition.saleAggregate.matched.length : pair.dataset === "sale_items" ? partition.saleItems.matched.length : pair.dataset === "return_aggregate" ? partition.returnsAggregate.matched.length : partition.returnItems.matched.length;
    if (matchedCount === 0) {
      const absent = await client.query(
        `SELECT 1 FROM onec_v3_legal_sales_month_activation WHERE dataset = $1 AND sale_month = $2::date`,
        [pair.dataset, month]
      );
      if ((absent.rowCount ?? 0) > 0) {
        return { ok: false, code: "PERSISTED_ACTIVATION_UNEXPECTED", message: "Empty dataset must not activate month." };
      }
      continue;
    }
    const row = await client.query(
      `SELECT source_sha256 FROM onec_v3_legal_sales_month_activation WHERE dataset = $1 AND sale_month = $2::date`,
      [pair.dataset, month]
    );
    if (row.rows[0]?.source_sha256?.trim() !== pair.sha) {
      return { ok: false, code: "PERSISTED_ACTIVATION_MISMATCH", message: "Activation SHA mismatch." };
    }
  }
  return { ok: true };
}

// src/onec-sales/september-2026-one-shot/operator-financial-budget.ts
function sumMoney(values) {
  return addSaleMoneyStrings(values.filter((v) => v !== void 0).map((v) => String(v)));
}
function sumQty(values) {
  return addSaleQuantityStrings(values.map((v) => String(v)));
}
function rollupSaleAggregate(lines) {
  return {
    quantity: sumQty(lines.map((l) => l.quantity)),
    income: sumMoney(lines.map((l) => l.income)),
    manualDiscount: sumMoney(lines.map((l) => l.manualDiscount ?? "0")),
    automaticDiscount: sumMoney(lines.map((l) => l.automaticDiscount ?? "0")),
    totalDiscount: sumMoney(lines.map((l) => l.totalDiscount ?? "0")),
    costPrice: sumMoney(lines.map((l) => l.costPrice ?? "0")),
    additionalExpenses: sumMoney(lines.map((l) => l.additionalExpenses ?? "0")),
    grossProfit: sumMoney(lines.map((l) => l.grossProfit ?? "0"))
  };
}
function rollupSaleItems(lines) {
  return rollupSaleAggregate(lines);
}
function rollupReturns(lines) {
  return {
    quantity: sumQty(lines.map((l) => l.quantity)),
    income: sumMoney(lines.map((l) => l.income))
  };
}
function compareBucket(actual, expected) {
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) {
      return false;
    }
  }
  return true;
}
function buildOperatorFinancialTotalsFromPartition(partition) {
  const all = (p) => [...p.matched, ...p.excluded];
  return {
    saleAggregate: {
      full: rollupSaleAggregate(all(partition.saleAggregate)),
      matched: rollupSaleAggregate(partition.saleAggregate.matched),
      excluded: rollupSaleAggregate(partition.saleAggregate.excluded)
    },
    saleItems: {
      full: rollupSaleItems(all(partition.saleItems)),
      matched: rollupSaleItems(partition.saleItems.matched),
      excluded: rollupSaleItems(partition.saleItems.excluded)
    },
    returnsAggregate: {
      full: rollupReturns(all(partition.returnsAggregate)),
      matched: rollupReturns(partition.returnsAggregate.matched),
      excluded: rollupReturns(partition.returnsAggregate.excluded)
    },
    returnItems: {
      full: rollupReturns(all(partition.returnItems)),
      matched: rollupReturns(partition.returnItems.matched),
      excluded: rollupReturns(partition.returnItems.excluded)
    }
  };
}
function assertFinancialTotalsMatchScope(scope, computed) {
  for (const dataset of [
    "saleAggregate",
    "saleItems",
    "returnsAggregate",
    "returnItems"
  ]) {
    const expected = scope.financialTotals[dataset];
    const actual = computed[dataset];
    if (!expected) {
      return { ok: false, code: "SCOPE_FINANCIAL_MISSING", message: `Missing financialTotals.${dataset}` };
    }
    for (const bucket of ["full", "matched", "excluded"]) {
      if (!compareBucket(actual[bucket], expected[bucket])) {
        return {
          ok: false,
          code: "FINANCIAL_TOTALS_MISMATCH",
          message: `Financial totals mismatch: ${dataset}.${bucket}`
        };
      }
    }
  }
  return { ok: true };
}

// src/onec-sales/september-2026-one-shot/operator-production-apply-channel.ts
var PINNED_SEPTEMBER_2026_PRODUCTION_APPLY_CHANNEL_REF = "SEPTEMBER-2026-HUMAN-APPLY-CHANNEL-v1";
function assertSeptemberProductionApplyChannelOpen() {
  const channelRef = process.env.SEPTEMBER_2026_PRODUCTION_APPLY_CHANNEL_REF?.trim();
  if (channelRef !== PINNED_SEPTEMBER_2026_PRODUCTION_APPLY_CHANNEL_REF) {
    return {
      ok: false,
      code: "APPLY_NOT_AUTHORIZED",
      message: "Production apply channel is not open; operator data scope remains read-only candidate."
    };
  }
  return { ok: true };
}

// src/onec-sales/september-2026-one-shot/backup-receipt-verify.ts
var import_node_crypto13 = require("node:crypto");
var import_promises6 = require("node:fs/promises");

// src/onec-sales/september-2026-one-shot/backup-payload-verify.ts
var import_node_crypto12 = require("node:crypto");
var import_promises5 = require("node:fs/promises");
var import_node_path3 = require("node:path");

// src/onec-sales/september-2026-one-shot/private-backup-publish.ts
var import_node_crypto11 = require("node:crypto");
var import_promises4 = require("node:fs/promises");
var import_node_path2 = require("node:path");
function formatPrivateBackupFileText(payload) {
  return `${JSON.stringify(payload, null, 2)}
`;
}
async function assertApprovedPrivateBackupRoot(approvedRoot) {
  try {
    const root = (0, import_node_path2.resolve)(approvedRoot);
    const stat = await (0, import_promises4.lstat)(root);
    if (stat.isSymbolicLink()) {
      return { ok: false, code: "BACKUP_PRIVATE_ROOT_SYMLINK", message: "Backup private root must not be a symlink." };
    }
    const mode = stat.mode & 511;
    if (mode & 63) {
      return { ok: false, code: "BACKUP_PRIVATE_ROOT_NOT_PRIVATE", message: "Backup private root must be mode 0700." };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: "BACKUP_PRIVATE_ROOT_MISSING", message: "Backup private root directory missing." };
  }
}
async function assertPrivatePathUnderRoot(destinationPath, approvedRoot) {
  const root = (0, import_node_path2.resolve)(approvedRoot);
  const dest = (0, import_node_path2.resolve)(destinationPath);
  if (dest !== root && !dest.startsWith(`${root}${import_node_path2.sep}`)) {
    throw new Error("CAPTURE_DESTINATION_OUTSIDE_ROOT");
  }
  const rootCheck = await assertApprovedPrivateBackupRoot(approvedRoot);
  if (!rootCheck.ok) {
    throw new Error(rootCheck.code);
  }
}
async function publishPrivateBackupJson(input) {
  try {
    await assertPrivatePathUnderRoot(input.destinationPath, input.approvedPrivateRoot);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid destination.";
    if (message === "BACKUP_PRIVATE_ROOT_SYMLINK" || message === "BACKUP_PRIVATE_ROOT_NOT_PRIVATE" || message === "BACKUP_PRIVATE_ROOT_MISSING" || message === "CAPTURE_DESTINATION_OUTSIDE_ROOT") {
      return { ok: false, code: message, message: "Backup private root or destination invalid." };
    }
    return {
      ok: false,
      code: "BACKUP_DESTINATION_INVALID",
      message
    };
  }
  const text = formatPrivateBackupFileText(input.payload);
  let handle = null;
  try {
    handle = await (0, import_promises4.open)(input.destinationPath, "wx", 384);
    await handle.writeFile(text, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;
    const readback = await (0, import_promises4.readFile)(input.destinationPath, "utf8");
    const fileSha256 = (0, import_node_crypto11.createHash)("sha256").update(readback).digest("hex");
    const expectedSha = (0, import_node_crypto11.createHash)("sha256").update(text).digest("hex");
    if (fileSha256 !== expectedSha) {
      await (0, import_promises4.unlink)(input.destinationPath).catch(() => void 0);
      return { ok: false, code: "BACKUP_READBACK_FAILED", message: "Readback hash mismatch." };
    }
    return { ok: true, fileSha256 };
  } catch (e) {
    await handle?.close().catch(() => void 0);
    if (e.code === "EEXIST") {
      return { ok: false, code: "BACKUP_DESTINATION_EXISTS", message: "Destination exists." };
    }
    await (0, import_promises4.unlink)(input.destinationPath).catch(() => void 0);
    return { ok: false, code: "BACKUP_PUBLISH_FAILED", message: e instanceof Error ? e.message : "Publish failed." };
  }
}
async function publishPrivateTextFile(input) {
  try {
    await assertPrivatePathUnderRoot(input.destinationPath, input.approvedPrivateRoot);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid destination.";
    return { ok: false, code: "BACKUP_DESTINATION_INVALID", message };
  }
  let handle = null;
  try {
    handle = await (0, import_promises4.open)(input.destinationPath, "wx", 384);
    await handle.writeFile(input.text, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;
    const readback = await (0, import_promises4.readFile)(input.destinationPath, "utf8");
    const fileSha256 = (0, import_node_crypto11.createHash)("sha256").update(readback).digest("hex");
    const expectedSha = (0, import_node_crypto11.createHash)("sha256").update(input.text).digest("hex");
    if (fileSha256 !== expectedSha) {
      await (0, import_promises4.unlink)(input.destinationPath).catch(() => void 0);
      return { ok: false, code: "BACKUP_READBACK_FAILED", message: "Readback hash mismatch." };
    }
    return { ok: true, fileSha256 };
  } catch (e) {
    await handle?.close().catch(() => void 0);
    if (e.code === "EEXIST") {
      return { ok: false, code: "BACKUP_DESTINATION_EXISTS", message: "Destination exists." };
    }
    await (0, import_promises4.unlink)(input.destinationPath).catch(() => void 0);
    return { ok: false, code: "BACKUP_PUBLISH_FAILED", message: e instanceof Error ? e.message : "Publish failed." };
  }
}

// src/onec-sales/september-2026-one-shot/backup-payload-verify.ts
var BACKUP_PAYLOAD_MAX_BYTES = 64 * 1024 * 1024;
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertPrivatePathUnderRoot2(filePath, approvedRoot) {
  const root = (0, import_node_path3.resolve)(approvedRoot);
  const dest = (0, import_node_path3.resolve)(filePath);
  if (dest !== root && !dest.startsWith(`${root}${import_node_path3.sep}`)) {
    return { ok: false, code: "BACKUP_PAYLOAD_PATH_OUTSIDE_ROOT", message: "Backup payload path outside approved private root." };
  }
  return { ok: true };
}
async function readSeptember047048BackupPayloadFile(input) {
  const filePath = (0, import_node_path3.resolve)(input.backupPayloadFilePath);
  if (!input.skipPathSecurity) {
    const rootValue = input.approvedPrivateRoot?.trim();
    if (!rootValue) {
      return { ok: false, code: "BACKUP_PRIVATE_ROOT_REQUIRED", message: "SEPTEMBER_2026_BACKUP_PRIVATE_ROOT is required." };
    }
    const rootSec = await assertApprovedPrivateBackupRoot(rootValue);
    if (!rootSec.ok) return rootSec;
    const rootCheck = assertPrivatePathUnderRoot2(filePath, rootValue);
    if (!rootCheck.ok) return rootCheck;
  }
  try {
    const stat = await (0, import_promises5.lstat)(filePath);
    if (stat.isSymbolicLink()) {
      return { ok: false, code: "BACKUP_PAYLOAD_SYMLINK", message: "Backup payload must not be a symlink." };
    }
    if (!input.skipPathSecurity) {
      const mode = stat.mode & 511;
      if (mode & 63) {
        return { ok: false, code: "BACKUP_PAYLOAD_NOT_PRIVATE", message: "Backup payload file must be mode 0600." };
      }
    }
    if (stat.size > BACKUP_PAYLOAD_MAX_BYTES) {
      return { ok: false, code: "BACKUP_PAYLOAD_TOO_LARGE", message: "Backup payload exceeds size bound." };
    }
    const bytes = await (0, import_promises5.readFile)(filePath);
    if (bytes.length > BACKUP_PAYLOAD_MAX_BYTES) {
      return { ok: false, code: "BACKUP_PAYLOAD_TOO_LARGE", message: "Backup payload exceeds size bound." };
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, code: "BACKUP_PAYLOAD_FILE_MISSING", message: "Backup payload file not found." };
  }
}
function validateSeptember047048BackupDocument(doc, expected) {
  if (!isRecord2(doc)) {
    return { ok: false, code: "BACKUP_PAYLOAD_INVALID", message: "Backup payload is not a JSON object." };
  }
  if (doc.v !== 1 || doc.kind !== "september-2026-047-048-backup") {
    return { ok: false, code: "BACKUP_PAYLOAD_KIND", message: "Invalid backup payload version/kind." };
  }
  if (typeof doc.targetDbFingerprint !== "string" || doc.targetDbFingerprint !== expected.targetDbFingerprint) {
    return { ok: false, code: "BACKUP_PAYLOAD_TARGET_MISMATCH", message: "Backup payload target fingerprint mismatch." };
  }
  if (typeof doc.beforeStateSha256 !== "string" || doc.beforeStateSha256 !== expected.beforeStateSha256) {
    return { ok: false, code: "BACKUP_PAYLOAD_BEFORE_MISMATCH", message: "Backup payload before digest mismatch." };
  }
  if (!isRecord2(doc.snapshot)) {
    return { ok: false, code: "BACKUP_PAYLOAD_SNAPSHOT", message: "Backup snapshot missing." };
  }
  const snap = doc.snapshot;
  if (snap.v !== 2) {
    return { ok: false, code: "BACKUP_PAYLOAD_SNAPSHOT_VERSION", message: "Backup snapshot version must be 2." };
  }
  if (snap.saleMonthIso !== SEPTEMBER_2026_SALE_MONTH_ISO) {
    return { ok: false, code: "BACKUP_PAYLOAD_SALE_MONTH", message: "Backup snapshot sale month mismatch." };
  }
  const jsonFields = [
    "saleAggregateLinesJson",
    "saleItemLinesJson",
    "returnLinesJson",
    "returnItemLinesJson",
    "importStatesJson",
    "monthActivationsJson"
  ];
  for (const key of jsonFields) {
    if (typeof snap[key] !== "string") {
      return {
        ok: false,
        code: "BACKUP_PAYLOAD_NATIVE_JSON",
        message: `Backup snapshot ${key} must remain raw PostgreSQL JSON text.`
      };
    }
  }
  const snapshot = snap;
  const digest = sha256CanonicalJson(snapshot);
  if (digest !== doc.beforeStateSha256) {
    return { ok: false, code: "BACKUP_PAYLOAD_DIGEST_MISMATCH", message: "Backup snapshot digest does not match beforeStateSha256." };
  }
  const backup = doc;
  return { ok: true, backup };
}
async function verifySeptember047048BackupPayloadBinding(input) {
  const read = await readSeptember047048BackupPayloadFile({
    backupPayloadFilePath: input.backupPayloadFilePath,
    approvedPrivateRoot: input.approvedPrivateRoot,
    skipPathSecurity: input.skipPathSecurity
  });
  if (!read.ok) return read;
  const payloadSha256 = (0, import_node_crypto12.createHash)("sha256").update(read.bytes).digest("hex");
  if (payloadSha256 !== input.expectedPayloadSha256) {
    return { ok: false, code: "BACKUP_PAYLOAD_SHA_MISMATCH", message: "Backup payload file SHA mismatch vs receipt." };
  }
  let parsed;
  try {
    parsed = JSON.parse(read.bytes.toString("utf8"));
  } catch {
    return { ok: false, code: "BACKUP_PAYLOAD_PARSE", message: "Backup payload is not valid JSON." };
  }
  const valid = validateSeptember047048BackupDocument(parsed, {
    targetDbFingerprint: input.targetDbFingerprint,
    beforeStateSha256: input.beforeStateSha256
  });
  if (!valid.ok) return valid;
  return { ok: true, payloadSha256 };
}

// src/onec-sales/september-2026-one-shot/backup-receipt-verify.ts
function backupReceiptSha256(receipt) {
  return (0, import_node_crypto13.createHash)("sha256").update(JSON.stringify(receipt), "utf8").digest("hex");
}
async function verifySeptemberBackupReceiptForApply(input) {
  let bytes;
  try {
    bytes = await (0, import_promises6.readFile)(input.receiptFilePath);
  } catch {
    return { ok: false, code: "BACKUP_RECEIPT_MISSING", message: "Backup receipt file not found." };
  }
  const computedSha = (0, import_node_crypto13.createHash)("sha256").update(bytes).digest("hex");
  if (computedSha !== input.expectedReceiptSha256) {
    return { ok: false, code: "BACKUP_RECEIPT_SHA_MISMATCH", message: "Backup receipt SHA mismatch." };
  }
  const receipt = JSON.parse(bytes.toString("utf8"));
  if (receipt.v !== 1 || receipt.kind !== "september-2026-047-048-backup-receipt") {
    return { ok: false, code: "BACKUP_RECEIPT_INVALID", message: "Invalid backup receipt version/kind." };
  }
  if (receipt.targetDbFingerprint !== input.liveTargetFingerprint) {
    return { ok: false, code: "BACKUP_RECEIPT_TARGET_MISMATCH", message: "Backup receipt target fingerprint mismatch." };
  }
  if (receipt.operatorDataScopeSha256 !== input.scopeFileSha256) {
    return { ok: false, code: "BACKUP_RECEIPT_SCOPE_MISMATCH", message: "Backup receipt scope SHA mismatch." };
  }
  if (receipt.beforeStateSha256 !== input.scope.beforeStateDigest) {
    return { ok: false, code: "BACKUP_RECEIPT_BEFORE_SCOPE_MISMATCH", message: "Backup receipt before digest mismatch vs scope." };
  }
  if (receipt.beforeStateSha256 !== input.liveBeforeStateDigest) {
    return { ok: false, code: "BACKUP_RECEIPT_BEFORE_LIVE_MISMATCH", message: "Backup receipt before digest mismatch vs live." };
  }
  const canonicalSha = backupReceiptSha256(receipt);
  if (canonicalSha !== computedSha) {
    return { ok: false, code: "BACKUP_RECEIPT_BINDING_INVALID", message: "Backup receipt canonical binding invalid." };
  }
  if (!receipt.backupPayloadSha256?.trim()) {
    return { ok: false, code: "BACKUP_RECEIPT_PAYLOAD_MISSING", message: "Backup payload SHA missing from receipt." };
  }
  if (!input.backupPayloadFilePath?.trim()) {
    return { ok: false, code: "BACKUP_PAYLOAD_FILE_MISSING", message: "Backup payload file path required." };
  }
  const payload = await verifySeptember047048BackupPayloadBinding({
    backupPayloadFilePath: input.backupPayloadFilePath,
    expectedPayloadSha256: receipt.backupPayloadSha256,
    targetDbFingerprint: input.liveTargetFingerprint,
    beforeStateSha256: input.liveBeforeStateDigest,
    approvedPrivateRoot: input.approvedPrivateBackupRoot,
    skipPathSecurity: input.skipBackupPayloadPathSecurity
  });
  if (!payload.ok) return payload;
  return { ok: true, receipt };
}
async function verifySeptemberBackupReceiptForRollback(input) {
  let bytes;
  try {
    bytes = await (0, import_promises6.readFile)(input.receiptFilePath);
  } catch {
    return { ok: false, code: "BACKUP_RECEIPT_MISSING", message: "Backup receipt file not found." };
  }
  const computedSha = (0, import_node_crypto13.createHash)("sha256").update(bytes).digest("hex");
  if (computedSha !== input.expectedReceiptSha256) {
    return { ok: false, code: "BACKUP_RECEIPT_SHA_MISMATCH", message: "Backup receipt SHA mismatch." };
  }
  const receipt = JSON.parse(bytes.toString("utf8"));
  if (receipt.v !== 1 || receipt.kind !== "september-2026-047-048-backup-receipt") {
    return { ok: false, code: "BACKUP_RECEIPT_INVALID", message: "Invalid backup receipt version/kind." };
  }
  if (receipt.targetDbFingerprint !== input.liveTargetFingerprint) {
    return { ok: false, code: "BACKUP_RECEIPT_TARGET_MISMATCH", message: "Backup receipt target fingerprint mismatch." };
  }
  if (receipt.operatorDataScopeSha256 !== input.scopeFileSha256) {
    return { ok: false, code: "BACKUP_RECEIPT_SCOPE_MISMATCH", message: "Backup receipt scope SHA mismatch." };
  }
  if (receipt.beforeStateSha256 !== input.scope.beforeStateDigest) {
    return { ok: false, code: "BACKUP_RECEIPT_BEFORE_SCOPE_MISMATCH", message: "Backup receipt before digest mismatch vs scope." };
  }
  const canonicalSha = backupReceiptSha256(receipt);
  if (canonicalSha !== computedSha) {
    return { ok: false, code: "BACKUP_RECEIPT_BINDING_INVALID", message: "Backup receipt canonical binding invalid." };
  }
  if (!receipt.backupPayloadSha256?.trim()) {
    return { ok: false, code: "BACKUP_RECEIPT_PAYLOAD_MISSING", message: "Backup payload SHA missing from receipt." };
  }
  if (!input.backupPayloadFilePath?.trim()) {
    return { ok: false, code: "BACKUP_PAYLOAD_FILE_MISSING", message: "Backup payload file path required." };
  }
  const payloadRead = await readSeptember047048BackupPayloadFile({
    backupPayloadFilePath: input.backupPayloadFilePath,
    approvedPrivateRoot: input.approvedPrivateBackupRoot,
    skipPathSecurity: input.skipBackupPayloadPathSecurity
  });
  if (!payloadRead.ok) return payloadRead;
  const payloadSha256 = (0, import_node_crypto13.createHash)("sha256").update(payloadRead.bytes).digest("hex");
  if (payloadSha256 !== receipt.backupPayloadSha256) {
    return { ok: false, code: "BACKUP_PAYLOAD_SHA_MISMATCH", message: "Backup payload file SHA mismatch vs receipt." };
  }
  let parsed;
  try {
    parsed = JSON.parse(payloadRead.bytes.toString("utf8"));
  } catch {
    return { ok: false, code: "BACKUP_PAYLOAD_PARSE", message: "Backup payload is not valid JSON." };
  }
  const valid = validateSeptember047048BackupDocument(parsed, {
    targetDbFingerprint: input.liveTargetFingerprint,
    beforeStateSha256: receipt.beforeStateSha256
  });
  if (!valid.ok) return valid;
  return { ok: true, receipt, backup: valid.backup };
}
function buildSeptemberBackupReceiptFromVerifiedPayload(input) {
  return {
    v: 1,
    kind: "september-2026-047-048-backup-receipt",
    targetDbFingerprint: input.targetDbFingerprint,
    operatorDataScopeSha256: input.scopeFileSha256,
    beforeStateSha256: input.beforeStateSha256,
    backupPayloadSha256: input.backupPayloadFileSha256,
    capturedAt: input.capturedAt ?? (/* @__PURE__ */ new Date(0)).toISOString()
  };
}

// src/onec-sales/september-2026-one-shot/one-shot-apply-core.ts
var SIDECAR = { sidecar049: false };
async function runSeptember2026OneShotApply(input) {
  const urlCheck = assertProductionReadOnlyPreflightDatabaseUrl(input.databaseUrl, input.testContext);
  if (!urlCheck.ok) {
    return urlCheck;
  }
  const synthetic = input.testContext?.syntheticApplyAllowed === true;
  if (!synthetic) {
    const channel = assertSeptemberProductionApplyChannelOpen();
    if (!channel.ok) {
      return channel;
    }
  }
  let scope;
  let scopeSha;
  if (input.testContext?.syntheticOperatorScope) {
    scope = input.testContext.syntheticOperatorScope;
    scopeSha = input.operatorDataScopeSha256;
  } else {
    const loaded = await loadAndVerifyOperatorDataScope({
      scopeFilePath: input.operatorDataScopePath,
      expectedSha256: input.operatorDataScopeSha256,
      skipProductionShaPin: input.testContext?.skipOperatorDataScopeShaPin,
      skipTargetFingerprintPin: input.testContext?.skipTargetFingerprintPin
    });
    if (!loaded.ok) return loaded;
    scope = loaded.scope;
    scopeSha = loaded.sha256;
  }
  const grant = assertSeptemberWriteGrant("apply", scope, input.applyGrantRef, {
    allowAuthorizedScope: scope.applyAuthorized === true
  });
  if (!grant.ok) return grant;
  const receiptPath = input.backupReceiptFilePath?.trim() ?? input.testContext?.backupReceiptFilePath?.trim() ?? process.env.SEPTEMBER_2026_BACKUP_RECEIPT_PATH?.trim();
  const payloadPath = input.backupPayloadFilePath?.trim() ?? input.testContext?.backupPayloadFilePath?.trim() ?? process.env.SEPTEMBER_2026_BACKUP_PAYLOAD_PATH?.trim();
  if (!receiptPath || !input.backupReceiptSha256?.trim() || !payloadPath) {
    return {
      ok: false,
      code: "BACKUP_RECEIPT_REQUIRED",
      message: "Verified backup receipt path/SHA and backup payload path required for apply."
    };
  }
  const snapshotDir = input.snapshotDirectory ?? input.testContext?.snapshotDirectory ?? (input.testContext?.skipOperatorDataScopeShaPin ? void 0 : FIXED_SOURCE_SNAPSHOT_DIRECTORY);
  if (!snapshotDir) {
    return { ok: false, code: "SNAPSHOT_DIRECTORY_MISSING", message: "Snapshot directory required." };
  }
  if (!input.testContext?.skipOperatorDataScopeShaPin && !synthetic && !input.testContext?.syntheticOperatorScope && snapshotDir !== FIXED_SOURCE_SNAPSHOT_DIRECTORY) {
    return { ok: false, code: "SNAPSHOT_DIRECTORY_MISMATCH", message: "Snapshot directory mismatch." };
  }
  const snapshot = await loadVerifiedSourceSnapshotFromDirectory({
    directory: snapshotDir,
    skipManifestShaPin: input.testContext?.skipSnapshotManifestSha,
    skipSourcePinVerification: synthetic || input.testContext?.skipSourcePinVerification === true,
    skipPathSecurity: input.testContext?.skipSnapshotPathSecurity,
    scope: synthetic ? void 0 : scope
  });
  if (!snapshot.ok) return snapshot;
  const rosters = parseSeptemberSourceRosters(snapshot.buffers);
  const bundle = rosters;
  const pool = createImportPool(input.databaseUrl);
  const client = await pool.connect();
  let txOpen = false;
  try {
    await client.query("BEGIN");
    txOpen = true;
    const identity = await readTargetDbIdentityFromClient(client, input.databaseUrl);
    const fingerprintOk = input.testContext?.skipTargetFingerprintPin === true || identity.fingerprint === EXPECTED_TARGET_DB_FINGERPRINT;
    if (!fingerprintOk) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "TARGET_FINGERPRINT_MISMATCH", message: "Database fingerprint mismatch." };
    }
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "IMPORT_LOCK_BUSY", message: "Import lock busy." };
    }
    const gates = await assertWritePreflightGatesAfterImportLock(client, input.testContext);
    if (!gates.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return gates;
    }
    const beforeDigest = input.testContext?.skipBeforeDigestPin ? (await captureSeptember047048BeforeState(client)).digest : EXPECTED_EMPTY_BEFORE_STATE_DIGEST;
    const beforeCheck = await assertSeptember047048EmptyBeforeState(client, beforeDigest);
    if (!beforeCheck.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return beforeCheck;
    }
    if (beforeDigest !== scope.beforeStateDigest) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "SCOPE_BEFORE_MISMATCH", message: "Live before digest does not match scope." };
    }
    const privateRoot = process.env.SEPTEMBER_2026_BACKUP_PRIVATE_ROOT?.trim();
    if (!synthetic && !input.testContext?.skipBackupPayloadPathSecurity && !privateRoot) {
      await client.query("ROLLBACK");
      txOpen = false;
      return {
        ok: false,
        code: "BACKUP_PRIVATE_ROOT_REQUIRED",
        message: "SEPTEMBER_2026_BACKUP_PRIVATE_ROOT is required for production apply."
      };
    }
    const backupVerify = await verifySeptemberBackupReceiptForApply({
      receiptFilePath: receiptPath,
      expectedReceiptSha256: input.backupReceiptSha256.trim(),
      backupPayloadFilePath: payloadPath,
      scope,
      scopeFileSha256: scopeSha,
      liveTargetFingerprint: identity.fingerprint,
      liveBeforeStateDigest: beforeDigest,
      approvedPrivateBackupRoot: privateRoot,
      skipBackupPayloadPathSecurity: input.testContext?.skipBackupPayloadPathSecurity
    });
    if (!backupVerify.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return backupVerify;
    }
    const { plan } = await buildMatchedOnlyBundlePlan(
      client,
      {
        ...bundle,
        targetDbFingerprint: identity.fingerprint
      },
      { trustedBeforeStateSha256: beforeDigest }
    );
    const planHash = planHashFromPlan(plan);
    const known = await loadKnownLegalGuidSet(client);
    const partition = partitionSalesBundle({ ...bundle, known });
    const unknownSha = unknownUnionSha256FromGuids(partition.unknownGuids);
    if (unknownSha !== scope.unknownUnionSha256) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "UNKNOWN_UNION_SHA_MISMATCH", message: "Unknown GUID union SHA mismatch." };
    }
    const financial = buildOperatorFinancialTotalsFromPartition(partition);
    const finCheck = assertFinancialTotalsMatchScope(scope, financial);
    if (!finCheck.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return finCheck;
    }
    await applyMatchedOnlySaleAggregate(client, bundle.saleAggregate, partition.saleAggregate, planHash, SIDECAR);
    await applyMatchedOnlySaleItems(client, bundle.saleItems, partition.saleItems, planHash, SIDECAR);
    await applyMatchedOnlyReturnsAggregate(client, bundle.returnsAggregate, partition.returnsAggregate, planHash, SIDECAR);
    await applyMatchedOnlyReturnItems(client, bundle.returnItems, partition.returnItems, planHash, SIDECAR);
    const materialized = await verifyMatchedMaterializedRows(client, plan, partition, bundle, planHash, {
      skip049Metadata: true
    });
    if (!materialized.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return materialized;
    }
    const meta = await verifySeptember047048Metadata(client, partition, bundle);
    if (!meta.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return meta;
    }
    const inserted = {
      saleAggregate: partition.saleAggregate.matched.length,
      saleItems: partition.saleItems.matched.length,
      returnsAggregate: partition.returnsAggregate.matched.length,
      returnItems: partition.returnItems.matched.length
    };
    if (inserted.saleAggregate !== EXPECTED_APPLY_MATCHED_ROWS.saleAggregate || inserted.saleItems !== EXPECTED_APPLY_MATCHED_ROWS.saleItems || inserted.returnsAggregate !== EXPECTED_APPLY_MATCHED_ROWS.returnsAggregate || inserted.returnItems !== EXPECTED_APPLY_MATCHED_ROWS.returnItems) {
      if (!synthetic) {
        await client.query("ROLLBACK");
        txOpen = false;
        return { ok: false, code: "MATCHED_ROW_COUNT_MISMATCH", message: "Matched row counts mismatch." };
      }
    }
    const afterInsideTx = await captureSeptember047048BeforeState(client);
    const expectedAfterDigest = afterInsideTx.digest;
    try {
      await client.query("COMMIT");
      txOpen = false;
    } catch (commitError) {
      if (isCommitTransportUncertainty(commitError)) {
        return {
          ok: false,
          code: "COMMIT_UNCERTAIN",
          message: `Commit outcome uncertain; expected after digest ${expectedAfterDigest}. Do not retry apply or blind rollback.`
        };
      }
      await client.query("ROLLBACK").catch(() => void 0);
      txOpen = false;
      throw commitError;
    }
    let afterDigest = expectedAfterDigest;
    let postCommitVerifyOk = true;
    if (input.testContext?.injectPostCommitReadFailure) {
      postCommitVerifyOk = false;
      afterDigest = expectedAfterDigest;
    } else {
      try {
        const afterPost = await captureSeptember047048BeforeState(client);
        if (afterPost.digest !== expectedAfterDigest) {
          postCommitVerifyOk = false;
        }
        afterDigest = afterPost.digest;
      } catch {
        postCommitVerifyOk = false;
        afterDigest = expectedAfterDigest;
      }
    }
    return {
      ok: true,
      receipt: {
        v: 1,
        kind: "september-2026-apply-receipt",
        commitStatus: "committed",
        planHash,
        beforeStateDigest: beforeDigest,
        afterStateDigest: afterDigest,
        expectedAfterStateDigest: expectedAfterDigest,
        postCommitVerifyOk,
        matchedInserted: inserted,
        operatorDataScopeSha256: scopeSha,
        applyGrantRef: input.applyGrantRef,
        backupReceiptSha256: input.backupReceiptSha256 ?? null
      }
    };
  } catch (e) {
    if (txOpen) {
      await client.query("ROLLBACK").catch(() => void 0);
    }
    return { ok: false, code: "APPLY_FAILED", message: e instanceof Error ? e.message : "Apply failed." };
  } finally {
    client.release();
    await pool.end();
  }
}

// src/onec-sales/september-2026-one-shot/backup.ts
async function captureSeptember047048Backup(client, targetDbFingerprint) {
  const before = await captureSeptember047048BeforeState(client);
  return {
    v: 1,
    kind: "september-2026-047-048-backup",
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    targetDbFingerprint,
    beforeStateSha256: before.digest,
    snapshot: before.snapshot
  };
}

// src/onec-sales/september-2026-one-shot/one-shot-backup-core.ts
async function runSeptember2026OneShotBackup(input) {
  const urlCheck = assertProductionReadOnlyPreflightDatabaseUrl(input.databaseUrl, input.testContext);
  if (!urlCheck.ok) return urlCheck;
  const auth = assertExternalWriteAuthorization();
  if (!auth.ok) return auth;
  if (!input.approvedPrivateRoot?.trim()) {
    return { ok: false, code: "BACKUP_PRIVATE_ROOT_REQUIRED", message: "SEPTEMBER_2026_BACKUP_PRIVATE_ROOT is required." };
  }
  const loaded = await loadAndVerifyOperatorDataScope({
    scopeFilePath: input.operatorDataScopePath,
    expectedSha256: input.operatorDataScopeSha256,
    skipProductionShaPin: input.testContext?.skipOperatorDataScopeShaPin,
    skipTargetFingerprintPin: input.testContext?.skipTargetFingerprintPin
  });
  if (!loaded.ok) return loaded;
  const scope = loaded.scope;
  const scopeSha = loaded.sha256;
  const grant = assertSeptemberWriteGrant("backup", scope, input.backupGrantRef);
  if (!grant.ok) return grant;
  const pool = createImportPool(input.databaseUrl);
  const client = await pool.connect();
  let txOpen = false;
  try {
    await client.query("BEGIN");
    txOpen = true;
    const identity = await readTargetDbIdentityFromClient(client, input.databaseUrl);
    const fingerprintOk = input.testContext?.skipTargetFingerprintPin === true || identity.fingerprint === EXPECTED_TARGET_DB_FINGERPRINT;
    if (!fingerprintOk) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "TARGET_FINGERPRINT_MISMATCH", message: "Database fingerprint mismatch." };
    }
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "IMPORT_LOCK_BUSY", message: "Import lock busy." };
    }
    const gates = await assertWritePreflightGatesAfterImportLock(client, input.testContext);
    if (!gates.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return gates;
    }
    const resolvedBeforeDigest = input.testContext?.skipBeforeDigestPin ? (await captureSeptember047048BeforeState(client)).digest : EXPECTED_EMPTY_BEFORE_STATE_DIGEST;
    const beforeCheck = await assertSeptember047048EmptyBeforeState(client, resolvedBeforeDigest);
    if (!beforeCheck.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return beforeCheck;
    }
    if (resolvedBeforeDigest !== scope.beforeStateDigest) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "SCOPE_BEFORE_MISMATCH", message: "Live before digest does not match scope." };
    }
    const backup = await captureSeptember047048Backup(client, identity.fingerprint);
    await client.query("COMMIT");
    txOpen = false;
    const published = await publishPrivateBackupJson({
      destinationPath: input.backupPayloadDestinationPath,
      approvedPrivateRoot: input.approvedPrivateRoot,
      payload: backup
    });
    if (!published.ok) return published;
    const receipt = buildSeptemberBackupReceiptFromVerifiedPayload({
      targetDbFingerprint: identity.fingerprint,
      scopeFileSha256: scopeSha,
      beforeStateSha256: resolvedBeforeDigest,
      backupPayloadFileSha256: published.fileSha256,
      capturedAt: backup.capturedAt
    });
    const receiptText = JSON.stringify(receipt);
    const receiptPublished = await publishPrivateTextFile({
      destinationPath: input.backupReceiptDestinationPath,
      approvedPrivateRoot: input.approvedPrivateRoot,
      text: receiptText
    });
    if (!receiptPublished.ok) return receiptPublished;
    return {
      ok: true,
      result: {
        v: 1,
        kind: "september-2026-backup-result",
        targetDbFingerprint: identity.fingerprint,
        beforeStateDigest: resolvedBeforeDigest,
        operatorDataScopeSha256: scopeSha,
        backupPayloadPath: input.backupPayloadDestinationPath,
        backupPayloadSha256: published.fileSha256,
        backupReceiptPath: input.backupReceiptDestinationPath,
        backupReceiptSha256: receiptPublished.fileSha256
      }
    };
  } catch (e) {
    if (txOpen) {
      await client.query("ROLLBACK").catch(() => void 0);
    }
    return { ok: false, code: "BACKUP_FAILED", message: e instanceof Error ? e.message : "Backup failed." };
  } finally {
    client.release();
    await pool.end();
  }
}

// src/onec-sales/september-2026-one-shot/rollback-047-048.ts
var IMPORT_STATE_TABLES = [
  "onec_v3_legal_sales_import_state",
  "onec_v3_legal_sale_item_import_state",
  "onec_v3_legal_return_import_state",
  "onec_v3_legal_return_item_import_state"
];
var IMPORT_STATE_DATASET_TABLE = {
  sale_aggregate: "onec_v3_legal_sales_import_state",
  sale_items: "onec_v3_legal_sale_item_import_state",
  return_aggregate: "onec_v3_legal_return_import_state",
  return_items: "onec_v3_legal_return_item_import_state"
};
async function restoreSeptember047048Backup(client, backup) {
  if (backup.snapshot.v !== 2) {
    throw new Error("BACKUP_SNAPSHOT_VERSION_UNSUPPORTED");
  }
  const months = [backup.snapshot.saleMonthIso];
  await client.query(`DELETE FROM onec_v3_legal_sales_lines WHERE sale_month = ANY($1::date[])`, [months]);
  await client.query(`DELETE FROM onec_v3_legal_sale_item_lines WHERE sale_month = ANY($1::date[])`, [months]);
  await client.query(`DELETE FROM onec_v3_legal_return_lines WHERE sale_month = ANY($1::date[])`, [months]);
  await client.query(`DELETE FROM onec_v3_legal_return_item_lines WHERE sale_month = ANY($1::date[])`, [months]);
  await client.query(`DELETE FROM onec_v3_legal_sales_month_activation WHERE sale_month = ANY($1::date[])`, [months]);
  await restorePgJsonRowset(client, "onec_v3_legal_sales_lines", backup.snapshot.saleAggregateLinesJson);
  await restorePgJsonRowset(client, "onec_v3_legal_sale_item_lines", backup.snapshot.saleItemLinesJson);
  await restorePgJsonRowset(client, "onec_v3_legal_return_lines", backup.snapshot.returnLinesJson);
  await restorePgJsonRowset(client, "onec_v3_legal_return_item_lines", backup.snapshot.returnItemLinesJson);
  await restorePgJsonRowset(
    client,
    "onec_v3_legal_sales_month_activation",
    backup.snapshot.monthActivationsJson
  );
  for (const table of IMPORT_STATE_TABLES) {
    await client.query(`DELETE FROM ${table} WHERE id = 1`);
  }
  for (const [dataset, table] of Object.entries(IMPORT_STATE_DATASET_TABLE)) {
    await client.query(
      `
        INSERT INTO ${table} (id, source_sha256, row_count, imported_at)
        SELECT 1, r.source_sha256, r.row_count, r.imported_at
        FROM json_to_recordset($1::json) AS r(
          dataset text,
          source_sha256 char(64),
          row_count integer,
          imported_at timestamptz
        )
        WHERE r.dataset = $2
      `,
      [backup.snapshot.importStatesJson, dataset]
    );
  }
}

// src/onec-sales/september-2026-one-shot/one-shot-rollback-core.ts
async function runSeptember2026OneShotRollback(input) {
  const urlCheck = assertProductionReadOnlyPreflightDatabaseUrl(input.databaseUrl, input.testContext);
  if (!urlCheck.ok) return urlCheck;
  const auth = assertExternalWriteAuthorization();
  if (!auth.ok) return auth;
  if (auth.ref !== input.externalAuthorizationRef.trim()) {
    return { ok: false, code: "EXTERNAL_AUTHORIZATION_MISMATCH", message: "External authorization ref mismatch." };
  }
  const expectedLiveAfter = input.expectedLiveAfterStateDigest?.trim();
  if (!expectedLiveAfter) {
    return {
      ok: false,
      code: "EXPECTED_LIVE_AFTER_REQUIRED",
      message: "SEPTEMBER_2026_EXPECTED_LIVE_AFTER_DIGEST is required for rollback."
    };
  }
  if (!input.backupReceiptSha256?.trim() || !input.backupReceiptFilePath?.trim() || !input.backupPayloadFilePath?.trim()) {
    return {
      ok: false,
      code: "BACKUP_RECEIPT_REQUIRED",
      message: "Verified backup receipt path/SHA and backup payload path required for rollback."
    };
  }
  let scope;
  let scopeSha;
  if (input.testContext?.syntheticOperatorScope) {
    scope = input.testContext.syntheticOperatorScope;
    scopeSha = input.operatorDataScopeSha256;
  } else {
    const loaded = await loadAndVerifyOperatorDataScope({
      scopeFilePath: input.operatorDataScopePath,
      expectedSha256: input.operatorDataScopeSha256,
      skipProductionShaPin: input.testContext?.skipOperatorDataScopeShaPin,
      skipTargetFingerprintPin: input.testContext?.skipTargetFingerprintPin
    });
    if (!loaded.ok) return loaded;
    scope = loaded.scope;
    scopeSha = loaded.sha256;
  }
  const grant = assertSeptemberWriteGrant("rollback", scope, input.rollbackGrantRef);
  if (!grant.ok) return grant;
  const privateRoot = process.env.SEPTEMBER_2026_BACKUP_PRIVATE_ROOT?.trim();
  if (!input.testContext?.skipBackupPayloadPathSecurity && !privateRoot) {
    return {
      ok: false,
      code: "BACKUP_PRIVATE_ROOT_REQUIRED",
      message: "SEPTEMBER_2026_BACKUP_PRIVATE_ROOT is required for production rollback."
    };
  }
  const pool = createImportPool(input.databaseUrl);
  const client = await pool.connect();
  let txOpen = false;
  try {
    await client.query("BEGIN");
    txOpen = true;
    const identity = await readTargetDbIdentityFromClient(client, input.databaseUrl);
    const fingerprintOk = input.testContext?.skipTargetFingerprintPin === true || identity.fingerprint === EXPECTED_TARGET_DB_FINGERPRINT;
    if (!fingerprintOk) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "TARGET_FINGERPRINT_MISMATCH", message: "Database fingerprint mismatch." };
    }
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "IMPORT_LOCK_BUSY", message: "Import lock busy." };
    }
    const gates = await assertWritePreflightGatesAfterImportLock(client, input.testContext);
    if (!gates.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return gates;
    }
    const liveAfter = await captureSeptember047048BeforeState(client);
    if (liveAfter.digest !== expectedLiveAfter) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "LIVE_AFTER_DRIFT", message: "Live after-state digest drift." };
    }
    const backupVerify = await verifySeptemberBackupReceiptForRollback({
      receiptFilePath: input.backupReceiptFilePath,
      expectedReceiptSha256: input.backupReceiptSha256.trim(),
      backupPayloadFilePath: input.backupPayloadFilePath,
      scope,
      scopeFileSha256: scopeSha,
      liveTargetFingerprint: identity.fingerprint,
      approvedPrivateBackupRoot: privateRoot,
      skipBackupPayloadPathSecurity: input.testContext?.skipBackupPayloadPathSecurity
    });
    if (!backupVerify.ok) {
      await client.query("ROLLBACK");
      txOpen = false;
      return backupVerify;
    }
    await restoreSeptember047048Backup(client, backupVerify.backup);
    const restored = await captureSeptember047048BeforeState(client);
    if (restored.digest !== backupVerify.backup.beforeStateSha256) {
      await client.query("ROLLBACK");
      txOpen = false;
      return { ok: false, code: "ROLLBACK_VERIFY_FAILED", message: "Restored state digest mismatch." };
    }
    const restoredDigest = restored.digest;
    try {
      await client.query("COMMIT");
      txOpen = false;
    } catch (commitError) {
      if (isCommitTransportUncertainty(commitError)) {
        return {
          ok: false,
          code: "COMMIT_UNCERTAIN",
          message: `Commit outcome uncertain; restored digest ${restoredDigest}. Do not retry rollback or blind apply.`
        };
      }
      await client.query("ROLLBACK").catch(() => void 0);
      txOpen = false;
      throw commitError;
    }
    let postCommitVerifyOk = true;
    if (input.testContext?.injectPostCommitReadFailure) {
      postCommitVerifyOk = false;
    } else {
      try {
        const afterPost = await captureSeptember047048BeforeState(client);
        if (afterPost.digest !== restoredDigest) {
          postCommitVerifyOk = false;
        }
      } catch {
        postCommitVerifyOk = false;
      }
    }
    return {
      ok: true,
      receipt: {
        v: 1,
        kind: "september-2026-rollback-receipt",
        commitStatus: "committed",
        expectedLiveAfterStateDigest: expectedLiveAfter,
        liveAfterStateDigestBeforeRestore: liveAfter.digest,
        restoredBeforeStateDigest: restoredDigest,
        backupBeforeStateDigest: backupVerify.backup.beforeStateSha256,
        operatorDataScopeSha256: scopeSha,
        rollbackGrantRef: input.rollbackGrantRef,
        backupReceiptSha256: input.backupReceiptSha256.trim(),
        postCommitVerifyOk
      }
    };
  } catch (e) {
    if (txOpen) {
      await client.query("ROLLBACK").catch(() => void 0);
    }
    return { ok: false, code: "ROLLBACK_FAILED", message: e instanceof Error ? e.message : "Rollback failed." };
  } finally {
    client.release();
    await pool.end();
  }
}

// src/onec-sales/september-2026-one-shot/one-shot-operator-cli-entry.ts
async function main() {
  if (process.env.SEPTEMBER_2026_SYNTHETIC_HARNESS) {
    fail("OPERATOR_BYPASS_FORBIDDEN", "SYNTHETIC_HARNESS not accepted.");
  }
  const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--backup") ? "backup" : process.argv.includes("--rollback") ? "rollback" : "read-only-preflight";
  if (mode === "backup") {
    const scopePath = process.env.SEPTEMBER_2026_OPERATOR_DATA_SCOPE_PATH?.trim();
    const grant = process.env.SEPTEMBER_2026_BACKUP_GRANT_REF?.trim();
    const databaseUrl = process.env.DATABASE_URL?.trim();
    const privateRoot = process.env.SEPTEMBER_2026_BACKUP_PRIVATE_ROOT?.trim();
    const payloadPath = process.env.SEPTEMBER_2026_BACKUP_PAYLOAD_DESTINATION_PATH?.trim();
    const receiptPath = process.env.SEPTEMBER_2026_BACKUP_RECEIPT_DESTINATION_PATH?.trim();
    if (!scopePath || !grant || !databaseUrl || !privateRoot || !payloadPath || !receiptPath) {
      fail(
        "BACKUP_CONFIG_INCOMPLETE",
        "DATABASE_URL, scope path, SEPTEMBER_2026_BACKUP_GRANT_REF, SEPTEMBER_2026_BACKUP_PRIVATE_ROOT, payload and receipt destination paths required."
      );
    }
    const result2 = await runSeptember2026OneShotBackup({
      databaseUrl,
      operatorDataScopePath: scopePath,
      operatorDataScopeSha256: EXPECTED_OPERATOR_DATA_SCOPE_SHA256,
      backupGrantRef: grant,
      backupPayloadDestinationPath: payloadPath,
      backupReceiptDestinationPath: receiptPath,
      approvedPrivateRoot: privateRoot
    });
    console.log(JSON.stringify(result2, null, 2));
    if (!result2.ok) process.exit(1);
    return;
  }
  if (mode === "rollback") {
    const scopePath = process.env.SEPTEMBER_2026_OPERATOR_DATA_SCOPE_PATH?.trim();
    const grant = process.env.SEPTEMBER_2026_ROLLBACK_GRANT_REF?.trim();
    const backupReceipt = process.env.SEPTEMBER_2026_BACKUP_RECEIPT_SHA256?.trim();
    const backupReceiptPath = process.env.SEPTEMBER_2026_BACKUP_RECEIPT_PATH?.trim();
    const backupPayloadPath = process.env.SEPTEMBER_2026_BACKUP_PAYLOAD_PATH?.trim();
    const expectedLiveAfter = process.env.SEPTEMBER_2026_EXPECTED_LIVE_AFTER_DIGEST?.trim();
    const databaseUrl = process.env.DATABASE_URL?.trim();
    const auth = assertExternalWriteAuthorization();
    if (!auth.ok) fail(auth.code, auth.message);
    if (!scopePath || !grant || !databaseUrl || !backupReceipt || !backupReceiptPath || !backupPayloadPath || !expectedLiveAfter) {
      fail(
        "ROLLBACK_CONFIG_INCOMPLETE",
        "DATABASE_URL, scope path, SEPTEMBER_2026_ROLLBACK_GRANT_REF, backup receipt SHA/path, backup payload path, SEPTEMBER_2026_EXPECTED_LIVE_AFTER_DIGEST required."
      );
    }
    const result2 = await runSeptember2026OneShotRollback({
      databaseUrl,
      operatorDataScopePath: scopePath,
      operatorDataScopeSha256: EXPECTED_OPERATOR_DATA_SCOPE_SHA256,
      rollbackGrantRef: grant,
      externalAuthorizationRef: auth.ref,
      backupReceiptSha256: backupReceipt,
      backupReceiptFilePath: backupReceiptPath,
      backupPayloadFilePath: backupPayloadPath,
      expectedLiveAfterStateDigest: expectedLiveAfter
    });
    console.log(JSON.stringify(result2, null, 2));
    if (!result2.ok) process.exit(1);
    return;
  }
  if (mode === "apply") {
    const scopePath = process.env.SEPTEMBER_2026_OPERATOR_DATA_SCOPE_PATH?.trim();
    const grant = process.env.SEPTEMBER_2026_APPLY_GRANT_REF?.trim();
    const backupReceipt = process.env.SEPTEMBER_2026_BACKUP_RECEIPT_SHA256?.trim() ?? null;
    const backupReceiptPath = process.env.SEPTEMBER_2026_BACKUP_RECEIPT_PATH?.trim();
    const backupPayloadPath = process.env.SEPTEMBER_2026_BACKUP_PAYLOAD_PATH?.trim();
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!scopePath || !grant || !databaseUrl) {
      fail("APPLY_CONFIG_INCOMPLETE", "DATABASE_URL, SEPTEMBER_2026_OPERATOR_DATA_SCOPE_PATH, SEPTEMBER_2026_APPLY_GRANT_REF required.");
    }
    const result2 = await runSeptember2026OneShotApply({
      databaseUrl,
      operatorDataScopePath: scopePath,
      operatorDataScopeSha256: EXPECTED_OPERATOR_DATA_SCOPE_SHA256,
      applyGrantRef: grant,
      backupReceiptSha256: backupReceipt,
      backupReceiptFilePath: backupReceiptPath,
      backupPayloadFilePath: backupPayloadPath
    });
    console.log(JSON.stringify(result2, null, 2));
    if (!result2.ok) process.exit(1);
    return;
  }
  const configPath = process.env.SEPTEMBER_2026_READ_ONLY_RUNTIME_CONFIG_PATH?.trim();
  const inline = process.env.SEPTEMBER_2026_READ_ONLY_RUNTIME_CONFIG_JSON?.trim();
  let raw;
  if (process.argv.includes("--runtime-config-json")) {
    const idx = process.argv.indexOf("--runtime-config-json");
    const path = process.argv[idx + 1];
    if (!path) fail("RUNTIME_CONFIG_MISSING", "Path required after --runtime-config-json");
    raw = JSON.parse((0, import_node_fs.readFileSync)(path, "utf8"));
  } else if (configPath) {
    raw = JSON.parse((0, import_node_fs.readFileSync)(configPath, "utf8"));
  } else if (inline) {
    raw = JSON.parse(inline);
  } else {
    fail("RUNTIME_CONFIG_REQUIRED", "Read-only mode requires runtime config JSON.");
  }
  const parsed = parseSeptemberReadOnlyRuntimeConfig(raw);
  if (!parsed.ok) fail(parsed.code, parsed.message);
  const result = await runSeptember2026ReadOnlyPreflight({
    databaseUrl: parsed.config.databaseUrl,
    sources: parsed.buffers
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
function fail(code, message) {
  console.error(JSON.stringify({ ok: false, code, message }));
  process.exit(1);
}
main().catch((error) => {
  fail("FATAL", error instanceof Error ? error.message : String(error));
});
