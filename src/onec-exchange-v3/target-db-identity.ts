import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { createPgPoolOptions } from "../config/pg-ssl";
import { parseTargetDbDescriptor, type TargetDbDescriptor } from "./target-db-fingerprint";

const ONE_OFF_CONNECT_MS = 5_000;
export const ONE_OFF_STATEMENT_TIMEOUT_MS = 10_000;

export type TargetDbIdentity = TargetDbDescriptor & {
  fingerprint: string;
  systemIdentifier: string;
  serverHost: string;
  serverPort: string;
  urlHost: string;
  urlPort: string;
};

export type TargetDbIdentityErrorCode = "TARGET_DB_IDENTITY_UNAVAILABLE" | "TARGET_DB_IDENTITY_TIMEOUT";

export class TargetDbIdentityError extends Error {
  readonly code: TargetDbIdentityErrorCode;

  constructor(code: TargetDbIdentityErrorCode, message: string) {
    super(message);
    this.name = "TargetDbIdentityError";
    this.code = code;
  }
}

export function fingerprintFromClusterAndDatabase(systemIdentifier: string, database: string): string {
  const canonical = `pg|${systemIdentifier}|${database}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function mapIdentityQueryError(error: unknown): never {
  if (error instanceof TargetDbIdentityError) {
    throw error;
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (/canceling statement due to statement timeout/i.test(msg)) {
    throw new TargetDbIdentityError(
      "TARGET_DB_IDENTITY_TIMEOUT",
      "Превышено время чтения идентичности БД",
    );
  }
  if (/permission denied|must be superuser|pg_control_system/i.test(msg)) {
    throw new TargetDbIdentityError(
      "TARGET_DB_IDENTITY_UNAVAILABLE",
      "Недостаточно прав для чтения идентификатора кластера (pg_control_system); проверьте роль приложения",
    );
  }
  throw error;
}

export async function setIdentityStatementTimeout(client: PoolClient): Promise<void> {
  await client.query(`SET statement_timeout = ${ONE_OFF_STATEMENT_TIMEOUT_MS}`);
}

export async function resetIdentityStatementTimeout(client: PoolClient): Promise<void> {
  await client.query("RESET statement_timeout").catch(() => undefined);
}

/** Single-use pool with the same TLS/CA policy as the application pool. */
export function createOneOffPgPool(databaseUrl: string): Pool {
  const { connectionString, ssl } = createPgPoolOptions(databaseUrl);
  return new Pool({
    connectionString,
    ssl: ssl === false ? false : ssl,
    max: 1,
    connectionTimeoutMillis: ONE_OFF_CONNECT_MS,
    idleTimeoutMillis: 5_000,
  });
}

export async function withOneOffPgClient<T>(
  databaseUrl: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = createOneOffPgPool(databaseUrl);
  try {
    const client = await pool.connect();
    try {
      await setIdentityStatementTimeout(client);
      return await fn(client);
    } finally {
      await resetIdentityStatementTimeout(client);
      client.release();
    }
  } finally {
    await pool.end();
  }
}

export async function readTargetDbIdentityFromClient(
  client: PoolClient,
  databaseUrl?: string,
): Promise<TargetDbIdentity> {
  try {
    const row = await client.query<{
      db: string;
      host: string | null;
      port: string | null;
      system_id: string | null;
    }>(
      `SELECT current_database() AS db,
              COALESCE(host(inet_server_addr())::text, '') AS host,
              COALESCE(inet_server_port()::text, '5432') AS port,
              (SELECT system_identifier::text FROM pg_control_system()) AS system_id`,
    );
    const database = row.rows[0]?.db?.trim() ?? "";
    const systemIdentifier = row.rows[0]?.system_id?.trim() ?? "";
    if (!database || !systemIdentifier) {
      throw new TargetDbIdentityError(
        "TARGET_DB_IDENTITY_UNAVAILABLE",
        "Не удалось определить идентичность целевой БД",
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
