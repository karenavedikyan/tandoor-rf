import { resolveTargetDbIdentityFromUrl } from "./target-db-identity";

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

/** Live cluster + database fingerprint (requires connection; uses standard TLS/CA). */
export async function computeTargetDbFingerprint(databaseUrl: string): Promise<string | null> {
  try {
    const identity = await resolveTargetDbIdentityFromUrl(databaseUrl);
    return identity.fingerprint;
  } catch {
    return null;
  }
}

export function formatTargetDbForReport(databaseUrl: string): string {
  const descriptor = parseTargetDbDescriptor(databaseUrl);
  if (!descriptor) {
    return "(invalid DATABASE_URL)";
  }
  return `${descriptor.host}:${descriptor.port}/${descriptor.database}`;
}
