import {
  ONE_OFF_QUERY_TIMEOUT_MS,
  pgQueryWithTimeout,
  readTargetDbIdentityFromClient,
  withOneOffPgClient,
  type TargetDbIdentity,
} from "./target-db-identity";

export type CleanStartObservedState = {
  targetDb: TargetDbIdentity;
  legacyCleanStartCompletedAt: string | null;
  legacyCleanStartBundleFingerprint: string | null;
  lastBundleFingerprint: string | null;
  v3HoldingsCount: number;
  v3LegalCount: number;
  v3RetailCount: number;
  v3EmployeeRosterCount: number;
};

/** Inspect clean-start markers on a fresh TLS-configured connection (operator recovery). */
export async function observeCleanStartState(databaseUrl: string): Promise<CleanStartObservedState | null> {
  try {
    return await withOneOffPgClient(databaseUrl, async (client) => {
      const targetDb = await readTargetDbIdentityFromClient(client, databaseUrl);
      const state = await pgQueryWithTimeout<{
        legacy_clean_start_completed_at: string | null;
        legacy_clean_start_bundle_fingerprint: string | null;
        last_bundle_fingerprint: string | null;
      }>(
        client,
        `SELECT legacy_clean_start_completed_at,
                legacy_clean_start_bundle_fingerprint,
                last_bundle_fingerprint
         FROM onec_v3_exchange_state WHERE id = 1`,
        ONE_OFF_QUERY_TIMEOUT_MS,
      );
      const counts = await pgQueryWithTimeout<{
        holdings: string;
        legal: string;
        retail: string;
        roster: string;
      }>(
        client,
        `
          SELECT
            (SELECT COUNT(*)::text FROM onec_v3_holdings) AS holdings,
            (SELECT COUNT(*)::text FROM onec_v3_legal_entities) AS legal,
            (SELECT COUNT(*)::text FROM onec_v3_retail_outlets) AS retail,
            (SELECT COUNT(*)::text FROM onec_wholesale_employee_roster) AS roster
        `,
        ONE_OFF_QUERY_TIMEOUT_MS,
      );
      return {
        targetDb,
        legacyCleanStartCompletedAt: state.rows[0]?.legacy_clean_start_completed_at ?? null,
        legacyCleanStartBundleFingerprint: state.rows[0]?.legacy_clean_start_bundle_fingerprint ?? null,
        lastBundleFingerprint: state.rows[0]?.last_bundle_fingerprint ?? null,
        v3HoldingsCount: Number(counts.rows[0]?.holdings ?? "0"),
        v3LegalCount: Number(counts.rows[0]?.legal ?? "0"),
        v3RetailCount: Number(counts.rows[0]?.retail ?? "0"),
        v3EmployeeRosterCount: Number(counts.rows[0]?.roster ?? "0"),
      };
    });
  } catch {
    return null;
  }
}
