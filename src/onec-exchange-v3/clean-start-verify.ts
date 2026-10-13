import { createHash } from "node:crypto";
import { Pool } from "pg";
import type { TargetDbDescriptor } from "./target-db-fingerprint";

export type CleanStartObservedState = {
  targetDb: TargetDbDescriptor & { fingerprint: string };
  legacyCleanStartCompletedAt: string | null;
  legacyCleanStartBundleFingerprint: string | null;
  lastBundleFingerprint: string | null;
  v3HoldingsCount: number;
};

function fingerprintFromDescriptor(descriptor: TargetDbDescriptor): string {
  const canonical = `${descriptor.host}|${descriptor.port}|${descriptor.database}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Inspect clean-start markers on a fresh connection (operator recovery). */
export async function observeCleanStartState(databaseUrl: string): Promise<CleanStartObservedState | null> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      const dbRow = await client.query<{ db: string; host: string | null; port: number | null }>(
        `SELECT current_database() AS db,
                COALESCE(host(inet_server_addr())::text, 'localhost') AS host,
                inet_server_port() AS port`,
      );
      const descriptor: TargetDbDescriptor = {
        host: dbRow.rows[0]?.host || "localhost",
        port: String(dbRow.rows[0]?.port ?? "5432"),
        database: dbRow.rows[0]?.db ?? "",
      };
      if (!descriptor.database) {
        return null;
      }
      const state = await client.query<{
        legacy_clean_start_completed_at: string | null;
        legacy_clean_start_bundle_fingerprint: string | null;
        last_bundle_fingerprint: string | null;
      }>(
        `SELECT legacy_clean_start_completed_at,
                legacy_clean_start_bundle_fingerprint,
                last_bundle_fingerprint
         FROM onec_v3_exchange_state WHERE id = 1`,
      );
      const holdings = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM onec_v3_holdings`,
      );
      return {
        targetDb: { ...descriptor, fingerprint: fingerprintFromDescriptor(descriptor) },
        legacyCleanStartCompletedAt: state.rows[0]?.legacy_clean_start_completed_at ?? null,
        legacyCleanStartBundleFingerprint: state.rows[0]?.legacy_clean_start_bundle_fingerprint ?? null,
        lastBundleFingerprint: state.rows[0]?.last_bundle_fingerprint ?? null,
        v3HoldingsCount: Number(holdings.rows[0]?.count ?? "0"),
      };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

export async function computeTargetDbFingerprintFromConnection(databaseUrl: string): Promise<string | null> {
  const observed = await observeCleanStartState(databaseUrl);
  return observed?.targetDb.fingerprint ?? null;
}
