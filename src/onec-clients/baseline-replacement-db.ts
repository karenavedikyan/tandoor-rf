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
  const row = await client.query<{ verification_fingerprint: string; operator_reference: string }>(
    `
      SELECT verification_fingerprint, operator_reference
      FROM onec_extended_contract_confirmations
      WHERE clients_source_sha256 = $1 AND superseded_at IS NULL
      ORDER BY confirmed_at DESC
      LIMIT 1
    `,
    [clientsSourceSha256],
  );
  const stored = row.rows[0];
  if (!stored) {
    return null;
  }
  const { extendedContractConfirmationSha256 } = await import("./extended-contract-gate");
  return extendedContractConfirmationSha256({
    clientsSourceSha256: clientsSourceSha256.toLowerCase(),
    verificationFingerprint: stored.verification_fingerprint,
    operatorReference: stored.operator_reference,
  });
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
      await client.query(
        `
          UPDATE onec_clients
          SET baseline_status = 'quarantined',
              baseline_archived_at = NOW(),
              baseline_archive_reason = 'quarantine_manifest',
              baseline_archive_source_sha256 = $2
          WHERE guid_client = $1::uuid
        `,
        [row.guid_client, input.sourceSha256],
      );
      quarantinedCount += 1;
      continue;
    }
    if (!input.acceptedGuids.has(guid)) {
      await client.query(
        `
          UPDATE onec_clients
          SET baseline_status = 'archived_baseline',
              baseline_archived_at = NOW(),
              baseline_archive_reason = 'not_in_accepted_baseline',
              baseline_archive_source_sha256 = $2
          WHERE guid_client = $1::uuid
        `,
        [row.guid_client, input.sourceSha256],
      );
      archivedCount += 1;
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
