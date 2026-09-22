import fs from "fs";
import { isProduction } from "../config";

export type PgSslConfig = false | { rejectUnauthorized: true; ca?: string };

export class InsecurePgTlsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsecurePgTlsError";
  }
}

const SSL_QUERY_PARAMS = [
  "sslmode",
  "ssl",
  "uselibpqcompat",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslnegotiation",
] as const;

type SslUrlSignals = {
  sslmodes: string[];
  sslValues: string[];
  uselibpqcompat: string | null;
  hasSslMaterial: boolean;
};

function parseDatabaseUrl(databaseUrl: string): URL {
  try {
    return new URL(databaseUrl);
  } catch {
    throw new InsecurePgTlsError("Invalid DATABASE_URL.");
  }
}

function collectSslUrlSignals(parsed: URL): SslUrlSignals {
  const sslmodes = parsed.searchParams
    .getAll("sslmode")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const sslValues = parsed.searchParams
    .getAll("ssl")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const uselibpqcompat = parsed.searchParams.get("uselibpqcompat")?.trim().toLowerCase() ?? null;
  const hasSslMaterial = ["sslcert", "sslkey", "sslrootcert"].some((param) =>
    parsed.searchParams.has(param),
  );

  return { sslmodes, sslValues, uselibpqcompat, hasSslMaterial };
}

function effectiveUrlSslMode(signals: SslUrlSignals): string | null {
  return signals.sslmodes.at(-1) ?? null;
}

function urlRequestsDisable(signals: SslUrlSignals): boolean {
  const sslMode = effectiveUrlSslMode(signals);
  if (sslMode === "disable") {
    return true;
  }
  return signals.sslValues.some((value) => value === "0" || value === "false");
}

function urlRequestsNoVerify(signals: SslUrlSignals): boolean {
  const sslMode = effectiveUrlSslMode(signals);
  if (sslMode === "no-verify") {
    return true;
  }
  if (signals.uselibpqcompat === "true") {
    return sslMode === "require" || sslMode === "prefer" || sslMode === null;
  }
  return false;
}

function assertSslUrlSignalsAllowed(signals: SslUrlSignals): void {
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
        "Insecure PostgreSQL TLS settings are not allowed in production.",
      );
    }
    if (signals.uselibpqcompat === "true") {
      throw new InsecurePgTlsError(
        "uselibpqcompat is not allowed in production DATABASE_URL.",
      );
    }
    if (signals.hasSslMaterial) {
      throw new InsecurePgTlsError(
        "Inline SSL certificate parameters are not allowed in production DATABASE_URL.",
      );
    }
  }
}

export function sanitizePgConnectionString(databaseUrl: string): string {
  const parsed = parseDatabaseUrl(databaseUrl);
  const signals = collectSslUrlSignals(parsed);
  assertSslUrlSignalsAllowed(signals);

  for (const param of SSL_QUERY_PARAMS) {
    parsed.searchParams.delete(param);
  }

  return parsed.toString();
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
  const parsed = parseDatabaseUrl(databaseUrl);
  const signals = collectSslUrlSignals(parsed);
  assertSslUrlSignalsAllowed(signals);

  const envSslMode = process.env.PGSSLMODE?.trim().toLowerCase() ?? null;
  const disableRequested = envSslMode === "disable" || urlRequestsDisable(signals);
  const noVerifyRequested = envSslMode === "no-verify" || urlRequestsNoVerify(signals);

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
  const connectionString = sanitizePgConnectionString(databaseUrl);
  return {
    connectionString,
    ssl: resolvePgSslConfig(databaseUrl),
  };
}
