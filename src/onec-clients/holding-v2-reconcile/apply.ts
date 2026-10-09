import { Pool, type PoolClient } from "pg";
import type { ValidatedClientsPayload } from "../types";
import { HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY } from "../constants";
import { buildHoldingV2DesiredSnapshot } from "./desired-state";
import { computeBusinessStateSha256 } from "./normalized-state";
import { projectHoldingV2BusinessState } from "./projected-state";
import {
  findOrphanActiveLinks,
  validateOutletCompositionForReconcile,
} from "./reconcile-validation";
import { assertOnecClientsExist, loadHoldingV2PersistedState } from "./repository";
import {
  mergeTypeCategoryPatch,
  validateTypeCategoryPatches,
} from "./type-category-merge";
import type {
  HoldingV2DesiredSnapshot,
  HoldingV2DesiredTypeCategoryPatch,
  HoldingV2ReconcileApplyResult,
} from "./types";

export type HoldingV2ReconcileInjectFailure =
  | "after_legal_links"
  | "after_outlet_links"
  | "after_type_category";

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

function throwInjectFailureForTests(): never {
  throw new Error("TEST_INJECT_FAILURE");
}

async function upsertLegalLinkPhase(
  client: PoolClient,
  desired: HoldingV2DesiredSnapshot,
): Promise<number> {
  let legalLinksWritten = 0;
  const sourceSha256 = desired.sourceSha256;

  for (const link of desired.legalLinks) {
    await client.query(
      `
        INSERT INTO onec_holding_v2_legal_links (
          guid_client, guid_holding_root, is_holding_head, link_active,
          first_source_sha256, last_source_sha256, first_applied_at, last_applied_at
        ) VALUES ($1::uuid, $2::uuid, $3, TRUE, $4, $4, NOW(), NOW())
        ON CONFLICT (guid_client) DO UPDATE SET
          guid_holding_root = EXCLUDED.guid_holding_root,
          is_holding_head = EXCLUDED.is_holding_head,
          link_active = TRUE,
          last_source_sha256 = EXCLUDED.last_source_sha256,
          last_applied_at = NOW()
      `,
      [link.guidClient, link.guidHoldingRoot, link.isHoldingHead, sourceSha256],
    );
    legalLinksWritten += 1;
  }

  return legalLinksWritten;
}

async function upsertOutletLinkPhase(
  client: PoolClient,
  desired: HoldingV2DesiredSnapshot,
): Promise<{ outletLinksWritten: number; legalLinksDeactivated: number }> {
  let outletLinksWritten = 0;
  let legalLinksDeactivated = 0;
  const sourceSha256 = desired.sourceSha256;

  for (const link of desired.outletLinks) {
    await client.query(
      `
        INSERT INTO onec_holding_v2_outlet_links (
          guid_store, guid_holding_root, is_closed, closure_known, link_active,
          first_source_sha256, last_source_sha256, first_applied_at, last_applied_at
        ) VALUES ($1::uuid, $2::uuid, $3, $4, TRUE, $5, $5, NOW(), NOW())
        ON CONFLICT (guid_store) DO UPDATE SET
          guid_holding_root = EXCLUDED.guid_holding_root,
          is_closed = EXCLUDED.is_closed,
          closure_known = EXCLUDED.closure_known,
          link_active = TRUE,
          last_source_sha256 = EXCLUDED.last_source_sha256,
          last_applied_at = NOW()
      `,
      [
        link.guidStore,
        link.guidHoldingRoot,
        link.closureKnown ? link.isClosed : null,
        link.closureKnown,
        sourceSha256,
      ],
    );
    outletLinksWritten += 1;
  }

  for (const holdingRoot of desired.membershipCompleteHoldings) {
    const desiredLegalIds = desired.legalLinks
      .filter((l) => l.guidHoldingRoot.toLowerCase() === holdingRoot.toLowerCase())
      .map((l) => l.guidClient);
    const desiredOutletIds = desired.outletLinks
      .filter((o) => o.guidHoldingRoot.toLowerCase() === holdingRoot.toLowerCase())
      .map((o) => o.guidStore);

    const deactivatedLegal = await client.query(
      `
        UPDATE onec_holding_v2_legal_links
        SET link_active = FALSE, last_applied_at = NOW(), last_source_sha256 = $3
        WHERE guid_holding_root = $1::uuid
          AND link_active = TRUE
          AND NOT (guid_client = ANY($2::uuid[]))
      `,
      [holdingRoot, desiredLegalIds, sourceSha256],
    );
    legalLinksDeactivated += deactivatedLegal.rowCount ?? 0;

    const deactivatedOutlets = await client.query(
      `
        UPDATE onec_holding_v2_outlet_links
        SET link_active = FALSE, last_applied_at = NOW(), last_source_sha256 = $3
        WHERE guid_holding_root = $1::uuid
          AND link_active = TRUE
          AND NOT (guid_store = ANY($2::uuid[]))
      `,
      [holdingRoot, desiredOutletIds, sourceSha256],
    );
    outletLinksWritten += deactivatedOutlets.rowCount ?? 0;
  }

  return { outletLinksWritten, legalLinksDeactivated };
}

async function upsertTypeCategoryPatch(
  client: PoolClient,
  patch: HoldingV2DesiredTypeCategoryPatch,
  sourceSha256: string,
): Promise<void> {
  if (patch.scope === "client") {
    const existing = await client.query<{
      guid_type: string | null;
      name_type: string | null;
      guid_category: string | null;
      name_category: string | null;
      field_presence: Record<string, boolean>;
      object_present_in_source: boolean;
    }>(
      `SELECT guid_type, name_type, guid_category, name_category, field_presence, object_present_in_source
       FROM onec_holding_v2_client_type_category WHERE guid_client = $1::uuid`,
      [patch.key],
    );
    const merged = mergeTypeCategoryPatch(
      existing.rows[0]
        ? {
            objectPresentInSource: existing.rows[0].object_present_in_source,
            fieldPresence: {
              guidType: existing.rows[0].field_presence?.guidType === true,
              nameType: existing.rows[0].field_presence?.nameType === true,
              guidCategory: existing.rows[0].field_presence?.guidCategory === true,
              nameCategory: existing.rows[0].field_presence?.nameCategory === true,
            },
            guidType: existing.rows[0].guid_type,
            nameType: existing.rows[0].name_type,
            guidCategory: existing.rows[0].guid_category,
            nameCategory: existing.rows[0].name_category,
          }
        : undefined,
      patch,
    );
    await client.query(
      `
        INSERT INTO onec_holding_v2_client_type_category (
          guid_client, object_present_in_source, field_presence,
          guid_type, name_type, guid_category, name_category, last_source_sha256, updated_at
        ) VALUES ($1::uuid, $2, $3::jsonb, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (guid_client) DO UPDATE SET
          object_present_in_source = EXCLUDED.object_present_in_source,
          field_presence = EXCLUDED.field_presence,
          guid_type = EXCLUDED.guid_type,
          name_type = EXCLUDED.name_type,
          guid_category = EXCLUDED.guid_category,
          name_category = EXCLUDED.name_category,
          last_source_sha256 = EXCLUDED.last_source_sha256,
          updated_at = NOW()
      `,
      [
        patch.key,
        merged.objectPresentInSource,
        JSON.stringify(merged.fieldPresence),
        merged.guidType,
        merged.nameType,
        merged.guidCategory,
        merged.nameCategory,
        sourceSha256,
      ],
    );
    return;
  }

  const existing = await client.query<{
    guid_type: string | null;
    name_type: string | null;
    guid_category: string | null;
    name_category: string | null;
    field_presence: Record<string, boolean>;
    object_present_in_source: boolean;
  }>(
    `SELECT guid_type, name_type, guid_category, name_category, field_presence, object_present_in_source
     FROM onec_holding_v2_outlet_type_category WHERE guid_store = $1::uuid`,
    [patch.key],
  );
  const merged = mergeTypeCategoryPatch(
    existing.rows[0]
      ? {
          objectPresentInSource: existing.rows[0].object_present_in_source,
          fieldPresence: {
            guidType: existing.rows[0].field_presence?.guidType === true,
            nameType: existing.rows[0].field_presence?.nameType === true,
            guidCategory: existing.rows[0].field_presence?.guidCategory === true,
            nameCategory: existing.rows[0].field_presence?.nameCategory === true,
          },
          guidType: existing.rows[0].guid_type,
          nameType: existing.rows[0].name_type,
          guidCategory: existing.rows[0].guid_category,
          nameCategory: existing.rows[0].name_category,
        }
      : undefined,
    patch,
  );
  await client.query(
    `
      INSERT INTO onec_holding_v2_outlet_type_category (
        guid_store, object_present_in_source, field_presence,
        guid_type, name_type, guid_category, name_category, last_source_sha256, updated_at
      ) VALUES ($1::uuid, $2, $3::jsonb, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (guid_store) DO UPDATE SET
        object_present_in_source = EXCLUDED.object_present_in_source,
        field_presence = EXCLUDED.field_presence,
        guid_type = EXCLUDED.guid_type,
        name_type = EXCLUDED.name_type,
        guid_category = EXCLUDED.guid_category,
        name_category = EXCLUDED.name_category,
        last_source_sha256 = EXCLUDED.last_source_sha256,
        updated_at = NOW()
    `,
    [
      patch.key,
      merged.objectPresentInSource,
      JSON.stringify(merged.fieldPresence),
      merged.guidType,
      merged.nameType,
      merged.guidCategory,
      merged.nameCategory,
      sourceSha256,
    ],
  );
}

async function assertPostApplyInvariants(client: PoolClient): Promise<void> {
  const persisted = await loadHoldingV2PersistedState(client);
  if (findOrphanActiveLinks(persisted)) {
    throw new Error("INVARIANT:ORPHAN_HOLDING_LINKS");
  }
}

async function insertReconcileRun(
  client: PoolClient,
  status: "no_changes" | "success" | "failed",
  sourceSha256: string,
  normalizedStateSha256: string,
  verificationFingerprint: string | null,
  counts?: { legal: number; outlet: number; typeCategory: number },
  errorCode?: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO onec_holding_v2_reconcile_runs (
        status, source_sha256, normalized_state_sha256, verification_fingerprint,
        finished_at, legal_links_written, outlet_links_written, type_category_written, error_code
      ) VALUES (
        $1, $2, $3, $4, NOW(),
        $5, $6, $7, $8
      )
      RETURNING id::text
    `,
    [
      status,
      sourceSha256,
      normalizedStateSha256,
      verificationFingerprint,
      counts?.legal ?? 0,
      counts?.outlet ?? 0,
      counts?.typeCategory ?? 0,
      errorCode ?? null,
    ],
  );
  return result.rows[0]!.id;
}

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
      const persisted = await loadHoldingV2PersistedState(client);
      const projected = projectHoldingV2BusinessState(persisted, desired);
      if (findOrphanActiveLinks(projected)) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          code: "ORPHAN_HOLDING_LINKS",
          message: SAFE_MESSAGES.ORPHAN_HOLDING_LINKS!,
        };
      }

      const beforeHash = computeBusinessStateSha256(persisted);
      const afterHash = computeBusinessStateSha256(projected);
      if (beforeHash === afterHash) {
        const runId = await insertReconcileRun(
          client,
          "no_changes",
          desired.sourceSha256,
          afterHash,
          options.verificationFingerprint ?? null,
        );
        await client.query("COMMIT");
        return {
          ok: true,
          code: "NO_CHANGES",
          normalizedStateSha256: afterHash,
          legalLinksWritten: 0,
          outletLinksWritten: 0,
          typeCategoryWritten: 0,
          runId,
        };
      }

      const missingClients = await assertOnecClientsExist(
        client,
        desired.legalLinks.map((l) => l.guidClient),
      );
      if (missingClients.length > 0) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          code: "CLIENT_STUB_MISSING",
          message: SAFE_MESSAGES.CLIENT_STUB_MISSING!,
        };
      }

      let legalLinksWritten = await upsertLegalLinkPhase(client, desired);
      if (options.injectFailureForTests === "after_legal_links") {
        throwInjectFailureForTests();
      }

      const outletPhase = await upsertOutletLinkPhase(client, desired);
      let outletLinksWritten = outletPhase.outletLinksWritten;
      legalLinksWritten += outletPhase.legalLinksDeactivated;
      if (options.injectFailureForTests === "after_outlet_links") {
        throwInjectFailureForTests();
      }

      let typeCategoryWritten = 0;
      for (const patch of desired.typeCategoryPatches) {
        await upsertTypeCategoryPatch(client, patch, desired.sourceSha256);
        typeCategoryWritten += 1;
      }
      if (options.injectFailureForTests === "after_type_category") {
        throwInjectFailureForTests();
      }

      await assertPostApplyInvariants(client);

      await client.query(
        `
          INSERT INTO onec_holding_v2_apply_state (id, last_normalized_state_sha256, last_source_sha256, last_applied_at, updated_at)
          VALUES (1, $1, $2, NOW(), NOW())
          ON CONFLICT (id) DO UPDATE SET
            last_normalized_state_sha256 = EXCLUDED.last_normalized_state_sha256,
            last_source_sha256 = EXCLUDED.last_source_sha256,
            last_applied_at = EXCLUDED.last_applied_at,
            updated_at = NOW()
        `,
        [afterHash, desired.sourceSha256],
      );

      const runId = await insertReconcileRun(
        client,
        "success",
        desired.sourceSha256,
        afterHash,
        options.verificationFingerprint ?? null,
        {
          legal: legalLinksWritten,
          outlet: outletLinksWritten,
          typeCategory: typeCategoryWritten,
        },
      );

      await client.query("COMMIT");
      return {
        ok: true,
        code: "SUCCESS",
        normalizedStateSha256: afterHash,
        legalLinksWritten,
        outletLinksWritten,
        typeCategoryWritten,
        runId,
      };
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
