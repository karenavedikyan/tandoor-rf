import { mergeSqlFilters } from "../access/combine-filters";
import { escapeIlikePattern } from "./phone";
import { clientHasOutletMatchingSql } from "./client-outlet-match";
import type { ClientsListQuery, SqlFilter } from "./query";

const ALLOWED_FILLED_FIELDS = new Set([
  "address",
  "telephone",
  "holding",
  "storeAddress",
  "deliveryAddress",
  "routeDirection",
  "tandoorClub",
  "warehouse",
]);

function buildOutletMatchFilter(query: ClientsListQuery): SqlFilter | null {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.storeAddressContains) {
    params.push(`%${escapeIlikePattern(query.storeAddressContains)}%`);
    conditions.push(
      `NULLIF(BTRIM(outlet.elem->'address'->>'storeAddress'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.routeDirection) {
    params.push(`%${escapeIlikePattern(query.routeDirection)}%`);
    conditions.push(
      `NULLIF(BTRIM(outlet.elem->'address'->>'routeDirection'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.warehouseFilter === "yes") {
    conditions.push(`outlet.elem->'warehouse' = 'true'::jsonb`);
  } else if (query.warehouseFilter === "no") {
    conditions.push(`outlet.elem->'warehouse' = 'false'::jsonb`);
  } else if (query.warehouseFilter === "unknown") {
    conditions.push(`(outlet.elem->'warehouse' IS NULL OR outlet.elem->'warehouse' = 'null'::jsonb)`);
  }
  if (query.tandoorClub) {
    params.push(`%${escapeIlikePattern(query.tandoorClub)}%`);
    conditions.push(
      `NULLIF(BTRIM(outlet.elem->'additional'->>'statusTandoorClub'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.outletStatus === "open") {
    conditions.push(`
      (
        COALESCE(outlet.elem->>'closureStatus', '') = 'open'
        OR (
          COALESCE(outlet.elem->>'closureStatus', '') = ''
          AND COALESCE(outlet.elem->>'closed', 'false') <> 'true'
        )
      )
    `);
  } else if (query.outletStatus === "closed") {
    conditions.push(`
      (
        outlet.elem->>'closureStatus' = 'closed'
        OR outlet.elem->>'closed' = 'true'
      )
    `);
  }

  if (conditions.length === 0) {
    return null;
  }

  return {
    whereSql: `WHERE ${clientHasOutletMatchingSql(conditions)}`,
    params,
  };
}

/** Client entity: outlet-derived filters must match one outlet row. */
export function applyClientEntityOutletFieldFilters(
  userFilter: SqlFilter,
  query: ClientsListQuery,
): SqlFilter {
  const outletMatch = buildOutletMatchFilter(query);
  if (!outletMatch) {
    return userFilter;
  }
  const clause = outletMatch.whereSql.replace(/^WHERE\s+/, "");
  return mergeSqlFilters(userFilter, [clause], outletMatch.params);
}

export function applyFilledEmptyFieldFilters(userFilter: SqlFilter, query: ClientsListQuery): SqlFilter {
  let filter = userFilter;
  const filled = query.filled?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const empty = query.empty?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

  for (const field of filled) {
    if (!ALLOWED_FILLED_FIELDS.has(field)) {
      continue;
    }
    if (field === "address") {
      filter = mergeSqlFilters(filter, [`NULLIF(BTRIM(onec_clients.address), '') IS NOT NULL`], []);
    } else if (field === "telephone") {
      filter = mergeSqlFilters(
        filter,
        [
          `EXISTS (SELECT 1 FROM jsonb_array_elements_text(onec_clients.telephone) p(v) WHERE BTRIM(p.v) <> '')`,
        ],
        [],
      );
    } else if (field === "holding") {
      filter = mergeSqlFilters(filter, [`NULLIF(BTRIM(onec_clients.guid_holding::text), '') IS NOT NULL`], []);
    } else {
      const map: Record<string, string> = {
        storeAddress: `NULLIF(BTRIM(outlet.elem->'address'->>'storeAddress'), '') IS NOT NULL`,
        deliveryAddress: `NULLIF(BTRIM(outlet.elem->'address'->>'deliveryAddress'), '') IS NOT NULL`,
        routeDirection: `NULLIF(BTRIM(outlet.elem->'address'->>'routeDirection'), '') IS NOT NULL`,
        tandoorClub: `NULLIF(BTRIM(outlet.elem->'additional'->>'statusTandoorClub'), '') IS NOT NULL`,
        warehouse: `outlet.elem ? 'warehouse' AND outlet.elem->'warehouse' IS NOT NULL AND outlet.elem->'warehouse' <> 'null'::jsonb`,
      };
      const expr = map[field];
      if (expr) {
        filter = mergeSqlFilters(filter, [clientHasOutletMatchingSql([expr])], []);
      }
    }
  }

  for (const field of empty) {
    if (!ALLOWED_FILLED_FIELDS.has(field)) {
      continue;
    }
    if (field === "address") {
      filter = mergeSqlFilters(filter, [`NULLIF(BTRIM(onec_clients.address), '') IS NULL`], []);
    } else if (field === "telephone") {
      filter = mergeSqlFilters(
        filter,
        [
          `NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(onec_clients.telephone) p(v) WHERE BTRIM(p.v) <> '')`,
        ],
        [],
      );
    } else if (field === "holding") {
      filter = mergeSqlFilters(filter, [`NULLIF(BTRIM(onec_clients.guid_holding::text), '') IS NULL`], []);
    }
  }

  return filter;
}
