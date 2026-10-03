import type { PoolClient } from "pg";

export type MigrationRequirement = {
  id: string;
  description: string;
};

export type MigrationReadiness = {
  ready: boolean;
  missing: MigrationRequirement[];
};

export type DependencyDimension =
  | "active_access_grants"
  | "linked_employee_accounts"
  | "confirmed_outlets"
  | "confirmed_bitrix_tasks"
  | "child_holding_links";

export type ArchiveDependencyContext = {
  availability: "loaded" | "partial" | "unavailable";
  unavailableDimensions: DependencyDimension[];
  activeAccessGrantCountByClient: Map<string, number>;
  linkedEmployeeAccountCountByClient: Map<string, number>;
  confirmedOutletsByClient: Map<string, number>;
  bitrixTaskCountByClient: Map<string, number>;
  childHoldingLinkCountByClient: Map<string, number>;
};

export type ExcludedArchiveDependencySample = {
  guidClient: string;
  activeAccessGrantCount: number | null;
  linkedEmployeeAccountCount: number | null;
  confirmedOutletCount: number | null;
  bitrixTaskCount: number | null;
  childHoldingLinkCount: number | null;
  unavailableDimensions: DependencyDimension[];
};

const MAX_SAMPLES = 20;

async function columnExists(
  client: PoolClient,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS exists
    `,
    [tableName, columnName],
  );
  return result.rows[0]?.exists === true;
}

async function tableExists(client: PoolClient, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists
    `,
    [tableName],
  );
  return result.rows[0]?.exists === true;
}

export async function checkBaselineReplacementMigrationReadiness(
  client: PoolClient,
): Promise<MigrationReadiness> {
  const missing: MigrationRequirement[] = [];

  if (!(await columnExists(client, "onec_client_import_runs", "verification_fingerprint"))) {
    missing.push({
      id: "027",
      description: "onec_client_import_runs.verification_fingerprint",
    });
  }
  if (!(await columnExists(client, "onec_clients", "holding_link_state"))) {
    missing.push({
      id: "028",
      description: "onec_clients.holding_link_state / manager_roster_state",
    });
  }
  if (!(await columnExists(client, "onec_clients", "manager_roster_state"))) {
    missing.push({
      id: "028",
      description: "onec_clients.manager_roster_state",
    });
  }
  if (!(await tableExists(client, "onec_clients"))) {
    missing.push({
      id: "002",
      description: "onec_clients",
    });
  }
  if (!(await columnExists(client, "onec_clients", "baseline_status"))) {
    missing.push({
      id: "029",
      description: "onec_clients.baseline_status",
    });
  }
  if (!(await tableExists(client, "onec_baseline_replacement_runs"))) {
    missing.push({
      id: "029",
      description: "onec_baseline_replacement_runs",
    });
  }
  if (!(await tableExists(client, "onec_client_quarantine_records"))) {
    missing.push({
      id: "029",
      description: "onec_client_quarantine_records",
    });
  }
  if (!(await tableExists(client, "onec_retail_outlets"))) {
    missing.push({
      id: "026",
      description: "onec_retail_outlets (required for confirmed outlet dependency counts)",
    });
  }
  if (!(await columnExists(client, "onec_clients", "guid_holding_pending"))) {
    missing.push({
      id: "028",
      description: "onec_clients.guid_holding_pending",
    });
  }
  if (!(await tableExists(client, "onec_extended_contract_confirmations"))) {
    missing.push({
      id: "029",
      description: "onec_extended_contract_confirmations",
    });
  }

  return { ready: missing.length === 0, missing };
}

function mapCountRows(rows: Array<{ key: string; count: string }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.key.toLowerCase(), Number(row.count));
  }
  return map;
}

export async function loadArchiveDependencyContext(
  client: PoolClient,
): Promise<ArchiveDependencyContext> {
  const unavailableDimensions: DependencyDimension[] = [];
  const activeAccessGrantCountByClient = new Map<string, number>();
  const linkedEmployeeAccountCountByClient = new Map<string, number>();
  const confirmedOutletsByClient = new Map<string, number>();
  const bitrixTaskCountByClient = new Map<string, number>();
  const childHoldingLinkCountByClient = new Map<string, number>();

  try {
    const accessGrants = await client.query<{ object_id: string; count: string }>(
      `
        SELECT object_id::text, COUNT(*)::text AS count
        FROM access_grants
        WHERE grant_type = 'client'
          AND revoked_at IS NULL
        GROUP BY object_id
      `,
    );
    for (const [key, value] of mapCountRows(
      accessGrants.rows.map((row) => ({ key: row.object_id, count: row.count })),
    )) {
      activeAccessGrantCountByClient.set(key, value);
    }
  } catch {
    unavailableDimensions.push("active_access_grants");
  }

  try {
    const linkedAccounts = await client.query<{ guid_client: string; count: string }>(
      `
        SELECT oc.guid_client::text, COUNT(DISTINCT uo.user_id)::text AS count
        FROM onec_clients oc
        JOIN user_onec_employee_links uo
          ON uo.employee_id = oc.guid_manager
         AND uo.revoked_at IS NULL
        GROUP BY oc.guid_client
      `,
    );
    for (const [key, value] of mapCountRows(
      linkedAccounts.rows.map((row) => ({ key: row.guid_client, count: row.count })),
    )) {
      linkedEmployeeAccountCountByClient.set(key, value);
    }
  } catch {
    unavailableDimensions.push("linked_employee_accounts");
  }

  try {
    const outlets = await client.query<{ guid_client: string; count: string }>(
      `
        SELECT guid_client::text, COUNT(*)::text AS count
        FROM onec_retail_outlets
        GROUP BY guid_client
      `,
    );
    for (const [key, value] of mapCountRows(
      outlets.rows.map((row) => ({ key: row.guid_client, count: row.count })),
    )) {
      confirmedOutletsByClient.set(key, value);
    }
  } catch {
    unavailableDimensions.push("confirmed_outlets");
  }

  try {
    const bitrixTasks = await client.query<{ card_guid: string; count: string }>(
      `
        SELECT cco.card_guid::text, COUNT(DISTINCT tb.task_id)::text AS count
        FROM bitrix24_client_card_objects cco
        JOIN bitrix24_task_bindings tb
          ON tb.object_type = cco.object_type
         AND tb.object_guid = cco.object_guid
         AND tb.binding_status = 'confirmed'
        GROUP BY cco.card_guid
      `,
    );
    for (const [key, value] of mapCountRows(
      bitrixTasks.rows.map((row) => ({ key: row.card_guid, count: row.count })),
    )) {
      bitrixTaskCountByClient.set(key, value);
    }
  } catch {
    unavailableDimensions.push("confirmed_bitrix_tasks");
  }

  try {
    const childLinks = await client.query<{ guid_holding: string; count: string }>(
      `
        SELECT guid_holding::text, COUNT(*)::text AS count
        FROM onec_clients
        WHERE guid_holding IS NOT NULL
        GROUP BY guid_holding
      `,
    );
    for (const [key, value] of mapCountRows(
      childLinks.rows.map((row) => ({ key: row.guid_holding, count: row.count })),
    )) {
      childHoldingLinkCountByClient.set(key, value);
    }
  } catch {
    unavailableDimensions.push("child_holding_links");
  }

  const availability: ArchiveDependencyContext["availability"] =
    unavailableDimensions.length === 0
      ? "loaded"
      : unavailableDimensions.length === 5
        ? "unavailable"
        : "partial";

  return {
    availability,
    unavailableDimensions,
    activeAccessGrantCountByClient,
    linkedEmployeeAccountCountByClient,
    confirmedOutletsByClient,
    bitrixTaskCountByClient,
    childHoldingLinkCountByClient,
  };
}

function countOrNull(
  map: Map<string, number>,
  guid: string,
  dimension: DependencyDimension,
  unavailable: Set<DependencyDimension>,
): number | null {
  if (unavailable.has(dimension)) {
    return null;
  }
  return map.get(guid.toLowerCase()) ?? 0;
}

export function buildExcludedArchiveDependencyReport(input: {
  guidsToArchive: string[];
  dependencyContext: ArchiveDependencyContext;
}): {
  availability: ArchiveDependencyContext["availability"];
  unavailableDimensions: DependencyDimension[];
  count: number | null;
  samples: ExcludedArchiveDependencySample[];
  truncated: boolean;
  anyUnknownDependency: boolean;
} {
  const unavailable = new Set(input.dependencyContext.unavailableDimensions);
  const loaded = input.dependencyContext.availability === "loaded";
  const samples: ExcludedArchiveDependencySample[] = [];
  let anyUnknownDependency = unavailable.size > 0;

  for (const guid of input.guidsToArchive) {
    const sample: ExcludedArchiveDependencySample = {
      guidClient: guid,
      activeAccessGrantCount: countOrNull(
        input.dependencyContext.activeAccessGrantCountByClient,
        guid,
        "active_access_grants",
        unavailable,
      ),
      linkedEmployeeAccountCount: countOrNull(
        input.dependencyContext.linkedEmployeeAccountCountByClient,
        guid,
        "linked_employee_accounts",
        unavailable,
      ),
      confirmedOutletCount: countOrNull(
        input.dependencyContext.confirmedOutletsByClient,
        guid,
        "confirmed_outlets",
        unavailable,
      ),
      bitrixTaskCount: countOrNull(
        input.dependencyContext.bitrixTaskCountByClient,
        guid,
        "confirmed_bitrix_tasks",
        unavailable,
      ),
      childHoldingLinkCount: countOrNull(
        input.dependencyContext.childHoldingLinkCountByClient,
        guid,
        "child_holding_links",
        unavailable,
      ),
      unavailableDimensions: [...unavailable],
    };
    if (samples.length < MAX_SAMPLES) {
      samples.push(sample);
    }
  }

  return {
    availability: input.dependencyContext.availability,
    unavailableDimensions: input.dependencyContext.unavailableDimensions,
    count: loaded ? input.guidsToArchive.length : null,
    samples,
    truncated: loaded && input.guidsToArchive.length > samples.length,
    anyUnknownDependency,
  };
}
