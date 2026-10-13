import { createHash } from "node:crypto";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { createPgPoolOptions } from "../config/pg-ssl";
import { parseTargetDbDescriptor, type TargetDbDescriptor } from "./target-db-fingerprint";

const ONE_OFF_CONNECT_MS = 5_000;
export const ONE_OFF_STATEMENT_TIMEOUT_MS = 10_000;
export const ONE_OFF_QUERY_TIMEOUT_MS = 10_000;
export const IDENTITY_ADMIN_QUERY_TIMEOUT_MS = 2_000;

export type TargetDbIdentity = TargetDbDescriptor & {
  fingerprint: string;
  systemIdentifier: string;
  serverHost: string;
  serverPort: string;
  urlHost: string;
  urlPort: string;
};

export type TargetDbIdentityErrorCode = "TARGET_DB_IDENTITY_UNAVAILABLE" | "TARGET_DB_IDENTITY_TIMEOUT";

export type TargetDbIdentityTimeoutKind = "client_transport" | "server_statement";

export class TargetDbIdentityError extends Error {
  readonly code: TargetDbIdentityErrorCode;
  readonly timeoutKind?: TargetDbIdentityTimeoutKind;
  readonly discardConnection: boolean;

  constructor(
    code: TargetDbIdentityErrorCode,
    message: string,
    options?: {
      timeoutKind?: TargetDbIdentityTimeoutKind;
      discardConnection?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "TargetDbIdentityError";
    this.code = code;
    this.timeoutKind = options?.timeoutKind;
    this.discardConnection = options?.discardConnection ?? false;
  }
}

export type OneOffPgPoolOptions = {
  queryTimeoutMs?: number;
};

export type ReadTargetDbIdentityOptions = {
  queryTimeoutMs?: number;
  /** Integration tests only: deliberate delay before identity SQL. */
  testPreSleepSec?: number;
};

export function fingerprintFromClusterAndDatabase(systemIdentifier: string, database: string): string {
  const canonical = `pg|${systemIdentifier}|${database}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** pg driver supports query_timeout at runtime; @types/pg omits it on QueryConfig. */
export function pgQueryWithTimeout<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient,
  text: string,
  queryTimeoutMs: number,
  values?: unknown[],
): Promise<QueryResult<T>> {
  return client.query<T>({
    text,
    values,
    query_timeout: queryTimeoutMs,
  } as unknown as Parameters<PoolClient["query"]>[0]);
}

/** Raw driver/network timeout detection (not for wrapped TargetDbIdentityError). */
export function isPgRawTransportOrQueryTimeout(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /Query read timeout|query timeout|timeout exceeded|connection terminated|ECONNRESET|ETIMEDOUT/i.test(
    msg,
  );
}

/** @deprecated Use shouldDiscardPgClientAfterError for pooled/one-off cleanup decisions. */
export function isPgTransportOrQueryTimeout(error: unknown): boolean {
  return isPgRawTransportOrQueryTimeout(error);
}

export function shouldDiscardPgClientAfterError(error: unknown): boolean {
  if (error instanceof TargetDbIdentityError) {
    return error.discardConnection;
  }
  return isPgRawTransportOrQueryTimeout(error);
}

function mapIdentityQueryError(error: unknown): never {
  if (error instanceof TargetDbIdentityError) {
    throw error;
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (/canceling statement due to statement timeout/i.test(msg)) {
    throw new TargetDbIdentityError(
      "TARGET_DB_IDENTITY_TIMEOUT",
      "Превышено время чтения идентичности БД (statement_timeout)",
      {
        timeoutKind: "server_statement",
        discardConnection: false,
        cause: error,
      },
    );
  }
  if (isPgRawTransportOrQueryTimeout(error)) {
    throw new TargetDbIdentityError(
      "TARGET_DB_IDENTITY_TIMEOUT",
      "Превышено время чтения идентичности БД",
      {
        timeoutKind: "client_transport",
        discardConnection: true,
        cause: error,
      },
    );
  }
  if (/permission denied|must be superuser|pg_control_system/i.test(msg)) {
    throw new TargetDbIdentityError(
      "TARGET_DB_IDENTITY_UNAVAILABLE",
      "Недостаточно прав для чтения идентификатора кластера (pg_control_system); проверьте роль приложения",
      { discardConnection: false, cause: error },
    );
  }
  throw error;
}

export async function setIdentityStatementTimeout(client: PoolClient): Promise<void> {
  await pgQueryWithTimeout(
    client,
    `SET statement_timeout = ${ONE_OFF_STATEMENT_TIMEOUT_MS}`,
    IDENTITY_ADMIN_QUERY_TIMEOUT_MS,
  );
}

export async function resetIdentityStatementTimeout(client: PoolClient): Promise<void> {
  await pgQueryWithTimeout(client, "RESET statement_timeout", IDENTITY_ADMIN_QUERY_TIMEOUT_MS).catch(
    () => undefined,
  );
}

/** Single-use pool with the same TLS/CA policy as the application pool. */
export function createOneOffPgPool(databaseUrl: string, options?: OneOffPgPoolOptions): Pool {
  const { connectionString, ssl } = createPgPoolOptions(databaseUrl);
  return new Pool({
    connectionString,
    ssl: ssl === false ? false : ssl,
    max: 1,
    connectionTimeoutMillis: ONE_OFF_CONNECT_MS,
    idleTimeoutMillis: 5_000,
    query_timeout: options?.queryTimeoutMs ?? ONE_OFF_QUERY_TIMEOUT_MS,
  });
}

export async function withOneOffPgClient<T>(
  databaseUrl: string,
  fn: (client: PoolClient) => Promise<T>,
  options?: OneOffPgPoolOptions,
): Promise<T> {
  const pool = createOneOffPgPool(databaseUrl, options);
  let client: PoolClient | undefined;
  let discardClient = false;
  try {
    client = await pool.connect();
    try {
      await setIdentityStatementTimeout(client);
      return await fn(client);
    } catch (error) {
      discardClient = shouldDiscardPgClientAfterError(error);
      throw error;
    } finally {
      if (client) {
        if (!discardClient) {
          await resetIdentityStatementTimeout(client);
        }
        client.release(discardClient);
        client = undefined;
      }
    }
  } finally {
    await pool.end();
  }
}

export async function readTargetDbIdentityFromClient(
  client: PoolClient,
  databaseUrl?: string,
  options?: ReadTargetDbIdentityOptions,
): Promise<TargetDbIdentity> {
  const queryTimeoutMs = options?.queryTimeoutMs ?? ONE_OFF_QUERY_TIMEOUT_MS;
  try {
    if (options?.testPreSleepSec && options.testPreSleepSec > 0) {
      await pgQueryWithTimeout(
        client,
        `SELECT pg_sleep($1::double precision)`,
        queryTimeoutMs,
        [options.testPreSleepSec],
      );
    }
    const row = await pgQueryWithTimeout<{
      db: string;
      host: string | null;
      port: string | null;
      system_id: string | null;
    }>(
      client,
      `SELECT current_database() AS db,
              COALESCE(host(inet_server_addr())::text, '') AS host,
              COALESCE(inet_server_port()::text, '5432') AS port,
              (SELECT system_identifier::text FROM pg_control_system()) AS system_id`,
      queryTimeoutMs,
    );
    const database = row.rows[0]?.db?.trim() ?? "";
    const systemIdentifier = row.rows[0]?.system_id?.trim() ?? "";
    if (!database || !systemIdentifier) {
      throw new TargetDbIdentityError(
        "TARGET_DB_IDENTITY_UNAVAILABLE",
        "Не удалось определить идентичность целевой БД",
        { discardConnection: false },
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
      fingerprint: fingerprintFromClusterAndDatabase(systemIdentifier, database),
    };
  } catch (error) {
    mapIdentityQueryError(error);
  }
}

export async function resolveTargetDbIdentityFromUrl(databaseUrl: string): Promise<TargetDbIdentity> {
  return withOneOffPgClient(databaseUrl, (client) => readTargetDbIdentityFromClient(client, databaseUrl));
}

export function databaseNameMismatchBlocker(identity: TargetDbIdentity, databaseUrl: string): string | null {
  const urlDesc = parseTargetDbDescriptor(databaseUrl);
  if (!urlDesc?.database) {
    return "Некорректный DATABASE_URL: не удалось определить имя базы";
  }
  if (urlDesc.database !== identity.database) {
    return `Имя базы в DATABASE_URL (${urlDesc.database}) не совпадает с current_database() (${identity.database})`;
  }
  return null;
}
