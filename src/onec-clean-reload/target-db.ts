import { createHash } from "node:crypto";

export type TargetDbDisplay = {
  host: string;
  port: string;
  database: string;
};

export function parseTargetDbDisplay(databaseUrl: string): TargetDbDisplay {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres:// or postgresql:// scheme.");
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    throw new Error("DATABASE_URL must include a database name.");
  }
  return {
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || "5432",
    database,
  };
}

export function computeTargetDbFingerprint(databaseUrl: string): string {
  const display = parseTargetDbDisplay(databaseUrl);
  const payload = {
    kind: "onec_rf_target_db_v1",
    host: display.host,
    port: display.port,
    database: display.database,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
