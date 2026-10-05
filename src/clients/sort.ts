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
  | "holding"
  | "regional"
  | "warehouse"
  | "tandoorClub";

const CLIENT_SORT_SQL: Record<Exclude<ClientSortField, "outletsCount">, string> = {
  name: "onec_clients.name_client",
  holding: "onec_clients.name_holding",
  manager: "onec_clients.name_manager",
  address: "onec_clients.address",
  team: "team_ctx.rop_name",
};

const OUTLET_SORT_SQL: Record<
  Exclude<OutletSortField, "address" | "regional" | "warehouse" | "tandoorClub">,
  string
> = {
  clientName: "oc.name_client",
  outlet: "ro.guid_store",
  guidStore: "ro.guid_store",
  status: "ro.is_closed",
  manager: "oc.name_manager",
  holding: "oc.name_holding",
};

const CLIENT_SORT_FIELDS = new Set<string>(["name", "holding", "manager", "address", "outletsCount", "team"]);
const OUTLET_SORT_FIELDS = new Set<string>([
  "clientName",
  "outlet",
  "guidStore",
  "address",
  "status",
  "manager",
  "holding",
  "regional",
  "warehouse",
  "tandoorClub",
]);

export type ClientsOrderByOptions = {
  includeTeamSort: boolean;
  outletsCountExpr?: string;
  outletStoreAddressExpr?: string;
  outletRegionalNameExpr?: string;
  outletWarehouseExpr?: string;
  outletTandoorClubExpr?: string;
};

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

export function buildClientsOrderBy(input: ClientsListQuery, options: ClientsOrderByOptions): string {
  const direction = input.sortDir === "desc" ? "DESC" : "ASC";
  if (input.entity === "outlets") {
    const field = (input.sortBy as OutletSortField) ?? "clientName";
    if (field === "address" && options.outletStoreAddressExpr) {
      return `ORDER BY COALESCE(${options.outletStoreAddressExpr}, '') ${direction}, oc.name_client ASC, ro.guid_store ASC`;
    }
    if (field === "regional" && options.outletRegionalNameExpr) {
      return `ORDER BY COALESCE(${options.outletRegionalNameExpr}, '') ${direction}, oc.name_client ASC, ro.guid_store ASC`;
    }
    if (field === "warehouse" && options.outletWarehouseExpr) {
      return `ORDER BY ${options.outletWarehouseExpr} ${direction} NULLS LAST, oc.name_client ASC, ro.guid_store ASC`;
    }
    if (field === "tandoorClub" && options.outletTandoorClubExpr) {
      return `ORDER BY COALESCE(${options.outletTandoorClubExpr}, '') ${direction}, oc.name_client ASC, ro.guid_store ASC`;
    }
    const column = OUTLET_SORT_SQL[field as keyof typeof OUTLET_SORT_SQL];
    if (!column) {
      return `ORDER BY oc.name_client ASC, ro.guid_store ASC`;
    }
    return `ORDER BY ${column} ${direction}, oc.name_client ASC, ro.guid_store ASC`;
  }

  const field = (input.sortBy as ClientSortField) ?? "name";
  if (field === "team" && !options.includeTeamSort) {
    return `ORDER BY onec_clients.name_client ASC, onec_clients.guid_client ASC`;
  }
  if (field === "outletsCount") {
    if (!options.outletsCountExpr) {
      return `ORDER BY onec_clients.name_client ASC, onec_clients.guid_client ASC`;
    }
    return `ORDER BY ${options.outletsCountExpr} ${direction} NULLS LAST, onec_clients.guid_client ASC`;
  }
  const column = CLIENT_SORT_SQL[field as keyof typeof CLIENT_SORT_SQL];
  return `ORDER BY ${column} ${direction} NULLS LAST, onec_clients.guid_client ASC`;
}

/** Maps sort fields when switching list entity mode in the UI. */
export function mapSortFieldForEntity(
  fromEntity: ClientsEntityMode,
  toEntity: ClientsEntityMode,
  sortBy: string,
): string | null {
  if (!sortBy || fromEntity === toEntity) {
    return sortBy || null;
  }
  if (fromEntity === "clients" && toEntity === "outlets") {
    const map: Record<string, string> = {
      name: "clientName",
      holding: "holding",
      manager: "manager",
      address: "address",
    };
    return map[sortBy] ?? null;
  }
  if (fromEntity === "outlets" && toEntity === "clients") {
    const map: Record<string, string> = {
      clientName: "name",
      holding: "holding",
      manager: "manager",
      address: "address",
    };
    return map[sortBy] ?? null;
  }
  return null;
}

export function defaultSortFieldForEntity(entity: ClientsEntityMode): ClientSortField | OutletSortField {
  return entity === "outlets" ? "clientName" : "name";
}
