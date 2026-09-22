import fs from "fs";
import { isProduction } from "../config";

export type PgSslConfig = false | { rejectUnauthorized: true; ca?: string };

export class InsecurePgTlsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsecurePgTlsError";
  }
}

function parseSslModeFromUrl(databaseUrl: string): string | null {
  try {
    const parsed = new URL(databaseUrl);
    return parsed.searchParams.get("sslmode")?.trim().toLowerCase() ?? null;
  } catch {
    const match = databaseUrl.match(/[?&]sslmode=([^&]+)/i);
    return match?.[1]?.trim().toLowerCase() ?? null;
  }
}

function resolvePgCa(): string | undefined {
  const raw = process.env.PGSSLROOTCERT?.trim();
  if (!raw) {
    return undefined;
  }
  if (raw.includes("-----BEGIN")) {
    return raw;
  }
  return fs.readFileSync(raw, "utf8");
}

export function resolvePgSslConfig(databaseUrl: string): PgSslConfig {
  const envSslMode = process.env.PGSSLMODE?.trim().toLowerCase() ?? null;
  const urlSslMode = parseSslModeFromUrl(databaseUrl);
  const disableRequested = envSslMode === "disable" || urlSslMode === "disable";
  const noVerifyRequested = envSslMode === "no-verify" || urlSslMode === "no-verify";

  if (isProduction()) {
    if (disableRequested || noVerifyRequested) {
      throw new InsecurePgTlsError(
        "Insecure PostgreSQL TLS settings are not allowed in production.",
      );
    }
    const ca = resolvePgCa();
    return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
  }

  if (noVerifyRequested) {
    throw new InsecurePgTlsError(
      "sslmode=no-verify is not supported. Use PGSSLMODE=disable only for local/test.",
    );
  }

  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  if (disableRequested || nodeEnv === "test" || nodeEnv === "development") {
    return false;
  }

  const ca = resolvePgCa();
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

export function createPgPoolOptions(databaseUrl: string): {
  connectionString: string;
  ssl: PgSslConfig;
} {
  return {
    connectionString: databaseUrl,
    ssl: resolvePgSslConfig(databaseUrl),
  };
}
