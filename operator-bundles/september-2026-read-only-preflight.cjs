#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/onec-sales/september-2026-one-shot/read-only-preflight-cli-entry.ts
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
var EXPECTED_SOURCE_FILES = {
  saleAggregate: {
    path: "/LC/sale/sale.json",
    sha256: "1e7db83fce17f3a10bc9d63d3c913283db4f900794e1212666d6e44d76d51d5e",
    counts: { full: 4415, matched: 3416, excluded: 999 }
  },
  saleItems: {
    path: "/LC/sale/sale(items).json",
    sha256: "9e35a3fae84e8cd46d8413277b8251ecbd0429447654499fc1d0c51878d762cc",
    counts: { full: 26928, matched: 24030, excluded: 2898 }
  },
  returnsAggregate: {
    path: "/LC/sale/returne.json",
    sha256: "dc31bbb982e081b26c0587163164303f6e14c083ee55b1f69760eadc7e161dbb",
    counts: { full: 462, matched: 413, excluded: 49 }
  },
  returnItems: {
    path: "/LC/sale/returne(items).json",
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

// src/onec-clients/uuid.ts
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var NULL_UUID = "00000000-0000-0000-0000-000000000000";
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

// src/onec-sales/client-info-legal-guid.ts
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

// src/onec-sales/constants.ts
var MAX_LEGAL_SALES_BYTES = MAX_SOURCE_BYTES;

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
  const row = await client.query(
    `SELECT COUNT(*)::text AS count FROM onec_import_jobs WHERE status IN ('pending', 'running')`
  );
  return { pendingOrRunningImportJobs: Number(row.rows[0]?.count ?? "0") };
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

// src/onec-sales/matched-only/apply-persist-materialization.ts
function money(values) {
  return addSaleMoneyStrings(values);
}
function qty(values) {
  return addSaleQuantityStrings(values);
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

// src/onec-sales/september-2026-one-shot/read-only-preflight-cli-entry.ts
function loadRuntimeConfigFromArgv() {
  const jsonFlag = process.argv.indexOf("--runtime-config-json");
  if (jsonFlag >= 0) {
    const path = process.argv[jsonFlag + 1];
    if (!path) {
      throw new Error("Missing path after --runtime-config-json");
    }
    return JSON.parse((0, import_node_fs.readFileSync)(path, "utf8"));
  }
  const inline = process.env.SEPTEMBER_2026_READ_ONLY_RUNTIME_CONFIG_JSON?.trim();
  if (inline) {
    return JSON.parse(inline);
  }
  throw new Error("Provide --runtime-config-json <path> or SEPTEMBER_2026_READ_ONLY_RUNTIME_CONFIG_JSON");
}
async function main() {
  if (process.env.SEPTEMBER_2026_SYNTHETIC_HARNESS) {
    console.error(
      JSON.stringify({
        ok: false,
        code: "OPERATOR_BYPASS_FORBIDDEN",
        message: "Production read-only bundle does not accept SEPTEMBER_2026_SYNTHETIC_HARNESS."
      })
    );
    process.exit(1);
  }
  const parsed = parseSeptemberReadOnlyRuntimeConfig(loadRuntimeConfigFromArgv());
  if (!parsed.ok) {
    console.error(JSON.stringify({ ok: false, code: parsed.code, message: parsed.message }));
    process.exit(1);
  }
  const result = await runSeptember2026ReadOnlyPreflight({
    databaseUrl: parsed.config.databaseUrl,
    sources: parsed.buffers
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      code: "FATAL",
      message: error instanceof Error ? error.message : String(error)
    })
  );
  process.exit(1);
});
