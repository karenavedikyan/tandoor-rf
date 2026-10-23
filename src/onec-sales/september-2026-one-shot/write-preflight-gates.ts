import type { PoolClient } from "pg";
import { readTargetDbIdentityFromClient } from "../../onec-exchange-v3/target-db-identity";
import { assertSchema047048Ready } from "./schema-047-048";
import { verifyCatalogPin } from "./catalog-pin";
import { readSeptemberPreflightJobState } from "./job-state-047-048";
import { EXPECTED_TARGET_DB_FINGERPRINT } from "./scope-pins";
import type { ReadOnlyPreflightTestContext } from "./read-only-preflight-types";

export async function assertWritePreflightGatesUnderLock(
  client: PoolClient,
  databaseUrl: string,
  testContext?: ReadOnlyPreflightTestContext,
): Promise<{ ok: true; fingerprint: string } | { ok: false; code: string; message: string }> {
  const identity = await readTargetDbIdentityFromClient(client, databaseUrl);
  const fingerprintOk =
    testContext?.skipTargetFingerprintPin === true || identity.fingerprint === EXPECTED_TARGET_DB_FINGERPRINT;
  if (!fingerprintOk) {
    return { ok: false, code: "TARGET_FINGERPRINT_MISMATCH", message: "Database fingerprint mismatch." };
  }
  const schema = await assertSchema047048Ready(client);
  if (!schema.ok) {
    return { ok: false, code: schema.code, message: schema.message };
  }
  const jobs = await readSeptemberPreflightJobState(client);
  if (jobs.pendingOrRunningImportJobs > 0) {
    return { ok: false, code: "IMPORT_JOBS_ACTIVE", message: "Active import jobs present." };
  }
  const nightly = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_import_jobs WHERE status IN ('pending','running') AND job_source = 'nightly'`,
  );
  if (Number(nightly.rows[0]?.count ?? "0") > 0) {
    return { ok: false, code: "NIGHTLY_JOBS_ACTIVE", message: "Nightly import jobs active." };
  }
  const blocked = await client.query<{ apply_blocked: boolean }>(
    `SELECT apply_blocked FROM onec_exchange_state WHERE id = 1`,
  );
  if (blocked.rows[0]?.apply_blocked) {
    return { ok: false, code: "EXCHANGE_APPLY_BLOCKED", message: "Exchange apply_blocked is set." };
  }
  if (testContext?.skipCatalogPin !== true) {
    const catalog = await verifyCatalogPin(client);
    if (!catalog.ok) {
      return { ok: false, code: catalog.code, message: catalog.message };
    }
  }
  return { ok: true, fingerprint: identity.fingerprint };
}
