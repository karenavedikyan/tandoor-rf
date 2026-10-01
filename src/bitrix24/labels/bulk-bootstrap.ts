import type { PoolClient } from "pg";
import { requirePool } from "../../db/pool";
import { insertCardObjectLinkIfAbsent } from "../tasks/card-objects";
import { confirmObject, issueLabelOnClient } from "./repository";

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
  applied: boolean;
};

type BootstrapPlan = {
  rows: BootstrapRow[];
  holdings: string[];
  cardActions: Array<{ clientGuid: string; holdingGuid: string; action: "create" | "skip" | "conflict" }>;
  holdingActions: Array<{ holdingGuid: string; action: "issue" | "skip_existing" | "skip_revoked" }>;
  conflicts: BootstrapResult["conflicts"];
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

async function buildBootstrapPlan(client: PoolClient): Promise<BootstrapPlan> {
  const rows = await loadBootstrapRows(client);
  const holdings = [...new Set(rows.map((row) => row.holdingGuid))];
  const conflicts: BootstrapResult["conflicts"] = [];
  const cardActions: BootstrapPlan["cardActions"] = [];
  const holdingActions: BootstrapPlan["holdingActions"] = [];

  for (const holdingGuid of holdings) {
    const existingLabel = await client.query<{ label_code: string; revoked_at: Date | null }>(
      `SELECT label_code, revoked_at FROM bitrix24_object_labels
       WHERE object_type = 'holding' AND object_guid = $1::uuid
       ORDER BY issued_at DESC LIMIT 1`,
      [holdingGuid],
    );
    const labelRow = existingLabel.rows[0];
    if (labelRow?.revoked_at) {
      holdingActions.push({ holdingGuid, action: "skip_revoked" });
    } else if (labelRow) {
      holdingActions.push({ holdingGuid, action: "skip_existing" });
    } else {
      holdingActions.push({ holdingGuid, action: "issue" });
    }
  }

  for (const row of rows) {
    const mapping = await client.query<{ object_type: string; object_guid: string }>(
      `SELECT object_type, object_guid::text FROM bitrix24_client_card_objects WHERE card_guid = $1::uuid`,
      [row.clientGuid],
    );
    const existing = mapping.rows[0];
    if (!existing) {
      cardActions.push({ clientGuid: row.clientGuid, holdingGuid: row.holdingGuid, action: "create" });
      continue;
    }
    if (existing.object_type === "holding" && existing.object_guid === row.holdingGuid) {
      cardActions.push({ clientGuid: row.clientGuid, holdingGuid: row.holdingGuid, action: "skip" });
      continue;
    }
    cardActions.push({ clientGuid: row.clientGuid, holdingGuid: row.holdingGuid, action: "conflict" });
    conflicts.push({
      clientGuid: row.clientGuid,
      holdingGuid: row.holdingGuid,
      reason: "existing_card_link_mismatch",
    });
  }

  return { rows, holdings, cardActions, holdingActions, conflicts };
}

function countersFromPlan(plan: BootstrapPlan): BootstrapCounters {
  return {
    clientsScanned: plan.rows.length,
    holdingsDistinct: plan.holdings.length,
    cardLinksCreated: plan.cardActions.filter((a) => a.action === "create").length,
    cardLinksSkippedExisting: plan.cardActions.filter((a) => a.action === "skip").length,
    cardLinksConflict: plan.cardActions.filter((a) => a.action === "conflict").length,
    objectsConfirmed:
      plan.holdingActions.filter((a) => a.action === "issue").length +
      plan.cardActions.filter((a) => a.action === "create").length,
    labelsIssued: plan.holdingActions.filter((a) => a.action === "issue").length,
    labelsSkippedExisting: plan.holdingActions.filter((a) => a.action === "skip_existing").length,
    labelsRevokedSkipped: plan.holdingActions.filter((a) => a.action === "skip_revoked").length,
  };
}

async function applyBootstrapPlan(
  client: PoolClient,
  plan: BootstrapPlan,
  actorUserId: string,
): Promise<BootstrapCounters> {
  const counters = countersFromPlan(plan);

  await client.query("BEGIN");
  try {
    for (const holding of plan.holdingActions) {
      if (holding.action !== "issue") {
        continue;
      }
      await confirmObject("holding", holding.holdingGuid, actorUserId, client);
      const issued = await issueLabelOnClient("holding", holding.holdingGuid, actorUserId, client);
      if (!issued.created) {
        counters.labelsSkippedExisting += 1;
        counters.labelsIssued -= 1;
      }
    }

    for (const card of plan.cardActions) {
      if (card.action === "skip") {
        continue;
      }
      if (card.action === "conflict") {
        continue;
      }
      await confirmObject("holding", card.holdingGuid, actorUserId, client);
      const inserted = await insertCardObjectLinkIfAbsent(
        card.clientGuid,
        "holding",
        card.holdingGuid,
        client,
      );
      if (inserted === "conflict") {
        throw new Error("BOOTSTRAP_CARD_LINK_CONFLICT");
      }
      if (inserted === "unchanged") {
        counters.cardLinksCreated -= 1;
        counters.cardLinksSkippedExisting += 1;
      }
    }

    await client.query(
      `INSERT INTO bitrix24_labels_bootstrap_audit (run_mode, finished_at, status, summary)
       VALUES ('apply', NOW(), $1, $2::jsonb)`,
      [
        plan.conflicts.length > 0 ? "conflict" : "success",
        JSON.stringify({ counters, conflictCount: plan.conflicts.length }),
      ],
    );
    await client.query("COMMIT");
    return counters;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function runLabelsBulkBootstrap(
  mode: "dry_run" | "apply",
  actorUserId: string | null = null,
): Promise<BootstrapResult> {
  const pool = requirePool();
  const client = await pool.connect();

  try {
    const plan = await buildBootstrapPlan(client);
    const counters = countersFromPlan(plan);

    if (mode === "apply") {
      if (!actorUserId) {
        throw new Error("BOOTSTRAP_ACTOR_REQUIRED");
      }
      if (plan.conflicts.length > 0) {
        await client.query(
          `INSERT INTO bitrix24_labels_bootstrap_audit (run_mode, finished_at, status, summary)
           VALUES ('apply', NOW(), 'conflict', $1::jsonb)`,
          [JSON.stringify({ counters, conflictCount: plan.conflicts.length, applied: false })],
        );
        return { mode, counters, conflicts: plan.conflicts, applied: false };
      }
      const appliedCounters = await applyBootstrapPlan(client, plan, actorUserId);
      return { mode, counters: appliedCounters, conflicts: [], applied: true };
    }

    return { mode, counters, conflicts: plan.conflicts, applied: false };
  } finally {
    client.release();
  }
}
