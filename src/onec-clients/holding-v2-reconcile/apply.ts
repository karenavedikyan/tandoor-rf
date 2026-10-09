import { Pool } from "pg";
import type { ValidatedClientsPayload } from "../types";
import { HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY } from "../constants";
import { buildHoldingV2DesiredSnapshot } from "./desired-state";
import { runHoldingV2ReconcileOnClient } from "./apply-internals";
import { validateOutletCompositionForReconcile } from "./reconcile-validation";
import { validateTypeCategoryPatches } from "./type-category-merge";
import type {
  HoldingV2ReconcileApplyResult,
  HoldingV2ReconcileInjectFailure,
} from "./types";

export type { HoldingV2ReconcileInjectFailure };

export type ApplyHoldingV2ReconciliationOptions = {
  databaseUrl: string;
  payload: ValidatedClientsPayload;
  verificationFingerprint?: string | null;
  /** Test-only: abort transaction after a write phase. */
  injectFailureForTests?: HoldingV2ReconcileInjectFailure;
};

const SAFE_MESSAGES: Record<string, string> = {
  TYPE_CATEGORY_EXPLICIT_NULL:
    "Explicit null in type_category field is not allowed for reconciliation.",
  OUTLET_COMPOSITION_INCOMPLETE:
    "Retail outlet composition is incomplete for reconciliation (guid_store required).",
  ORPHAN_HOLDING_LINKS:
    "Snapshot would leave active links pointing at a non-head holding root.",
  CLIENT_STUB_MISSING: "One or more legal entities are missing from onec_clients.",
  INVARIANT_VIOLATION: "Reconciliation invariant violation.",
  DATABASE_ERROR: "Database error during reconciliation.",
  RECONCILE_LOCKED: "Holding v2 reconcile lock not acquired.",
};

/** Internal v2 reconciliation apply — not wired to public import/apply CLI. */
export async function applyHoldingV2Reconciliation(
  options: ApplyHoldingV2ReconciliationOptions,
): Promise<HoldingV2ReconcileApplyResult> {
  const built = buildHoldingV2DesiredSnapshot(options.payload);
  if (!built.ok) {
    return { ok: false, code: "INVALID_PAYLOAD", message: built.message };
  }
  const desired = built.desired;

  const nullPatch = validateTypeCategoryPatches(desired.typeCategoryPatches);
  if (nullPatch) {
    return {
      ok: false,
      code: nullPatch,
      message: SAFE_MESSAGES[nullPatch]!,
    };
  }

  const outletIssue = validateOutletCompositionForReconcile(desired);
  if (outletIssue) {
    return {
      ok: false,
      code: outletIssue,
      message: SAFE_MESSAGES[outletIssue]!,
    };
  }

  const pool = new Pool({ connectionString: options.databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    const lock = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY],
    );
    if (!lock.rows[0]?.acquired) {
      return {
        ok: false,
        code: "RECONCILE_LOCKED",
        message: SAFE_MESSAGES.RECONCILE_LOCKED!,
      };
    }

    await client.query("BEGIN");
    try {
      const result = await runHoldingV2ReconcileOnClient(client, desired, {
        verificationFingerprint: options.verificationFingerprint ?? null,
        injectFailureForTests: options.injectFailureForTests,
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      const inject = error instanceof Error && error.message === "TEST_INJECT_FAILURE";
      if (inject) {
        return { ok: false, code: "FAILED", message: "Injected test failure." };
      }
      if (error instanceof Error && error.message.startsWith("INVARIANT:")) {
        return {
          ok: false,
          code: "INVARIANT_VIOLATION",
          message: SAFE_MESSAGES.INVARIANT_VIOLATION!,
        };
      }
      const { HoldingV2ReconcilePipelineError } = await import("./apply-internals");
      if (error instanceof HoldingV2ReconcilePipelineError) {
        return error.result;
      }
      return {
        ok: false,
        code: "DATABASE_ERROR",
        message: SAFE_MESSAGES.DATABASE_ERROR!,
      };
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

export {
  runHoldingV2ReconcileOnClient,
  HoldingV2ReconcilePipelineError,
} from "./apply-internals";
