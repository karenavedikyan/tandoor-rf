import {
  bonusTandoorClubEmptySql,
  bonusTandoorClubFilledSql,
  bonusTandoorClubSearchSql,
} from "../bonus-tandoor-club";
import { escapeIlikePattern } from "../phone";
import { OUTLET_FILLED_EMPTY_FIELDS, parseFilledEmptyFieldList } from "../field-filter-registry";
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

export function outletManagerNameSql(snapshotExpr: string): string {
  return `NULLIF(BTRIM(${snapshotExpr}->'managers'->'manager'->>'name'), '')`;
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

  if (query.tandoorClub && query.tandoorClub.trim().length > 0) {
    params.push(`%${escapeIlikePattern(query.tandoorClub.trim())}%`);
    clauses.push(`${outletTandoorClubSql(snapshotExpr)} ILIKE $${params.length} ESCAPE '\\'`);
  }

  if (query.bonusTandoorClub && query.bonusTandoorClub.trim().length > 0) {
    params.push(`%${escapeIlikePattern(query.bonusTandoorClub.trim())}%`);
    clauses.push(
      bonusTandoorClubSearchSql(`${snapshotExpr}->'additional'`, `$${params.length}`),
    );
  }

  if (query.storeAddressContains) {
    params.push(`%${escapeIlikePattern(query.storeAddressContains)}%`);
    clauses.push(
      `NULLIF(BTRIM(${snapshotExpr}->'address'->>'storeAddress'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.routeDirection) {
    params.push(`%${escapeIlikePattern(query.routeDirection)}%`);
    clauses.push(
      `NULLIF(BTRIM(${snapshotExpr}->'address'->>'routeDirection'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.storePhoneContains) {
    params.push(`%${escapeIlikePattern(query.storePhoneContains)}%`);
    clauses.push(
      `NULLIF(BTRIM(${snapshotExpr}->'contacts'->>'storePhone'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.accountantPhoneContains) {
    params.push(`%${escapeIlikePattern(query.accountantPhoneContains)}%`);
    clauses.push(
      `NULLIF(BTRIM(${snapshotExpr}->'contacts'->>'accountantPhone'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.accountantEmailContains) {
    params.push(`%${escapeIlikePattern(query.accountantEmailContains)}%`);
    clauses.push(
      `NULLIF(BTRIM(${snapshotExpr}->'contacts'->>'accountantEmail'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.loadingTime) {
    params.push(`%${escapeIlikePattern(query.loadingTime)}%`);
    clauses.push(
      `NULLIF(BTRIM(${snapshotExpr}->'loading'->>'loadingTime'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.loadingSchedule === "yes") {
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM jsonb_each(${snapshotExpr}->'loading') loading_item(key, value)
        WHERE loading_item.key LIKE 'loadingOn%'
          AND loading_item.value = 'true'::jsonb
      )
    `);
  } else if (query.loadingSchedule === "no") {
    clauses.push(`
      NOT EXISTS (
        SELECT 1
        FROM jsonb_each(${snapshotExpr}->'loading') loading_item(key, value)
        WHERE loading_item.key LIKE 'loadingOn%'
          AND loading_item.value = 'true'::jsonb
      )
    `);
  }

  for (const field of parseFilledEmptyFieldList(query.filled)) {
    if (!OUTLET_FILLED_EMPTY_FIELDS.has(field)) {
      continue;
    }
    clauses.push(outletFilledExpr(snapshotExpr, field));
  }
  for (const field of parseFilledEmptyFieldList(query.empty)) {
    if (!OUTLET_FILLED_EMPTY_FIELDS.has(field)) {
      continue;
    }
    clauses.push(outletEmptyExpr(snapshotExpr, field));
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

function outletFilledExpr(snapshotExpr: string, field: string): string {
  const map: Record<string, string> = {
    storeAddress: `NULLIF(BTRIM(${snapshotExpr}->'address'->>'storeAddress'), '') IS NOT NULL`,
    deliveryAddress: `NULLIF(BTRIM(${snapshotExpr}->'address'->>'deliveryAddress'), '') IS NOT NULL`,
    routeDirection: `NULLIF(BTRIM(${snapshotExpr}->'address'->>'routeDirection'), '') IS NOT NULL`,
    tandoorClub: `NULLIF(BTRIM(${snapshotExpr}->'additional'->>'statusTandoorClub'), '') IS NOT NULL`,
    bonusTandoorClub: bonusTandoorClubFilledSql(`${snapshotExpr}->'additional'`),
    warehouse: `${snapshotExpr} ? 'warehouse' AND ${snapshotExpr}->'warehouse' IS NOT NULL AND ${snapshotExpr}->'warehouse' <> 'null'::jsonb`,
    storePhone: `NULLIF(BTRIM(${snapshotExpr}->'contacts'->>'storePhone'), '') IS NOT NULL`,
    accountantPhone: `NULLIF(BTRIM(${snapshotExpr}->'contacts'->>'accountantPhone'), '') IS NOT NULL`,
    accountantEmail: `NULLIF(BTRIM(${snapshotExpr}->'contacts'->>'accountantEmail'), '') IS NOT NULL`,
    loadingTime: `NULLIF(BTRIM(${snapshotExpr}->'loading'->>'loadingTime'), '') IS NOT NULL`,
    loadingSchedule: `
      EXISTS (
        SELECT 1
        FROM jsonb_each(${snapshotExpr}->'loading') loading_item(key, value)
        WHERE loading_item.key LIKE 'loadingOn%'
          AND loading_item.value = 'true'::jsonb
      )
    `,
  };
  return map[field] ?? "TRUE";
}

function outletEmptyExpr(snapshotExpr: string, field: string): string {
  const map: Record<string, string> = {
    storeAddress: `NULLIF(BTRIM(${snapshotExpr}->'address'->>'storeAddress'), '') IS NULL`,
    deliveryAddress: `NULLIF(BTRIM(${snapshotExpr}->'address'->>'deliveryAddress'), '') IS NULL`,
    routeDirection: `NULLIF(BTRIM(${snapshotExpr}->'address'->>'routeDirection'), '') IS NULL`,
    tandoorClub: `NULLIF(BTRIM(${snapshotExpr}->'additional'->>'statusTandoorClub'), '') IS NULL`,
    bonusTandoorClub: bonusTandoorClubEmptySql(`${snapshotExpr}->'additional'`),
    warehouse: `(${snapshotExpr}->'warehouse' IS NULL OR ${snapshotExpr}->'warehouse' = 'null'::jsonb)`,
    storePhone: `NULLIF(BTRIM(${snapshotExpr}->'contacts'->>'storePhone'), '') IS NULL`,
    accountantPhone: `NULLIF(BTRIM(${snapshotExpr}->'contacts'->>'accountantPhone'), '') IS NULL`,
    accountantEmail: `NULLIF(BTRIM(${snapshotExpr}->'contacts'->>'accountantEmail'), '') IS NULL`,
    loadingTime: `NULLIF(BTRIM(${snapshotExpr}->'loading'->>'loadingTime'), '') IS NULL`,
    loadingSchedule: `
      NOT EXISTS (
        SELECT 1
        FROM jsonb_each(${snapshotExpr}->'loading') loading_item(key, value)
        WHERE loading_item.key LIKE 'loadingOn%'
          AND loading_item.value = 'true'::jsonb
      )
    `,
  };
  return map[field] ?? "TRUE";
}

export function outletSortExpressions(): {
  storeAddress: string;
  managerName: string;
  regionalName: string;
  warehouseSortKey: string;
  tandoorClub: string;
} {
  const snapshotExpr = outletSnapshotSubquery("ro", "oc");
  return {
    storeAddress: outletStoreAddressSql("ro", "oc"),
    managerName: outletManagerNameSql(snapshotExpr),
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
