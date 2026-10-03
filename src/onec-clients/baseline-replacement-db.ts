import type { PoolClient } from "pg";
import type { QuarantineManifest } from "./quarantine-manifest";
import { quarantineManifestSha256 } from "./quarantine-manifest";

export type ClientBaselineRow = {
  guid_client: string;
  baseline_status: string;
};

export async function loadClientBaselineSnapshot(client: PoolClient): Promise<Map<string, string>> {
  const result = await client.query<ClientBaselineRow>(
    `SELECT guid_client::text, baseline_status FROM onec_clients`,
  );
  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(row.guid_client.toLowerCase(), row.baseline_status);
  }
  return map;
}

export async function loadActiveBaselineGuids(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ guid_client: string }>(
    `SELECT guid_client::text FROM onec_clients WHERE COALESCE(baseline_status, 'active') = 'active'`,
  );
  return new Set(result.rows.map((row) => row.guid_client.toLowerCase()));
}

export async function upsertQuarantineRecords(
  client: PoolClient,
  input: {
    manifest: QuarantineManifest;
    supersedePrevious?: boolean;
  },
): Promise<void> {
  const manifestSha = quarantineManifestSha256(input.manifest);
  if (input.supersedePrevious) {
    await client.query(
      `
        UPDATE onec_client_quarantine_records
        SET superseded_at = NOW(), superseded_by_manifest_sha256 = $1
        WHERE source_sha256 = $2 AND superseded_at IS NULL
      `,
      [manifestSha, input.manifest.sourceSha256],
    );
  }
  for (const entry of input.manifest.entries) {
    const existing = await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM onec_client_quarantine_records
        WHERE guid_client = $1::uuid
          AND source_sha256 = $2
          AND manifest_sha256 = $3
          AND superseded_at IS NULL
        LIMIT 1
      `,
      [entry.guidClient, input.manifest.sourceSha256, manifestSha],
    );
    if (existing.rows[0]) {
      continue;
    }
    await client.query(
      `
        INSERT INTO onec_client_quarantine_records (
          guid_client, source_sha256, quarantine_reason, related_guid, manifest_sha256
        )
        VALUES ($1::uuid, $2, $3, $4::uuid, $5)
      `,
      [entry.guidClient, input.manifest.sourceSha256, entry.reason, entry.relatedGuid ?? null, manifestSha],
    );
  }
}

export async function findDryRunByFingerprint(
  client: PoolClient,
  input: { planFingerprint: string; clientsSourceSha256: string },
): Promise<{
  id: string;
  roster_source_sha256: string | null;
  quarantine_manifest_sha256: string | null;
} | null> {
  const row = await client.query<{
    id: string;
    roster_source_sha256: string | null;
    quarantine_manifest_sha256: string | null;
  }>(
    `
      SELECT id::text, roster_source_sha256, quarantine_manifest_sha256
      FROM onec_baseline_replacement_runs
      WHERE mode = 'dry_run'
        AND status = 'success'
        AND plan_fingerprint = $1
        AND clients_source_sha256 = $2
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `,
    [input.planFingerprint, input.clientsSourceSha256],
  );
  return row.rows[0] ?? null;
}

export type BaselineApplyResultMeta = {
  postApplyStateSha256: string;
  clientsImportRunId: string;
};

export function extractBaselineApplyResultMeta(planJson: unknown): BaselineApplyResultMeta | null {
  if (!planJson || typeof planJson !== "object" || Array.isArray(planJson)) {
    return null;
  }
  const applyResult = (planJson as { applyResult?: BaselineApplyResultMeta }).applyResult;
  if (
    !applyResult?.postApplyStateSha256 ||
    !applyResult.clientsImportRunId ||
    applyResult.postApplyStateSha256.length !== 64 ||
    !/^[0-9a-f]+$/i.test(applyResult.postApplyStateSha256)
  ) {
    return null;
  }
  return {
    postApplyStateSha256: applyResult.postApplyStateSha256.toLowerCase(),
    clientsImportRunId: applyResult.clientsImportRunId,
  };
}

export async function findSuccessfulBaselineApplyByFingerprint(
  client: PoolClient,
  input: { planFingerprint: string; clientsSourceSha256: string },
): Promise<{ id: string; plan_json: unknown } | null> {
  const row = await client.query<{ id: string; plan_json: unknown }>(
    `
      SELECT id::text, plan_json
      FROM onec_baseline_replacement_runs
      WHERE mode = 'apply'
        AND status = 'success'
        AND plan_fingerprint = $1
        AND clients_source_sha256 = $2
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `,
    [input.planFingerprint, input.clientsSourceSha256],
  );
  return row.rows[0] ?? null;
}

export async function countActiveBaselineClients(client: PoolClient): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_clients WHERE COALESCE(baseline_status, 'active') = 'active'`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

export async function storeExtendedContractConfirmation(
  client: PoolClient,
  input: {
    clientsSourceSha256: string;
    verificationFingerprint: string;
    operatorReference: string;
    confirmationSha256: string;
  },
): Promise<void> {
  await client.query(
    `
      UPDATE onec_extended_contract_confirmations
      SET superseded_at = NOW()
      WHERE clients_source_sha256 = $1 AND superseded_at IS NULL
    `,
    [input.clientsSourceSha256],
  );
  await client.query(
    `
      INSERT INTO onec_extended_contract_confirmations (
        clients_source_sha256, verification_fingerprint, operator_reference
      )
      VALUES ($1, $2, $3)
    `,
    [input.clientsSourceSha256, input.verificationFingerprint, input.operatorReference],
  );
}

export async function loadActiveExtendedContractConfirmationSha256(
  client: PoolClient,
  clientsSourceSha256: string,
): Promise<string | null> {
  const { loadStoredExtendedContractConfirmationSha256 } = await import("./baseline-extended-contract");
  return loadStoredExtendedContractConfirmationSha256(client, clientsSourceSha256);
}

export async function archiveClientsNotInAccepted(
  client: PoolClient,
  input: {
    acceptedGuids: Set<string>;
    quarantinedGuids: Set<string>;
    sourceSha256: string;
  },
): Promise<{ archivedCount: number; quarantinedCount: number }> {
  const all = await client.query<{ guid_client: string; baseline_status: string }>(
    `SELECT guid_client::text, baseline_status FROM onec_clients`,
  );
  let archivedCount = 0;
  let quarantinedCount = 0;
  for (const row of all.rows) {
    const guid = row.guid_client.toLowerCase();
    if (input.quarantinedGuids.has(guid)) {
      const updated = await client.query(
        `
          UPDATE onec_clients
          SET baseline_status = 'quarantined',
              baseline_archived_at = CASE
                WHEN baseline_status IS DISTINCT FROM 'quarantined' THEN NOW()
                ELSE baseline_archived_at
              END,
              baseline_archive_reason = 'quarantine_manifest',
              baseline_archive_source_sha256 = $2
          WHERE guid_client = $1::uuid
            AND (
              baseline_status IS DISTINCT FROM 'quarantined'
              OR baseline_archive_source_sha256 IS DISTINCT FROM $2
            )
        `,
        [row.guid_client, input.sourceSha256],
      );
      if ((updated.rowCount ?? 0) > 0) {
        quarantinedCount += 1;
      }
      continue;
    }
    if (!input.acceptedGuids.has(guid)) {
      const updated = await client.query(
        `
          UPDATE onec_clients
          SET baseline_status = 'archived_baseline',
              baseline_archived_at = CASE
                WHEN baseline_status IS DISTINCT FROM 'archived_baseline' THEN NOW()
                ELSE baseline_archived_at
              END,
              baseline_archive_reason = 'not_in_accepted_baseline',
              baseline_archive_source_sha256 = $2
          WHERE guid_client = $1::uuid
            AND (
              baseline_status IS DISTINCT FROM 'archived_baseline'
              OR baseline_archive_source_sha256 IS DISTINCT FROM $2
            )
        `,
        [row.guid_client, input.sourceSha256],
      );
      if ((updated.rowCount ?? 0) > 0) {
        archivedCount += 1;
      }
      continue;
    }
    await client.query(
      `
        UPDATE onec_clients
        SET baseline_status = 'active',
            baseline_archived_at = NULL,
            baseline_archive_reason = NULL,
            baseline_archive_source_sha256 = NULL
        WHERE guid_client = $1::uuid
          AND baseline_status IS DISTINCT FROM 'active'
      `,
      [row.guid_client],
    );
  }
  return { archivedCount, quarantinedCount };
}

export async function restoreBaselineSnapshot(
  client: PoolClient,
  snapshot: Record<string, string>,
): Promise<number> {
  let restored = 0;
  for (const [guid, status] of Object.entries(snapshot)) {
    await client.query(
      `
        UPDATE onec_clients
        SET baseline_status = $2,
            baseline_archived_at = CASE WHEN $2 = 'active' THEN NULL ELSE baseline_archived_at END,
            baseline_archive_reason = CASE WHEN $2 = 'active' THEN NULL ELSE baseline_archive_reason END
        WHERE guid_client = $1::uuid
      `,
      [guid, status],
    );
    restored += 1;
  }
  return restored;
}
