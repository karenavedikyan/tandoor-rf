import { escapeIlikePattern } from "../phone";
import type { ClientsListQuery, SqlFilter } from "../query";
import {
  outletSnapshotSubquery,
  outletStoreAddressSql,
  outletsJsonArraySql,
} from "./scope-sql";

export type OutletWarehouseFilter = "all" | "yes" | "no" | "unknown";
export type OutletStatusFilter = "all" | "open" | "closed";

export function outletWarehouseValueSql(snapshotExpr: string): string {
  return `
    CASE
      WHEN ${snapshotExpr} IS NULL THEN 'unknown'
      WHEN ${snapshotExpr}->'warehouse' = 'true'::jsonb THEN 'yes'
      WHEN ${snapshotExpr}->'warehouse' = 'false'::jsonb THEN 'no'
      ELSE 'unknown'
    END
  `;
}

export function outletRegionalGuidSql(snapshotExpr: string): string {
  return `NULLIF(BTRIM(${snapshotExpr}->'managers'->'regionalManager'->>'guid'), '')`;
}

export function outletRegionalNameSql(snapshotExpr: string): string {
  return `NULLIF(BTRIM(${snapshotExpr}->'managers'->'regionalManager'->>'name'), '')`;
}

export function outletTandoorClubSql(snapshotExpr: string): string {
  return `NULLIF(BTRIM(${snapshotExpr}->'additional'->>'statusTandoorClub'), '')`;
}

export function buildOutletsListFilter(query: ClientsListQuery): SqlFilter {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const snapshotExpr = outletSnapshotSubquery("ro", "oc");

  if (query.outletStatus === "open") {
    clauses.push("(ro.is_closed IS NOT TRUE)");
  } else if (query.outletStatus === "closed") {
    clauses.push("(ro.is_closed IS TRUE)");
  }

  if (query.warehouseFilter === "yes") {
    clauses.push(`(${snapshotExpr}->'warehouse' = 'true'::jsonb)`);
  } else if (query.warehouseFilter === "no") {
    clauses.push(`(${snapshotExpr}->'warehouse' = 'false'::jsonb)`);
  } else if (query.warehouseFilter === "unknown") {
    clauses.push(`
      (
        ${snapshotExpr} IS NULL
        OR NOT (${snapshotExpr} ? 'warehouse')
        OR ${snapshotExpr}->'warehouse' = 'null'::jsonb
      )
    `);
  }

  if (query.regionalManagerId) {
    params.push(query.regionalManagerId);
    clauses.push(`lower(${outletRegionalGuidSql(snapshotExpr)}) = lower($${params.length}::text)`);
  }

  if (query.tandoorClub && query.tandoorClub.trim().length > 0) {
    params.push(`%${escapeIlikePattern(query.tandoorClub.trim())}%`);
    clauses.push(`${outletTandoorClubSql(snapshotExpr)} ILIKE $${params.length} ESCAPE '\\'`);
  }

  if (query.q.length > 0) {
    params.push(`%${escapeIlikePattern(query.q)}%`);
    const textParam = `$${params.length}`;
    clauses.push(`
      (
        oc.name_client ILIKE ${textParam} ESCAPE '\\'
        OR oc.name_holding ILIKE ${textParam} ESCAPE '\\'
        OR oc.name_manager ILIKE ${textParam} ESCAPE '\\'
        OR COALESCE(${outletStoreAddressSql("ro", "oc")}, '') ILIKE ${textParam} ESCAPE '\\'
        OR COALESCE(${outletRegionalNameSql(snapshotExpr)}, '') ILIKE ${textParam} ESCAPE '\\'
        OR ro.guid_store::text ILIKE ${textParam} ESCAPE '\\'
      )
    `);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { whereSql, params };
}

export function outletSortExpressions(): {
  storeAddress: string;
  regionalName: string;
  warehouseSortKey: string;
  tandoorClub: string;
} {
  const snapshotExpr = outletSnapshotSubquery("ro", "oc");
  return {
    storeAddress: outletStoreAddressSql("ro", "oc"),
    regionalName: outletRegionalNameSql(snapshotExpr),
    warehouseSortKey: `
      CASE
        WHEN ${snapshotExpr}->'warehouse' = 'true'::jsonb THEN 2
        WHEN ${snapshotExpr}->'warehouse' = 'false'::jsonb THEN 1
        ELSE 0
      END
    `,
    tandoorClub: outletTandoorClubSql(snapshotExpr),
  };
}

export { outletsJsonArraySql, outletStoreAddressSql, outletSnapshotSubquery };
