import { Pool, type PoolClient } from "pg";
import type { ValidatedClientsPayload } from "../types";
import { HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY } from "../constants";
import { buildHoldingV2DesiredSnapshot } from "./desired-state";
import {
  computeDesiredNormalizedStateSha256,
  computePersistedNormalizedStateSha256,
} from "./normalized-state";
import { assertOnecClientsExist, loadHoldingV2PersistedState } from "./repository";
import type {
  HoldingV2DesiredSnapshot,
  HoldingV2DesiredTypeCategoryPatch,
  HoldingV2ReconcileApplyResult,
} from "./types";

export type ApplyHoldingV2ReconciliationOptions = {
  databaseUrl: string;
  payload: ValidatedClientsPayload;
  verificationFingerprint?: string | null;
  /** Test hook: participate in caller transaction */
  participatingClient?: PoolClient;
};

async function mergeClientTypeCategory(
  client: PoolClient,
  patch: HoldingV2DesiredTypeCategoryPatch,
  sourceSha256: string,
): Promise<boolean> {
  if (patch.scope !== "client") {
    return false;
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
     FROM onec_holding_v2_client_type_category WHERE guid_client = $1::uuid`,
    [patch.key],
  );
  const row = existing.rows[0];
  const guidType = patch.fieldPresence.guidType ? patch.guidType : (row?.guid_type ?? null);
  const nameType = patch.fieldPresence.nameType ? patch.nameType : (row?.name_type ?? null);
  const guidCategory = patch.fieldPresence.guidCategory
    ? patch.guidCategory
    : (row?.guid_category ?? null);
  const nameCategory = patch.fieldPresence.nameCategory
    ? patch.nameCategory
    : (row?.name_category ?? null);
  const fieldPresence = {
    guidType: patch.fieldPresence.guidType || row?.field_presence?.guidType === true,
    nameType: patch.fieldPresence.nameType || row?.field_presence?.nameType === true,
    guidCategory: patch.fieldPresence.guidCategory || row?.field_presence?.guidCategory === true,
    nameCategory: patch.fieldPresence.nameCategory || row?.field_presence?.nameCategory === true,
  };
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
      true,
      JSON.stringify(fieldPresence),
      guidType,
      nameType,
      guidCategory,
      nameCategory,
      sourceSha256,
    ],
  );
  return true;
}

async function mergeOutletTypeCategory(
  client: PoolClient,
  patch: HoldingV2DesiredTypeCategoryPatch,
  sourceSha256: string,
): Promise<boolean> {
  if (patch.scope !== "outlet") {
    return false;
  }
  const existing = await client.query<{
    guid_type: string | null;
    name_type: string | null;
    guid_category: string | null;
    name_category: string | null;
    field_presence: Record<string, boolean>;
  }>(
    `SELECT guid_type, name_type, guid_category, name_category, field_presence
     FROM onec_holding_v2_outlet_type_category WHERE guid_store = $1::uuid`,
    [patch.key],
  );
  const row = existing.rows[0];
  const guidType = patch.fieldPresence.guidType ? patch.guidType : (row?.guid_type ?? null);
  const nameType = patch.fieldPresence.nameType ? patch.nameType : (row?.name_type ?? null);
  const guidCategory = patch.fieldPresence.guidCategory
    ? patch.guidCategory
    : (row?.guid_category ?? null);
  const nameCategory = patch.fieldPresence.nameCategory
    ? patch.nameCategory
    : (row?.name_category ?? null);
  const fieldPresence = {
    guidType: patch.fieldPresence.guidType || row?.field_presence?.guidType === true,
    nameType: patch.fieldPresence.nameType || row?.field_presence?.nameType === true,
    guidCategory: patch.fieldPresence.guidCategory || row?.field_presence?.guidCategory === true,
    nameCategory: patch.fieldPresence.nameCategory || row?.field_presence?.nameCategory === true,
  };
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
      true,
      JSON.stringify(fieldPresence),
      guidType,
      nameType,
      guidCategory,
      nameCategory,
      sourceSha256,
    ],
  );
  return true;
}

async function applyDesiredState(
  client: PoolClient,
  desired: HoldingV2DesiredSnapshot,
): Promise<{ legalLinksWritten: number; outletLinksWritten: number; typeCategoryWritten: number }> {
  let legalLinksWritten = 0;
  let outletLinksWritten = 0;
  let typeCategoryWritten = 0;
  const sourceSha256 = desired.sourceSha256;

  const desiredLegalByClient = new Map(
    desired.legalLinks.map((l) => [l.guidClient, l]),
  );
  const desiredOutletsByStore = new Map(
    desired.outletLinks.map((o) => [o.guidStore, o]),
  );

  for (const link of desired.legalLinks) {
    const result = await client.query(
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
        RETURNING (xmax = 0) AS inserted
      `,
      [link.guidClient, link.guidHoldingRoot, link.isHoldingHead, sourceSha256],
    );
    if (result.rowCount) {
      legalLinksWritten += 1;
    }
  }

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
    const desiredLegalIds = new Set(
      desired.legalLinks.filter((l) => l.guidHoldingRoot === holdingRoot).map((l) => l.guidClient),
    );
    const desiredOutletIds = new Set(
      desired.outletLinks.filter((o) => o.guidHoldingRoot === holdingRoot).map((o) => o.guidStore),
    );

    const deactivatedLegal = await client.query(
      `
        UPDATE onec_holding_v2_legal_links
        SET link_active = FALSE, last_applied_at = NOW(), last_source_sha256 = $3
        WHERE guid_holding_root = $1::uuid
          AND link_active = TRUE
          AND NOT (guid_client = ANY($2::uuid[]))
        RETURNING guid_client
      `,
      [holdingRoot, [...desiredLegalIds], sourceSha256],
    );
    legalLinksWritten += deactivatedLegal.rowCount ?? 0;

    const deactivatedOutlets = await client.query(
      `
        UPDATE onec_holding_v2_outlet_links
        SET link_active = FALSE, last_applied_at = NOW(), last_source_sha256 = $3
        WHERE guid_holding_root = $1::uuid
          AND link_active = TRUE
          AND NOT (guid_store = ANY($2::uuid[]))
        RETURNING guid_store
      `,
      [holdingRoot, [...desiredOutletIds], sourceSha256],
    );
    outletLinksWritten += deactivatedOutlets.rowCount ?? 0;
  }

  for (const patch of desired.typeCategoryPatches) {
    if (patch.scope === "client") {
      if (await mergeClientTypeCategory(client, patch, sourceSha256)) {
        typeCategoryWritten += 1;
      }
    } else if (await mergeOutletTypeCategory(client, patch, sourceSha256)) {
      typeCategoryWritten += 1;
    }
  }

  void desiredLegalByClient;
  void desiredOutletsByStore;

  const dupLegal = await client.query<{ guid_client: string; c: string }>(
    `
      SELECT guid_client::text, COUNT(*)::text AS c
      FROM onec_holding_v2_legal_links
      WHERE link_active = TRUE
      GROUP BY guid_client
      HAVING COUNT(*) > 1
    `,
  );
  if (dupLegal.rowCount && dupLegal.rowCount > 0) {
    throw new Error("INVARIANT: duplicate active legal link");
  }

  const dupStore = await client.query(
    `
      SELECT guid_store FROM onec_holding_v2_outlet_links
      WHERE link_active = TRUE
      GROUP BY guid_store
      HAVING COUNT(*) > 1
    `,
  );
  if (dupStore.rowCount && dupStore.rowCount > 0) {
    throw new Error("INVARIANT: duplicate active outlet link");
  }

  return { legalLinksWritten, outletLinksWritten, typeCategoryWritten };
}

async function runInTransaction(
  client: PoolClient,
  desired: HoldingV2DesiredSnapshot,
  normalizedStateSha256: string,
  verificationFingerprint: string | null,
): Promise<HoldingV2ReconcileApplyResult> {
  const runInsert = await client.query<{ id: string }>(
    `
      INSERT INTO onec_holding_v2_reconcile_runs (
        status, source_sha256, normalized_state_sha256, verification_fingerprint
      ) VALUES ('running', $1, $2, $3)
      RETURNING id::text
    `,
    [desired.sourceSha256, normalizedStateSha256, verificationFingerprint],
  );
  const runId = runInsert.rows[0]!.id;

  try {
    const persisted = await loadHoldingV2PersistedState(client);
    const persistedHash = computePersistedNormalizedStateSha256(persisted);
    if (persistedHash === normalizedStateSha256) {
      await client.query(
        `
          UPDATE onec_holding_v2_reconcile_runs
          SET status = 'no_changes', finished_at = NOW()
          WHERE id = $1::uuid
        `,
        [runId],
      );
      return {
        ok: true,
        code: "NO_CHANGES",
        normalizedStateSha256,
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
      throw new Error(`CLIENT_STUB_MISSING:${missingClients[0]}`);
    }

    const counts = await applyDesiredState(client, desired);

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
      [normalizedStateSha256, desired.sourceSha256],
    );

    await client.query(
      `
        UPDATE onec_holding_v2_reconcile_runs
        SET status = 'success',
            finished_at = NOW(),
            legal_links_written = $2,
            outlet_links_written = $3,
            type_category_written = $4
        WHERE id = $1::uuid
      `,
      [runId, counts.legalLinksWritten, counts.outletLinksWritten, counts.typeCategoryWritten],
    );

    return {
      ok: true,
      code: "SUCCESS",
      normalizedStateSha256,
      ...counts,
      runId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client.query(
      `
        UPDATE onec_holding_v2_reconcile_runs
        SET status = 'failed', finished_at = NOW(), error_code = $2
        WHERE id = $1::uuid
      `,
      [runId, message.slice(0, 200)],
    );
    if (message.startsWith("CLIENT_STUB_MISSING:")) {
      return {
        ok: false,
        code: "CLIENT_STUB_MISSING",
        message: "One or more legal entities are missing from onec_clients.",
        runId,
      };
    }
    if (message.startsWith("INVARIANT:")) {
      return { ok: false, code: "INVARIANT_VIOLATION", message, runId };
    }
    return { ok: false, code: "FAILED", message, runId };
  }
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
  const normalizedStateSha256 = computeDesiredNormalizedStateSha256(desired);

  if (options.participatingClient) {
    return runInTransaction(
      options.participatingClient,
      desired,
      normalizedStateSha256,
      options.verificationFingerprint ?? null,
    );
  }

  const pool = new Pool({ connectionString: options.databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    const lock = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY],
    );
    if (!lock.rows[0]?.acquired) {
      return { ok: false, code: "RECONCILE_LOCKED", message: "Holding v2 reconcile lock not acquired." };
    }

    await client.query("BEGIN");
    let result: HoldingV2ReconcileApplyResult;
    try {
      result = await runInTransaction(
        client,
        desired,
        normalizedStateSha256,
        options.verificationFingerprint ?? null,
      );
      if (result.ok) {
        await client.query("COMMIT");
      } else {
        await client.query("ROLLBACK");
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [HOLDING_V2_RECONCILE_ADVISORY_LOCK_KEY]);
    }
    return result;
  } finally {
    client.release();
    await pool.end();
  }
}
