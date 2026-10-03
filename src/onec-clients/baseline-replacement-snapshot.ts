import type { PoolClient } from "pg";
import { loadExchangeState } from "../onec-exchange/state";
import type { DbExchangeStateCapture } from "./baseline-replacement-db-state";

export type PreApplyClientRow = {
  guid_client: string;
  name_client: string;
  guid_holding: string | null;
  name_holding: string;
  guid_manager: string;
  name_manager: string;
  address: string;
  telephone: unknown;
  source_sha256: string | null;
  baseline_status: string;
  baseline_archived_at: string | null;
  baseline_archive_reason: string | null;
  baseline_archive_source_sha256: string | null;
  is_holding: boolean | null;
  extended_format_version: string | null;
  extended_source_sha256: string | null;
  extended_snapshot: unknown;
  extended_imported_at: string | null;
  extended_freshness_state: string | null;
  holding_link_state: string | null;
  guid_holding_pending: string | null;
  manager_roster_state: string | null;
  first_imported_at: string | null;
  last_imported_at: string | null;
  updated_at: string | null;
};

export type PreApplyOutletRow = {
  guid_store: string;
  guid_client: string;
  is_closed: boolean | null;
  first_source_sha256: string | null;
  last_source_sha256: string | null;
  closure_history: unknown;
  first_imported_at: string | null;
  last_imported_at: string | null;
  updated_at: string | null;
};

export type PreApplySnapshotV3 = {
  v: 3;
  clients: PreApplyClientRow[];
  outlets: PreApplyOutletRow[];
  quarantineRecordIds: string[];
  contractConfirmationIds: string[];
  exchangeState: DbExchangeStateCapture;
};

export async function capturePreApplySnapshotV3(client: PoolClient): Promise<PreApplySnapshotV3> {
  const clients = await client.query<PreApplyClientRow>(
    `
      SELECT
        guid_client::text,
        name_client,
        guid_holding::text,
        name_holding,
        guid_manager::text,
        name_manager,
        address,
        telephone,
        source_sha256,
        COALESCE(baseline_status, 'active') AS baseline_status,
        baseline_archived_at::text,
        baseline_archive_reason,
        baseline_archive_source_sha256,
        is_holding,
        extended_format_version,
        extended_source_sha256,
        extended_snapshot,
        extended_imported_at::text,
        extended_freshness_state,
        holding_link_state,
        guid_holding_pending::text,
        manager_roster_state,
        first_imported_at::text,
        last_imported_at::text,
        updated_at::text
      FROM onec_clients
    `,
  );

  const outletResult = await client.query<PreApplyOutletRow>(
    `
      SELECT
        guid_store::text,
        guid_client::text,
        is_closed,
        first_source_sha256,
        last_source_sha256,
        closure_history,
        first_imported_at::text,
        last_imported_at::text,
        updated_at::text
      FROM onec_retail_outlets
    `,
  );

  const quarantine = await client.query<{ id: string }>(
    `SELECT id::text FROM onec_client_quarantine_records WHERE superseded_at IS NULL`,
  );

  const confirmations = await client.query<{ id: string }>(
    `SELECT id::text FROM onec_extended_contract_confirmations WHERE superseded_at IS NULL`,
  );

  const exchange = await loadExchangeState(client);

  return {
    v: 3,
    clients: clients.rows,
    outlets: outletResult.rows,
    quarantineRecordIds: quarantine.rows.map((row) => row.id),
    contractConfirmationIds: confirmations.rows.map((row) => row.id),
    exchangeState: {
      last_successful_apply_sha256: exchange.last_successful_apply_sha256,
      accepted_baseline_sha256: exchange.accepted_baseline_sha256,
      last_verified_sha256: exchange.last_verified_sha256,
      apply_blocked: exchange.apply_blocked,
      apply_blocked_reason: exchange.apply_blocked_reason,
    },
  };
}

export async function restorePreApplySnapshotV3(
  client: PoolClient,
  snapshot: PreApplySnapshotV3,
): Promise<number> {
  const snapshotGuids = new Set(snapshot.clients.map((row) => row.guid_client.toLowerCase()));

  await client.query(
    `
      UPDATE onec_clients
      SET baseline_status = 'archived_baseline',
          baseline_archived_at = NOW(),
          baseline_archive_reason = 'baseline_rollback_new_row'
      WHERE NOT (guid_client = ANY($1::uuid[]))
    `,
    [snapshot.clients.map((row) => row.guid_client)],
  );

  for (const row of snapshot.clients) {
    await client.query(
      `
        INSERT INTO onec_clients (
          guid_client, name_client, guid_holding, name_holding, guid_manager, name_manager,
          address, telephone, source_sha256, baseline_status, baseline_archived_at,
          baseline_archive_reason, baseline_archive_source_sha256, is_holding,
          extended_format_version, extended_source_sha256, extended_snapshot,
          extended_imported_at, extended_freshness_state, holding_link_state,
          guid_holding_pending, manager_roster_state, first_imported_at, last_imported_at, updated_at
        )
        VALUES (
          $1::uuid, $2, $3::uuid, $4, $5::uuid, $6, $7, $8::jsonb, $9, $10,
          $11::timestamptz, $12, $13, $14, $15, $16, $17::jsonb, $18::timestamptz, $19,
          $20, $21::uuid, $22, $23::timestamptz, $24::timestamptz, $25::timestamptz
        )
        ON CONFLICT (guid_client) DO UPDATE SET
          name_client = EXCLUDED.name_client,
          guid_holding = EXCLUDED.guid_holding,
          name_holding = EXCLUDED.name_holding,
          guid_manager = EXCLUDED.guid_manager,
          name_manager = EXCLUDED.name_manager,
          address = EXCLUDED.address,
          telephone = EXCLUDED.telephone,
          source_sha256 = EXCLUDED.source_sha256,
          baseline_status = EXCLUDED.baseline_status,
          baseline_archived_at = EXCLUDED.baseline_archived_at,
          baseline_archive_reason = EXCLUDED.baseline_archive_reason,
          baseline_archive_source_sha256 = EXCLUDED.baseline_archive_source_sha256,
          is_holding = EXCLUDED.is_holding,
          extended_format_version = EXCLUDED.extended_format_version,
          extended_source_sha256 = EXCLUDED.extended_source_sha256,
          extended_snapshot = EXCLUDED.extended_snapshot,
          extended_imported_at = EXCLUDED.extended_imported_at,
          extended_freshness_state = EXCLUDED.extended_freshness_state,
          holding_link_state = EXCLUDED.holding_link_state,
          guid_holding_pending = EXCLUDED.guid_holding_pending,
          manager_roster_state = EXCLUDED.manager_roster_state,
          first_imported_at = EXCLUDED.first_imported_at,
          last_imported_at = EXCLUDED.last_imported_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        row.guid_client,
        row.name_client,
        row.guid_holding,
        row.name_holding,
        row.guid_manager,
        row.name_manager,
        row.address,
        JSON.stringify(row.telephone ?? []),
        row.source_sha256,
        row.baseline_status,
        row.baseline_archived_at,
        row.baseline_archive_reason,
        row.baseline_archive_source_sha256,
        row.is_holding,
        row.extended_format_version,
        row.extended_source_sha256,
        row.extended_snapshot ? JSON.stringify(row.extended_snapshot) : null,
        row.extended_imported_at,
        row.extended_freshness_state,
        row.holding_link_state,
        row.guid_holding_pending,
        row.manager_roster_state,
        row.first_imported_at,
        row.last_imported_at,
        row.updated_at,
      ],
    );
  }

  await client.query(`DELETE FROM onec_retail_outlets WHERE NOT (guid_store = ANY($1::uuid[]))`, [
    snapshot.outlets.map((row) => row.guid_store),
  ]);
  for (const outlet of snapshot.outlets) {
    await client.query(
      `
        INSERT INTO onec_retail_outlets (
          guid_store, guid_client, is_closed, first_source_sha256, last_source_sha256,
          closure_history, first_imported_at, last_imported_at, updated_at
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::timestamptz, $8::timestamptz, $9::timestamptz)
        ON CONFLICT (guid_store) DO UPDATE SET
          guid_client = EXCLUDED.guid_client,
          is_closed = EXCLUDED.is_closed,
          first_source_sha256 = EXCLUDED.first_source_sha256,
          last_source_sha256 = EXCLUDED.last_source_sha256,
          closure_history = EXCLUDED.closure_history,
          first_imported_at = EXCLUDED.first_imported_at,
          last_imported_at = EXCLUDED.last_imported_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        outlet.guid_store,
        outlet.guid_client,
        outlet.is_closed,
        outlet.first_source_sha256,
        outlet.last_source_sha256,
        JSON.stringify(outlet.closure_history ?? []),
        outlet.first_imported_at,
        outlet.last_imported_at,
        outlet.updated_at,
      ],
    );
  }

  await client.query(
    `UPDATE onec_client_quarantine_records SET superseded_at = NOW() WHERE superseded_at IS NULL AND NOT (id = ANY($1::uuid[]))`,
    [snapshot.quarantineRecordIds],
  );
  if (snapshot.quarantineRecordIds.length > 0) {
    await client.query(
      `UPDATE onec_client_quarantine_records SET superseded_at = NULL WHERE id = ANY($1::uuid[])`,
      [snapshot.quarantineRecordIds],
    );
  }

  await client.query(
    `UPDATE onec_extended_contract_confirmations SET superseded_at = NOW() WHERE superseded_at IS NULL AND NOT (id = ANY($1::uuid[]))`,
    [snapshot.contractConfirmationIds],
  );
  if (snapshot.contractConfirmationIds.length > 0) {
    await client.query(
      `UPDATE onec_extended_contract_confirmations SET superseded_at = NULL WHERE id = ANY($1::uuid[])`,
      [snapshot.contractConfirmationIds],
    );
  }

  await client.query(
    `
      UPDATE onec_exchange_state
      SET
        last_successful_apply_sha256 = $1,
        accepted_baseline_sha256 = $2,
        last_verified_sha256 = $3,
        apply_blocked = $4,
        apply_blocked_reason = $5,
        updated_at = NOW()
      WHERE id = 1
    `,
    [
      snapshot.exchangeState.last_successful_apply_sha256,
      snapshot.exchangeState.accepted_baseline_sha256,
      snapshot.exchangeState.last_verified_sha256,
      snapshot.exchangeState.apply_blocked,
      snapshot.exchangeState.apply_blocked_reason,
    ],
  );

  return snapshotGuids.size;
}

export function isPreApplySnapshotV3(value: unknown): value is PreApplySnapshotV3 {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as PreApplySnapshotV3).v === 3 &&
    Array.isArray((value as PreApplySnapshotV3).clients) &&
    !!(value as PreApplySnapshotV3).exchangeState
  );
}

/** @deprecated Use isPreApplySnapshotV3 */
export function isPreApplySnapshotV2(value: unknown): value is PreApplySnapshotV3 {
  return isPreApplySnapshotV3(value);
}
