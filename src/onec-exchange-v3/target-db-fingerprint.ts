import { createHash } from "node:crypto";

export type TargetDbDescriptor = {
  host: string;
  port: string;
  database: string;
};

export function parseTargetDbDescriptor(databaseUrl: string): TargetDbDescriptor | null {
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
      database,
    };
  } catch {
    return null;
  }
}

/** Fingerprint without credentials — for operator confirmation only. */
export function computeTargetDbFingerprint(databaseUrl: string): string | null {
  const descriptor = parseTargetDbDescriptor(databaseUrl);
  if (!descriptor) {
    return null;
  }
  const canonical = `${descriptor.host}|${descriptor.port}|${descriptor.database}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function formatTargetDbForReport(databaseUrl: string): string {
  const descriptor = parseTargetDbDescriptor(databaseUrl);
  if (!descriptor) {
    return "(invalid DATABASE_URL)";
  }
  return `${descriptor.host}:${descriptor.port}/${descriptor.database}`;
}
