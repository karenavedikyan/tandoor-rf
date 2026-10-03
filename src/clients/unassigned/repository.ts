import { query } from "../../db/pool";
import {
  ACTIVE_BASELINE_CLIENT_SQL,
  ACTIVE_BASELINE_OC_SQL,
} from "../../onec-clients/baseline-active-scope";
import { shortUuidLabel } from "../uuid-param";
import type { UnassignedCategory } from "../review/constants";
import { UNASSIGNED_CATEGORY_LABELS } from "../review/constants";

export type UnassignedEmployeeSummary = {
  employeeGuid: string;
  name: string;
  shortId: string;
  clientCount: number;
  category: UnassignedCategory;
  categoryLabel: string;
  note?: string;
};

export type UnassignedSummaryResponse = {
  limitationNote: string;
  categories: Array<{
    category: UnassignedCategory;
    label: string;
    uniqueClientCount: number;
    employeeCount: number;
  }>;
  employees: UnassignedEmployeeSummary[];
};

const ROSTER_IN_OPT_SQL = `COALESCE(oc.manager_roster_state, 'in_wholesale_roster') = 'in_wholesale_roster'`;

async function loadDistinctManagersFromClients(): Promise<
  Map<string, { name: string; clientCount: number; rosterState: string }>
> {
  const result = await query<{
    guid_manager: string;
    name_manager: string;
    client_count: string;
    roster_state: string;
  }>(
    `
      SELECT
        oc.guid_manager::text,
        MAX(oc.name_manager) AS name_manager,
        COUNT(DISTINCT oc.guid_client)::text AS client_count,
        MAX(COALESCE(oc.manager_roster_state, 'in_wholesale_roster')) AS roster_state
      FROM onec_clients oc
      WHERE ${ACTIVE_BASELINE_OC_SQL.trim()}
      GROUP BY oc.guid_manager
    `,
  );
  const map = new Map<string, { name: string; clientCount: number; rosterState: string }>();
  for (const row of result.rows) {
    map.set(row.guid_manager.toLowerCase(), {
      name: row.name_manager,
      clientCount: Number(row.client_count),
      rosterState: row.roster_state,
    });
  }
  return map;
}

async function loadLinkedEmployeeGuids(): Promise<Set<string>> {
  const result = await query<{ employee_id: string }>(
    `
      SELECT employee_id::text
      FROM user_onec_employee_links
      WHERE revoked_at IS NULL
    `,
  );
  return new Set(result.rows.map((r) => r.employee_id.toLowerCase()));
}

async function loadLinkedEmployeesWithoutTeam(): Promise<Set<string>> {
  const result = await query<{ employee_id: string }>(
    `
      SELECT uoel.employee_id::text
      FROM user_onec_employee_links uoel
      JOIN users u ON u.id = uoel.user_id
      WHERE uoel.revoked_at IS NULL
        AND u.status = 'active'
        AND u.role IN ('manager', 'rop')
        AND NOT EXISTS (
          SELECT 1
          FROM rop_team_members rtm
          WHERE rtm.member_user_id = uoel.user_id
            AND rtm.revoked_at IS NULL
        )
    `,
  );
  return new Set(result.rows.map((r) => r.employee_id.toLowerCase()));
}

async function loadEmployeeLinkConflictGuids(): Promise<Set<string>> {
  const result = await query<{ employee_id: string }>(
    `
      SELECT employee_id::text
      FROM user_onec_employee_links
      WHERE revoked_at IS NULL
      GROUP BY employee_id
      HAVING COUNT(DISTINCT user_id) > 1
    `,
  );
  return new Set(result.rows.map((r) => r.employee_id.toLowerCase()));
}

function categorizeEmployee(
  employeeGuid: string,
  info: { name: string; clientCount: number; rosterState: string },
  linkedGuids: Set<string>,
  linkedWithoutTeam: Set<string>,
  conflictGuids: Set<string>,
): UnassignedCategory | null {
  if (info.rosterState === "outside_wholesale_roster") {
    return "manager_outside_opt_roster";
  }
  if (info.rosterState === "roster_not_loaded" || conflictGuids.has(employeeGuid)) {
    return "unconfirmed_responsible";
  }
  if (!linkedGuids.has(employeeGuid)) {
    return "opt_without_account_link";
  }
  if (linkedWithoutTeam.has(employeeGuid)) {
    return "opt_without_rop_team";
  }
  return null;
}

export async function buildUnassignedSummary(options?: {
  category?: UnassignedCategory;
}): Promise<UnassignedSummaryResponse> {
  const managers = await loadDistinctManagersFromClients();
  const linkedGuids = await loadLinkedEmployeeGuids();
  const linkedWithoutTeam = await loadLinkedEmployeesWithoutTeam();
  const conflictGuids = await loadEmployeeLinkConflictGuids();

  const byCategory = new Map<UnassignedCategory, UnassignedEmployeeSummary[]>();
  const uniqueClientsByCategory = new Map<UnassignedCategory, Set<string>>();

  for (const [employeeGuid, info] of managers) {
    const category = categorizeEmployee(
      employeeGuid,
      info,
      linkedGuids,
      linkedWithoutTeam,
      conflictGuids,
    );
    if (!category) {
      continue;
    }
    const entry: UnassignedEmployeeSummary = {
      employeeGuid,
      name: info.name,
      shortId: shortUuidLabel(employeeGuid),
      clientCount: info.clientCount,
      category,
      categoryLabel: UNASSIGNED_CATEGORY_LABELS[category],
      ...(category === "opt_without_account_link"
        ? {
            note: "Справочник сотрудников ОПТ в БД недоступен; показаны только ответственные из импортированных клиентов.",
          }
        : {}),
    };
    const list = byCategory.get(category) ?? [];
    list.push(entry);
    byCategory.set(category, list);

    const clientRows = await query<{ guid_client: string }>(
      `
        SELECT guid_client::text
        FROM onec_clients oc
        WHERE oc.guid_manager = $1::uuid
          AND ${ACTIVE_BASELINE_OC_SQL.trim()}
      `,
      [employeeGuid],
    );
    const set = uniqueClientsByCategory.get(category) ?? new Set<string>();
    for (const row of clientRows.rows) {
      set.add(row.guid_client);
    }
    uniqueClientsByCategory.set(category, set);
  }

  const categories = (Object.keys(UNASSIGNED_CATEGORY_LABELS) as UnassignedCategory[]).map(
    (category) => ({
      category,
      label: UNASSIGNED_CATEGORY_LABELS[category],
      uniqueClientCount: uniqueClientsByCategory.get(category)?.size ?? 0,
      employeeCount: byCategory.get(category)?.length ?? 0,
    }),
  );

  let employees: UnassignedEmployeeSummary[] = [];
  for (const list of byCategory.values()) {
    employees.push(...list);
  }
  employees.sort((a, b) => a.name.localeCompare(b.name, "ru") || a.employeeGuid.localeCompare(b.employeeGuid));

  if (options?.category) {
    employees = employees.filter((e) => e.category === options.category);
  }

  return {
    limitationNote:
      "Полноценный справочник сотрудников ОПТ в БД недоступен. Категории построены только по ответственным из импортированных клиентов; отсутствие в roster не означает увольнение.",
    categories,
    employees,
  };
}

export function buildUnassignedManagerFilter(
  employeeGuid: string,
): { whereSql: string; params: unknown[] } {
  return {
    whereSql: "WHERE guid_manager = $1::uuid",
    params: [employeeGuid.toLowerCase()],
  };
}

export function buildUnassignedCategoryFilter(
  category: UnassignedCategory,
  employeeGuids: string[],
): { whereSql: string; params: unknown[] } {
  if (employeeGuids.length === 0) {
    return { whereSql: "WHERE FALSE", params: [] };
  }
  return {
    whereSql: `WHERE guid_manager = ANY($1::uuid[])`,
    params: [employeeGuids],
  };
}
