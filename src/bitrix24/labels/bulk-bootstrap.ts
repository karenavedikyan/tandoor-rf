import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { requirePool } from "../../db/pool";
import { insertCardObjectLinkIfAbsent } from "../tasks/card-objects";
import { confirmObject, isObjectConfirmed, issueLabelOnClient } from "./repository";

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

export type BootstrapAction =
  | { kind: "issue_label"; holdingGuid: string }
  | { kind: "skip_label_existing"; holdingGuid: string }
  | { kind: "skip_label_revoked"; holdingGuid: string }
  | { kind: "create_card_link"; clientGuid: string; holdingGuid: string }
  | { kind: "skip_card_link"; clientGuid: string; holdingGuid: string }
  | { kind: "conflict_card_link"; clientGuid: string; holdingGuid: string; reason: string };

export type BootstrapResult = {
  mode: "dry_run" | "apply";
  counters: BootstrapCounters;
  conflicts: Array<{ clientGuid: string; holdingGuid: string; reason: string }>;
  actions: BootstrapAction[];
  fingerprint: string;
  applied: boolean;
};

type BootstrapPlan = {
  rows: BootstrapRow[];
  holdings: string[];
  actions: BootstrapAction[];
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
  const actions: BootstrapAction[] = [];

  for (const holdingGuid of holdings) {
    const existingLabel = await client.query<{ label_code: string; revoked_at: Date | null }>(
      `SELECT label_code, revoked_at FROM bitrix24_object_labels
       WHERE object_type = 'holding' AND object_guid = $1::uuid
       ORDER BY issued_at DESC LIMIT 1
       FOR UPDATE`,
      [holdingGuid],
    );
    const labelRow = existingLabel.rows[0];
    if (labelRow?.revoked_at) {
      actions.push({ kind: "skip_label_revoked", holdingGuid });
    } else if (labelRow) {
      actions.push({ kind: "skip_label_existing", holdingGuid });
    } else {
      actions.push({ kind: "issue_label", holdingGuid });
    }
  }

  for (const row of rows) {
    const mapping = await client.query<{ object_type: string; object_guid: string }>(
      `SELECT object_type, object_guid::text FROM bitrix24_client_card_objects
       WHERE card_guid = $1::uuid
       FOR UPDATE`,
      [row.clientGuid],
    );
    const existing = mapping.rows[0];
    if (!existing) {
      actions.push({
        kind: "create_card_link",
        clientGuid: row.clientGuid,
        holdingGuid: row.holdingGuid,
      });
      continue;
    }
    if (existing.object_type === "holding" && existing.object_guid === row.holdingGuid) {
      actions.push({
        kind: "skip_card_link",
        clientGuid: row.clientGuid,
        holdingGuid: row.holdingGuid,
      });
      continue;
    }
    actions.push({
      kind: "conflict_card_link",
      clientGuid: row.clientGuid,
      holdingGuid: row.holdingGuid,
      reason: "existing_card_link_mismatch",
    });
    conflicts.push({
      clientGuid: row.clientGuid,
      holdingGuid: row.holdingGuid,
      reason: "existing_card_link_mismatch",
    });
  }

  return { rows, holdings, actions, conflicts };
}

function countersFromPlan(plan: BootstrapPlan): BootstrapCounters {
  return {
    clientsScanned: plan.rows.length,
    holdingsDistinct: plan.holdings.length,
    cardLinksCreated: plan.actions.filter((a) => a.kind === "create_card_link").length,
    cardLinksSkippedExisting: plan.actions.filter((a) => a.kind === "skip_card_link").length,
    cardLinksConflict: plan.actions.filter((a) => a.kind === "conflict_card_link").length,
    objectsConfirmed: plan.actions.filter((a) => a.kind === "issue_label").length,
    labelsIssued: plan.actions.filter((a) => a.kind === "issue_label").length,
    labelsSkippedExisting: plan.actions.filter((a) => a.kind === "skip_label_existing").length,
    labelsRevokedSkipped: plan.actions.filter((a) => a.kind === "skip_label_revoked").length,
  };
}

export function computeBootstrapFingerprint(plan: Pick<BootstrapPlan, "actions" | "conflicts">): string {
  return createHash("sha256")
    .update(JSON.stringify({ actions: plan.actions, conflicts: plan.conflicts }))
    .digest("hex");
}

async function assertActiveAdminActor(actorUserId: string, client: PoolClient): Promise<void> {
  const result = await client.query<{ role: string; status: string }>(
    `SELECT role, status FROM users WHERE id = $1::uuid`,
    [actorUserId],
  );
  const row = result.rows[0];
  if (!row || row.status !== "active" || row.role !== "admin") {
    throw new Error("BOOTSTRAP_ACTOR_INVALID");
  }
}

async function applyBootstrapPlan(
  client: PoolClient,
  plan: BootstrapPlan,
  actorUserId: string,
): Promise<BootstrapCounters> {
  const counters = countersFromPlan(plan);

  for (const action of plan.actions) {
    if (action.kind === "issue_label") {
      const confirmed = await isObjectConfirmed("holding", action.holdingGuid, client);
      if (!confirmed) {
        await confirmObject("holding", action.holdingGuid, actorUserId, client);
      }
      const issued = await issueLabelOnClient("holding", action.holdingGuid, actorUserId, client);
      if (!issued.created) {
        counters.labelsSkippedExisting += 1;
        counters.labelsIssued -= 1;
        counters.objectsConfirmed -= 1;
      }
      continue;
    }
    if (action.kind === "create_card_link") {
      const holdingConfirmed = await isObjectConfirmed("holding", action.holdingGuid, client);
      if (!holdingConfirmed) {
        throw new Error("BOOTSTRAP_HOLDING_NOT_CONFIRMED");
      }
      const inserted = await insertCardObjectLinkIfAbsent(
        action.clientGuid,
        "holding",
        action.holdingGuid,
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
  }

  return counters;
}

export async function runLabelsBulkBootstrap(
  mode: "dry_run" | "apply",
  actorUserId: string | null = null,
  expectedFingerprint: string | null = null,
): Promise<BootstrapResult> {
  const pool = requirePool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const plan = await buildBootstrapPlan(client);
    const counters = countersFromPlan(plan);
    const fingerprint = computeBootstrapFingerprint(plan);

    if (mode === "dry_run") {
      await client.query("ROLLBACK");
      return {
        mode,
        counters,
        conflicts: plan.conflicts,
        actions: plan.actions,
        fingerprint,
        applied: false,
      };
    }

    if (!actorUserId) {
      await client.query("ROLLBACK");
      throw new Error("BOOTSTRAP_ACTOR_REQUIRED");
    }
    await assertActiveAdminActor(actorUserId, client);

    if (plan.conflicts.length > 0) {
      await client.query(
        `INSERT INTO bitrix24_labels_bootstrap_audit (run_mode, finished_at, status, summary)
         VALUES ('apply', NOW(), 'conflict', $1::jsonb)`,
        [
          JSON.stringify({
            counters,
            conflictCount: plan.conflicts.length,
            fingerprint,
            applied: false,
            actorUserId,
          }),
        ],
      );
      await client.query("COMMIT");
      return {
        mode,
        counters,
        conflicts: plan.conflicts,
        actions: plan.actions,
        fingerprint,
        applied: false,
      };
    }

    if (!expectedFingerprint || expectedFingerprint !== fingerprint) {
      await client.query("ROLLBACK");
      throw new Error("BOOTSTRAP_STALE_FINGERPRINT");
    }

    try {
      const appliedCounters = await applyBootstrapPlan(client, plan, actorUserId);
      await client.query(
        `INSERT INTO bitrix24_labels_bootstrap_audit (run_mode, finished_at, status, summary)
         VALUES ('apply', NOW(), 'success', $1::jsonb)`,
        [
          JSON.stringify({
            counters: appliedCounters,
            conflictCount: 0,
            fingerprint,
            applied: true,
            actorUserId,
          }),
        ],
      );
      await client.query("COMMIT");
      return {
        mode,
        counters: appliedCounters,
        conflicts: [],
        actions: plan.actions,
        fingerprint,
        applied: true,
      };
    } catch (error) {
      await client.query(
        `INSERT INTO bitrix24_labels_bootstrap_audit (run_mode, finished_at, status, summary)
         VALUES ('apply', NOW(), 'failed', $1::jsonb)`,
        [
          JSON.stringify({
            counters,
            fingerprint,
            applied: false,
            actorUserId,
            message: error instanceof Error ? error.message : "bootstrap_apply_failed",
          }),
        ],
      );
      await client.query("COMMIT");
      throw error;
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
