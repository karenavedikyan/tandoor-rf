import { createHash } from "node:crypto";

export function computeTargetDbFingerprint(databaseUrl: string): string {
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
  const payload = {
    kind: "onec_rf_target_db_v1",
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || "5432",
    database,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
