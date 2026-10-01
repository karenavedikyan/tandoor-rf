import type { PoolClient } from "pg";
import { requirePool } from "../../db/pool";
import { confirmCardObjectLink } from "../tasks/card-objects";
import { confirmObject } from "./repository";
import { issueLabelInTransaction } from "./repository";

export type BootstrapRow = {
  clientGuid: string;
  holdingGuid: string;
  clientName: string;
  holdingName: string | null;
};

export type BootstrapCounters = {
  clientsScanned: number;
  holdingsDistinct: number;
  cardLinksCreated: number;
  cardLinksSkippedExisting: number;
  cardLinksConflict: number;
  objectsConfirmed: number;
  labelsIssued: number;
  labelsSkippedExisting: number;
  labelsRevokedSkipped: number;
};

export type BootstrapResult = {
  mode: "dry_run" | "apply";
  counters: BootstrapCounters;
  conflicts: Array<{ clientGuid: string; holdingGuid: string; reason: string }>;
};

async function loadBootstrapRows(client: PoolClient): Promise<BootstrapRow[]> {
  const result = await client.query<{
    guid_client: string;
    guid_holding: string;
    name_client: string;
    name_holding: string | null;
  }>(
    `SELECT guid_client::text, guid_holding::text, name_client, name_holding
     FROM onec_clients
     WHERE guid_client IS NOT NULL
       AND guid_holding IS NOT NULL
       AND guid_client <> '00000000-0000-0000-0000-000000000000'::uuid
       AND guid_holding <> '00000000-0000-0000-0000-000000000000'::uuid
     ORDER BY guid_holding, guid_client`,
  );
  return result.rows.map((row) => ({
    clientGuid: row.guid_client,
    holdingGuid: row.guid_holding,
    clientName: row.name_client,
    holdingName: row.name_holding,
  }));
}

export async function runLabelsBulkBootstrap(
  mode: "dry_run" | "apply",
  actorUserId: string | null = null,
): Promise<BootstrapResult> {
  const pool = requirePool();
  const client = await pool.connect();
  const counters: BootstrapCounters = {
    clientsScanned: 0,
    holdingsDistinct: 0,
    cardLinksCreated: 0,
    cardLinksSkippedExisting: 0,
    cardLinksConflict: 0,
    objectsConfirmed: 0,
    labelsIssued: 0,
    labelsSkippedExisting: 0,
    labelsRevokedSkipped: 0,
  };
  const conflicts: BootstrapResult["conflicts"] = [];

  try {
    const rows = await loadBootstrapRows(client);
    counters.clientsScanned = rows.length;
    const holdings = new Set(rows.map((row) => row.holdingGuid));
    counters.holdingsDistinct = holdings.size;

    for (const holdingGuid of holdings) {
      const existingLabel = await client.query<{ label_code: string; revoked_at: Date | null }>(
        `SELECT label_code, revoked_at FROM bitrix24_object_labels
         WHERE object_type = 'holding' AND object_guid = $1::uuid
         ORDER BY issued_at DESC LIMIT 1`,
        [holdingGuid],
      );
      const labelRow = existingLabel.rows[0];
      if (labelRow?.revoked_at) {
        counters.labelsRevokedSkipped += 1;
      } else if (labelRow) {
        counters.labelsSkippedExisting += 1;
      } else if (mode === "apply") {
        await confirmObject("holding", holdingGuid, actorUserId, client);
        counters.objectsConfirmed += 1;
        const issued = await issueLabelInTransaction("holding", holdingGuid, actorUserId);
        if (issued.created) {
          counters.labelsIssued += 1;
        } else {
          counters.labelsSkippedExisting += 1;
        }
      } else {
        counters.labelsIssued += 1;
        counters.objectsConfirmed += 1;
      }
    }

    for (const row of rows) {
      const mapping = await client.query<{ object_guid: string }>(
        `SELECT object_guid::text FROM bitrix24_client_card_objects WHERE card_guid = $1::uuid`,
        [row.clientGuid],
      );
      const existing = mapping.rows[0];
      if (!existing) {
        if (mode === "apply") {
          await confirmObject("holding", row.holdingGuid, actorUserId, client);
          await confirmCardObjectLink(row.clientGuid, "holding", row.holdingGuid, client);
        }
        counters.cardLinksCreated += 1;
        continue;
      }
      if (existing.object_guid === row.holdingGuid) {
        counters.cardLinksSkippedExisting += 1;
        continue;
      }
      counters.cardLinksConflict += 1;
      conflicts.push({
        clientGuid: row.clientGuid,
        holdingGuid: row.holdingGuid,
        reason: "existing_card_link_mismatch",
      });
    }

    if (mode === "apply") {
      await client.query(
        `INSERT INTO bitrix24_labels_bootstrap_audit (run_mode, finished_at, status, summary)
         VALUES ('apply', NOW(), 'success', $1::jsonb)`,
        [JSON.stringify({ counters, conflictCount: conflicts.length })],
      );
    }
  } catch (error) {
    throw error;
  } finally {
    client.release();
  }

  return { mode, counters, conflicts };
}
