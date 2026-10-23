import type { PoolClient } from "pg";
import { assertSchema047048Ready } from "./schema-047-048";
import { verifyCatalogPin } from "./catalog-pin";
import { readSeptemberPreflightJobState } from "./job-state-047-048";
import type { ReadOnlyPreflightTestContext } from "./read-only-preflight-types";
import { isNightlyExchangeScheduleEnabled } from "../../onec-nightly-exchange/config";

/** Gates after import lock: schema, jobs, exchange block, catalog, nightly scheduler env. */
export async function assertWritePreflightGatesAfterImportLock(
  client: PoolClient,
  testContext?: ReadOnlyPreflightTestContext,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const schema = await assertSchema047048Ready(client);
  if (!schema.ok) {
    return { ok: false, code: schema.code, message: schema.message };
  }
  const jobs = await readSeptemberPreflightJobState(client);
  if (jobs.pendingOrRunningImportJobs > 0) {
    return { ok: false, code: "IMPORT_JOBS_ACTIVE", message: "Active import jobs present." };
  }
  if (jobs.pendingOrRunningDiagnosticJobs > 0) {
    return { ok: false, code: "DIAGNOSTIC_JOBS_ACTIVE", message: "Active diagnostic jobs present." };
  }
  if (!testContext?.skipNightlySchedulerPin && isNightlyExchangeScheduleEnabled()) {
    return {
      ok: false,
      code: "NIGHTLY_SCHEDULER_ENABLED",
      message: "Nightly exchange scheduler must be disabled (ONEC_NIGHTLY_EXCHANGE_ENABLED not true).",
    };
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
  return { ok: true };
}

/** @deprecated Use assertWritePreflightGatesAfterImportLock after tryAcquireImportLock. */
export const assertWritePreflightGatesUnderLock = assertWritePreflightGatesAfterImportLock;
