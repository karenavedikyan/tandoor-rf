import type { ClientsEntityMode, ClientsListQuery } from "./query";

export type SortDirection = "asc" | "desc";

export type ClientSortField =
  | "name"
  | "holding"
  | "manager"
  | "address"
  | "outletsCount"
  | "team";

export type OutletSortField =
  | "clientName"
  | "outlet"
  | "guidStore"
  | "address"
  | "status"
  | "manager"
  | "holding";

const CLIENT_SORT_SQL: Record<ClientSortField, string> = {
  name: "onec_clients.name_client",
  holding: "onec_clients.name_holding",
  manager: "onec_clients.name_manager",
  address: "onec_clients.address",
  outletsCount: "outlets_count::int",
  team: "team_ctx.rop_name",
};

const OUTLET_SORT_SQL: Record<OutletSortField, string> = {
  clientName: "oc.name_client",
  outlet: "ro.guid_store",
  guidStore: "ro.guid_store",
  address: "store_address",
  status: "ro.is_closed",
  manager: "oc.name_manager",
  holding: "oc.name_holding",
};

const CLIENT_SORT_FIELDS = new Set<string>(Object.keys(CLIENT_SORT_SQL));
const OUTLET_SORT_FIELDS = new Set<string>(Object.keys(OUTLET_SORT_SQL));

export function parseSortDirection(value: unknown): SortDirection | null {
  if (value === undefined || value === null || value === "") {
    return "asc";
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "asc" || normalized === "desc") {
    return normalized;
  }
  return null;
}

export function parseSortBy(
  entity: ClientsEntityMode,
  value: unknown,
): ClientSortField | OutletSortField | null {
  if (value === undefined || value === null || value === "") {
    return entity === "outlets" ? "clientName" : "name";
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (entity === "outlets") {
    return OUTLET_SORT_FIELDS.has(normalized) ? (normalized as OutletSortField) : null;
  }
  return CLIENT_SORT_FIELDS.has(normalized) ? (normalized as ClientSortField) : null;
}

export function buildClientsOrderBy(
  input: ClientsListQuery,
  options: { includeTeamSort: boolean; includeOutletsCount: boolean },
): string {
  const direction = input.sortDir === "desc" ? "DESC" : "ASC";
  if (input.entity === "outlets") {
    const field = (input.sortBy as OutletSortField) ?? "clientName";
    if (field === "address") {
      return `ORDER BY COALESCE(store_address, '') ${direction}, oc.name_client ASC, ro.guid_store ASC`;
    }
    const column = OUTLET_SORT_SQL[field];
    return `ORDER BY ${column} ${direction}, oc.name_client ASC, ro.guid_store ASC`;
  }

  const field = (input.sortBy as ClientSortField) ?? "name";
  if (field === "team" && !options.includeTeamSort) {
    return `ORDER BY onec_clients.name_client ASC, onec_clients.guid_client ASC`;
  }
  if (field === "outletsCount" && !options.includeOutletsCount) {
    return `ORDER BY onec_clients.name_client ASC, onec_clients.guid_client ASC`;
  }
  const column = CLIENT_SORT_SQL[field];
  return `ORDER BY ${column} ${direction} NULLS LAST, onec_clients.guid_client ASC`;
}
