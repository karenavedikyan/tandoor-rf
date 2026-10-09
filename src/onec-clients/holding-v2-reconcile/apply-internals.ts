import type { PoolClient } from "pg";
import { computeBusinessStateSha256 } from "./normalized-state";
import { projectHoldingV2BusinessState } from "./projected-state";
import { findOrphanActiveLinks } from "./reconcile-validation";
import { assertOnecClientsExist, loadHoldingV2PersistedState } from "./repository";
import { mergeTypeCategoryPatch } from "./type-category-merge";
import type {
  HoldingV2DesiredSnapshot,
  HoldingV2DesiredTypeCategoryPatch,
  HoldingV2ReconcileApplyResult,
  HoldingV2ReconcileInjectFailure,
} from "./types";

export function throwInjectFailureForTests(): never {
  throw new Error("TEST_INJECT_FAILURE");
}

export async function upsertLegalLinkPhase(
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

export async function upsertOutletLinkPhase(
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

export async function upsertTypeCategoryPatch(
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

export async function assertPostApplyInvariants(client: PoolClient): Promise<void> {
  const persisted = await loadHoldingV2PersistedState(client);
  if (findOrphanActiveLinks(persisted)) {
    throw new Error("INVARIANT:ORPHAN_HOLDING_LINKS");
  }
}

export async function insertReconcileRun(
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

export class HoldingV2ReconcilePipelineError extends Error {
  constructor(public readonly result: Extract<HoldingV2ReconcileApplyResult, { ok: false }>) {
    super(result.message);
    this.name = "HoldingV2ReconcilePipelineError";
  }
}

export async function runHoldingV2ReconcileOnClient(
  client: PoolClient,
  desired: HoldingV2DesiredSnapshot,
  options: {
    verificationFingerprint?: string | null;
    injectFailureForTests?: HoldingV2ReconcileInjectFailure;
  } = {},
): Promise<Extract<HoldingV2ReconcileApplyResult, { ok: true }>> {
  const persisted = await loadHoldingV2PersistedState(client);
  const projected = projectHoldingV2BusinessState(persisted, desired);
  if (findOrphanActiveLinks(projected)) {
    throw new HoldingV2ReconcilePipelineError({
      ok: false,
      code: "ORPHAN_HOLDING_LINKS",
      message: "Snapshot would leave active links pointing at a non-head holding root.",
    });
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
    throw new HoldingV2ReconcilePipelineError({
      ok: false,
      code: "CLIENT_STUB_MISSING",
      message: "One or more legal entities are missing from onec_clients.",
    });
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

  return {
    ok: true,
    code: "SUCCESS",
    normalizedStateSha256: afterHash,
    legalLinksWritten,
    outletLinksWritten,
    typeCategoryWritten,
    runId,
  };
}
