import type { AccessContext } from "../access/types";
import { mergeSqlFilters } from "../access/combine-filters";
import {
  extendedRefPresenceClause,
  guidListMatchClause,
} from "./assignment-filter-modes";
import {
  CLIENT_FILLED_EMPTY_FIELDS,
  OUTLET_FILLED_EMPTY_FIELDS,
  parseFilledEmptyFieldList,
} from "./field-filter-registry";
import {
  outletHardwareGuidSql,
  outletHeadOfSalesGuidSql,
  outletManagerGuidSql,
  outletRegionalGuidSql,
} from "./org/assignment-sql";
import {
  outletElemAccessibleSql,
  resolveOutletElemAccessParams,
  type OutletElemAccessParams,
} from "./outlet-elem-access";
import {
  bonusTandoorClubEmptySql,
  bonusTandoorClubFilledSql,
  bonusTandoorClubSearchSql,
} from "./bonus-tandoor-club";
import { appendLprFilterConditions, lprFilledEmptySql } from "./lpr-fields";
import { escapeIlikePattern } from "./phone";
import type { ClientsListQuery, SqlFilter } from "./query";
import { outletsJsonArraySql } from "./outlets/scope-sql";

const OUTLET_ALIAS = "outlet.elem";

function appendOutletAssignmentConditions(query: ClientsListQuery, conditions: string[], params: unknown[]): void {
  if (query.outletManagerIds && query.outletManagerIds.length > 0 && !query.outletManagerMode) {
    params.push(query.outletManagerIds);
    conditions.push(guidListMatchClause(outletManagerGuidSql(OUTLET_ALIAS), `$${params.length}`));
  } else if (query.outletManagerId && !query.outletManagerMode) {
    params.push(query.outletManagerId);
    conditions.push(`${outletManagerGuidSql(OUTLET_ALIAS)} = lower($${params.length}::text)`);
  }
  if (query.outletManagerMode) {
    conditions.push(
      extendedRefPresenceClause(`${OUTLET_ALIAS}->'managers'->'manager'`, query.outletManagerMode),
    );
  }
  if (query.missingOutletManager) {
    conditions.push(
      extendedRefPresenceClause(`${OUTLET_ALIAS}->'managers'->'manager'`, "unassigned"),
    );
  }

  if (query.outletRegionalManagerIds && query.outletRegionalManagerIds.length > 0 && !query.outletRegionalManagerMode) {
    params.push(query.outletRegionalManagerIds);
    conditions.push(guidListMatchClause(outletRegionalGuidSql(OUTLET_ALIAS), `$${params.length}`));
  } else if (query.outletRegionalManagerId && !query.outletRegionalManagerMode) {
    params.push(query.outletRegionalManagerId);
    conditions.push(`${outletRegionalGuidSql(OUTLET_ALIAS)} = lower($${params.length}::text)`);
  }
  if (query.outletRegionalManagerMode) {
    conditions.push(
      extendedRefPresenceClause(`${OUTLET_ALIAS}->'managers'->'regionalManager'`, query.outletRegionalManagerMode),
    );
  }
  if (query.missingOutletRegional) {
    conditions.push(
      extendedRefPresenceClause(`${OUTLET_ALIAS}->'managers'->'regionalManager'`, "unassigned"),
    );
  }

  if (query.outletHardwareManagerIds && query.outletHardwareManagerIds.length > 0 && !query.outletHardwareManagerMode) {
    params.push(query.outletHardwareManagerIds);
    conditions.push(guidListMatchClause(outletHardwareGuidSql(OUTLET_ALIAS), `$${params.length}`));
  } else if (query.outletHardwareManagerId && !query.outletHardwareManagerMode) {
    params.push(query.outletHardwareManagerId);
    conditions.push(`${outletHardwareGuidSql(OUTLET_ALIAS)} = lower($${params.length}::text)`);
  }
  if (query.outletHardwareManagerMode) {
    conditions.push(
      extendedRefPresenceClause(`${OUTLET_ALIAS}->'managers'->'hardwareManager'`, query.outletHardwareManagerMode),
    );
  }
  if (query.missingOutletHardware) {
    conditions.push(
      extendedRefPresenceClause(`${OUTLET_ALIAS}->'managers'->'hardwareManager'`, "unassigned"),
    );
  }

  if (query.outletRopEmployeeGuid && !query.outletRopEmployeeMode) {
    params.push(query.outletRopEmployeeGuid);
    conditions.push(`${outletHeadOfSalesGuidSql(OUTLET_ALIAS)} = lower($${params.length}::text)`);
  }
  if (query.outletRopEmployeeMode) {
    conditions.push(
      extendedRefPresenceClause(`${OUTLET_ALIAS}->'managers'->'headOfSales'`, query.outletRopEmployeeMode),
    );
  }
  if (query.missingOutletRop) {
    conditions.push(
      extendedRefPresenceClause(`${OUTLET_ALIAS}->'managers'->'headOfSales'`, "unassigned"),
    );
  }
}

function appendOutletFieldConditions(query: ClientsListQuery, conditions: string[], params: unknown[]): void {
  if (query.storeAddressContains) {
    params.push(`%${escapeIlikePattern(query.storeAddressContains)}%`);
    conditions.push(
      `NULLIF(BTRIM(${OUTLET_ALIAS}->'address'->>'storeAddress'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.routeDirection) {
    params.push(`%${escapeIlikePattern(query.routeDirection)}%`);
    conditions.push(
      `NULLIF(BTRIM(${OUTLET_ALIAS}->'address'->>'routeDirection'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.storePhoneContains) {
    params.push(`%${escapeIlikePattern(query.storePhoneContains)}%`);
    conditions.push(
      `NULLIF(BTRIM(${OUTLET_ALIAS}->'contacts'->>'storePhone'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.accountantPhoneContains) {
    params.push(`%${escapeIlikePattern(query.accountantPhoneContains)}%`);
    conditions.push(
      `NULLIF(BTRIM(${OUTLET_ALIAS}->'contacts'->>'accountantPhone'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.accountantEmailContains) {
    params.push(`%${escapeIlikePattern(query.accountantEmailContains)}%`);
    conditions.push(
      `NULLIF(BTRIM(${OUTLET_ALIAS}->'contacts'->>'accountantEmail'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.loadingTime) {
    params.push(`%${escapeIlikePattern(query.loadingTime)}%`);
    conditions.push(
      `NULLIF(BTRIM(${OUTLET_ALIAS}->'loading'->>'loadingTime'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.loadingSchedule === "yes") {
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM jsonb_each(${OUTLET_ALIAS}->'loading') loading_item(key, value)
        WHERE loading_item.key LIKE 'loadingOn%'
          AND loading_item.value = 'true'::jsonb
      )
    `);
  } else if (query.loadingSchedule === "no") {
    conditions.push(`
      NOT EXISTS (
        SELECT 1
        FROM jsonb_each(${OUTLET_ALIAS}->'loading') loading_item(key, value)
        WHERE loading_item.key LIKE 'loadingOn%'
          AND loading_item.value = 'true'::jsonb
      )
    `);
  }
  if (query.warehouseFilter === "yes") {
    conditions.push(`${OUTLET_ALIAS}->'warehouse' = 'true'::jsonb`);
  } else if (query.warehouseFilter === "no") {
    conditions.push(`${OUTLET_ALIAS}->'warehouse' = 'false'::jsonb`);
  } else if (query.warehouseFilter === "unknown") {
    conditions.push(`(${OUTLET_ALIAS}->'warehouse' IS NULL OR ${OUTLET_ALIAS}->'warehouse' = 'null'::jsonb)`);
  }
  if (query.tandoorClub) {
    params.push(`%${escapeIlikePattern(query.tandoorClub)}%`);
    conditions.push(
      `NULLIF(BTRIM(${OUTLET_ALIAS}->'additional'->>'statusTandoorClub'), '') ILIKE $${params.length} ESCAPE '\\'`,
    );
  }
  if (query.bonusTandoorClub) {
    params.push(`%${escapeIlikePattern(query.bonusTandoorClub)}%`);
    conditions.push(
      bonusTandoorClubSearchSql(`${OUTLET_ALIAS}->'additional'`, `$${params.length}`),
    );
  }
  appendLprFilterConditions(`${OUTLET_ALIAS}->'lpr'`, query, conditions, params, escapeIlikePattern);
  if (query.outletStatus === "open") {
    conditions.push(`
      (
        COALESCE(${OUTLET_ALIAS}->>'closureStatus', '') = 'open'
        OR (
          COALESCE(${OUTLET_ALIAS}->>'closureStatus', '') = ''
          AND COALESCE(${OUTLET_ALIAS}->>'closed', 'false') <> 'true'
        )
      )
    `);
  } else if (query.outletStatus === "closed") {
    conditions.push(`
      (
        ${OUTLET_ALIAS}->>'closureStatus' = 'closed'
        OR ${OUTLET_ALIAS}->>'closed' = 'true'
      )
    `);
  }

  for (const field of parseFilledEmptyFieldList(query.filled)) {
    if (!OUTLET_FILLED_EMPTY_FIELDS.has(field)) {
      continue;
    }
    conditions.push(outletFilledExpr(field));
  }
  for (const field of parseFilledEmptyFieldList(query.empty)) {
    if (!OUTLET_FILLED_EMPTY_FIELDS.has(field)) {
      continue;
    }
    conditions.push(outletEmptyExpr(field));
  }
}

function outletFilledExpr(field: string): string {
  const map: Record<string, string> = {
    storeAddress: `NULLIF(BTRIM(${OUTLET_ALIAS}->'address'->>'storeAddress'), '') IS NOT NULL`,
    deliveryAddress: `NULLIF(BTRIM(${OUTLET_ALIAS}->'address'->>'deliveryAddress'), '') IS NOT NULL`,
    routeDirection: `NULLIF(BTRIM(${OUTLET_ALIAS}->'address'->>'routeDirection'), '') IS NOT NULL`,
    tandoorClub: `NULLIF(BTRIM(${OUTLET_ALIAS}->'additional'->>'statusTandoorClub'), '') IS NOT NULL`,
    bonusTandoorClub: bonusTandoorClubFilledSql(`${OUTLET_ALIAS}->'additional'`),
    warehouse: `${OUTLET_ALIAS} ? 'warehouse' AND ${OUTLET_ALIAS}->'warehouse' IS NOT NULL AND ${OUTLET_ALIAS}->'warehouse' <> 'null'::jsonb`,
    storePhone: `NULLIF(BTRIM(${OUTLET_ALIAS}->'contacts'->>'storePhone'), '') IS NOT NULL`,
    accountantPhone: `NULLIF(BTRIM(${OUTLET_ALIAS}->'contacts'->>'accountantPhone'), '') IS NOT NULL`,
    accountantEmail: `NULLIF(BTRIM(${OUTLET_ALIAS}->'contacts'->>'accountantEmail'), '') IS NOT NULL`,
    loadingTime: `NULLIF(BTRIM(${OUTLET_ALIAS}->'loading'->>'loadingTime'), '') IS NOT NULL`,
    loadingSchedule: `
      EXISTS (
        SELECT 1
        FROM jsonb_each(${OUTLET_ALIAS}->'loading') loading_item(key, value)
        WHERE loading_item.key LIKE 'loadingOn%'
          AND loading_item.value = 'true'::jsonb
      )
    `,
    ...Object.fromEntries(
      [
        "lprName",
        "lprPost",
        "lprPhone",
        "lprEmail",
        "lprDateOfBirth",
        "lprBonus",
        "lprConditionsBonus",
      ].map((lprField) => [
        lprField,
        lprFilledEmptySql(`${OUTLET_ALIAS}->'lpr'`, lprField, "filled") ?? "TRUE",
      ]),
    ),
  };
  return map[field] ?? "TRUE";
}

function outletEmptyExpr(field: string): string {
  const map: Record<string, string> = {
    storeAddress: `NULLIF(BTRIM(${OUTLET_ALIAS}->'address'->>'storeAddress'), '') IS NULL`,
    deliveryAddress: `NULLIF(BTRIM(${OUTLET_ALIAS}->'address'->>'deliveryAddress'), '') IS NULL`,
    routeDirection: `NULLIF(BTRIM(${OUTLET_ALIAS}->'address'->>'routeDirection'), '') IS NULL`,
    tandoorClub: `NULLIF(BTRIM(${OUTLET_ALIAS}->'additional'->>'statusTandoorClub'), '') IS NULL`,
    bonusTandoorClub: bonusTandoorClubEmptySql(`${OUTLET_ALIAS}->'additional'`),
    warehouse: `(${OUTLET_ALIAS}->'warehouse' IS NULL OR ${OUTLET_ALIAS}->'warehouse' = 'null'::jsonb)`,
    storePhone: `NULLIF(BTRIM(${OUTLET_ALIAS}->'contacts'->>'storePhone'), '') IS NULL`,
    accountantPhone: `NULLIF(BTRIM(${OUTLET_ALIAS}->'contacts'->>'accountantPhone'), '') IS NULL`,
    accountantEmail: `NULLIF(BTRIM(${OUTLET_ALIAS}->'contacts'->>'accountantEmail'), '') IS NULL`,
    loadingTime: `NULLIF(BTRIM(${OUTLET_ALIAS}->'loading'->>'loadingTime'), '') IS NULL`,
    loadingSchedule: `
      NOT EXISTS (
        SELECT 1
        FROM jsonb_each(${OUTLET_ALIAS}->'loading') loading_item(key, value)
        WHERE loading_item.key LIKE 'loadingOn%'
          AND loading_item.value = 'true'::jsonb
      )
    `,
    ...Object.fromEntries(
      [
        "lprName",
        "lprPost",
        "lprPhone",
        "lprEmail",
        "lprDateOfBirth",
        "lprBonus",
        "lprConditionsBonus",
      ].map((lprField) => [
        lprField,
        lprFilledEmptySql(`${OUTLET_ALIAS}->'lpr'`, lprField, "empty") ?? "TRUE",
      ]),
    ),
  };
  return map[field] ?? "TRUE";
}

function buildScopedOutletExistsSql(
  conditions: string[],
  accessParams: OutletElemAccessParams,
  context: AccessContext,
): string {
  const accessibility = outletElemAccessibleSql(context, "onec_clients", OUTLET_ALIAS, accessParams);
  const allConditions = [accessibility, ...conditions];
  return `EXISTS (
    SELECT 1
    FROM jsonb_array_elements(${outletsJsonArraySql("onec_clients")}) outlet(elem)
    WHERE ${allConditions.join(" AND ")}
  )`;
}

/** Client entity: one scoped EXISTS for all outlet-level filters. */
export function applyClientEntityScopedOutletFilter(
  userFilter: SqlFilter,
  query: ClientsListQuery,
  context: AccessContext,
): SqlFilter {
  const conditions: string[] = [];
  const params: unknown[] = [];

  appendOutletAssignmentConditions(query, conditions, params);
  appendOutletFieldConditions(query, conditions, params);

  if (conditions.length === 0) {
    return userFilter;
  }

  // Number placeholders locally from $1; mergeSqlFilters rebases once against userFilter.params.
  const resolvedAccess = resolveOutletElemAccessParams(context, params);
  const accessParams = resolvedAccess.accessParams;
  const clause = buildScopedOutletExistsSql(conditions, accessParams, context);
  return mergeSqlFilters(userFilter, [clause], [...params, ...resolvedAccess.extraParams]);
}

export function applyClientLevelFilledEmptyFilters(userFilter: SqlFilter, query: ClientsListQuery): SqlFilter {
  let filter = userFilter;
  for (const field of parseFilledEmptyFieldList(query.filled)) {
    if (!CLIENT_FILLED_EMPTY_FIELDS.has(field)) {
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
    } else if (field === "discountProgram") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'commercial'->'fieldPresence'->>'discountProgram') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'commercial'->>'discountProgram'), '') IS NOT NULL`,
        ],
        [],
      );
    } else if (field === "discountAmount") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'commercial'->'fieldPresence'->>'discountAmount') = 'true'
           AND (onec_clients.extended_snapshot->'commercial'->>'discountAmount') IS NOT NULL`,
        ],
        [],
      );
    } else if (field === "markups") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'commercial'->'fieldPresence'->>'markups') = 'true'
           AND jsonb_typeof(onec_clients.extended_snapshot->'commercial'->'markups') = 'array'
           AND jsonb_array_length(onec_clients.extended_snapshot->'commercial'->'markups') > 0`,
        ],
        [],
      );
    } else if (field === "onecTop150") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'wholesaleExchange'->'fieldPresence'->>'top150') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'wholesaleExchange'->>'top150'), '') IS NOT NULL`,
        ],
        [],
      );
    } else if (field === "onecCategory") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'wholesaleExchange'->'fieldPresence'->>'outletCategory') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'wholesaleExchange'->>'outletCategory'), '') IS NOT NULL`,
        ],
        [],
      );
    } else if (field === "onecCounterparty") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'counterparty'->'fieldPresence'->>'counterparty') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'counterparty'->>'counterparty'), '') IS NOT NULL`,
        ],
        [],
      );
    } else if (field === "onecFullName") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'counterparty'->'fieldPresence'->>'fullName') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'counterparty'->>'fullName'), '') IS NOT NULL`,
        ],
        [],
      );
    } else if (field === "onecLegalEntityType") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'counterparty'->'fieldPresence'->>'legalEntityType') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'counterparty'->>'legalEntityType'), '') IS NOT NULL`,
        ],
        [],
      );
    } else if (field === "onecOgrn") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'counterparty'->'fieldPresence'->>'ogrn') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'counterparty'->>'ogrn'), '') IS NOT NULL`,
        ],
        [],
      );
    } else if (field === "onecPrimaryContract") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'clientContract'->'fieldPresence'->>'primaryContract') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'clientContract'->>'primaryContract'), '') IS NOT NULL`,
        ],
        [],
      );
    } else if (field === "onecMainAgreement") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'clientContract'->'fieldPresence'->>'mainAgreement') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'clientContract'->>'mainAgreement'), '') IS NOT NULL`,
        ],
        [],
      );
    } else if (field === "code1c") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'clientCode'->'fieldPresence'->>'code1c') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'clientCode'->>'code1c'), '') IS NOT NULL`,
        ],
        [],
      );
    }
  }
  for (const field of parseFilledEmptyFieldList(query.empty)) {
    if (!CLIENT_FILLED_EMPTY_FIELDS.has(field)) {
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
    } else if (field === "discountProgram") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'commercial'->'fieldPresence'->>'discountProgram') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'commercial'->>'discountProgram'), '') IS NULL`,
        ],
        [],
      );
    } else if (field === "discountAmount") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'commercial'->'fieldPresence'->>'discountAmount') = 'true'
           AND (onec_clients.extended_snapshot->'commercial'->>'discountAmount') IS NULL`,
        ],
        [],
      );
    } else if (field === "markups") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'commercial'->'fieldPresence'->>'markups') = 'true'
           AND (
             jsonb_typeof(onec_clients.extended_snapshot->'commercial'->'markups') <> 'array'
             OR jsonb_array_length(onec_clients.extended_snapshot->'commercial'->'markups') = 0
           )`,
        ],
        [],
      );
    } else if (field === "onecTop150") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'wholesaleExchange'->'fieldPresence'->>'top150') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'wholesaleExchange'->>'top150'), '') IS NULL`,
        ],
        [],
      );
    } else if (field === "onecCategory") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'wholesaleExchange'->'fieldPresence'->>'outletCategory') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'wholesaleExchange'->>'outletCategory'), '') IS NULL`,
        ],
        [],
      );
    } else if (field === "onecCounterparty") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'counterparty'->'fieldPresence'->>'counterparty') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'counterparty'->>'counterparty'), '') IS NULL`,
        ],
        [],
      );
    } else if (field === "onecFullName") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'counterparty'->'fieldPresence'->>'fullName') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'counterparty'->>'fullName'), '') IS NULL`,
        ],
        [],
      );
    } else if (field === "onecLegalEntityType") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'counterparty'->'fieldPresence'->>'legalEntityType') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'counterparty'->>'legalEntityType'), '') IS NULL`,
        ],
        [],
      );
    } else if (field === "onecOgrn") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'counterparty'->'fieldPresence'->>'ogrn') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'counterparty'->>'ogrn'), '') IS NULL`,
        ],
        [],
      );
    } else if (field === "onecPrimaryContract") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'clientContract'->'fieldPresence'->>'primaryContract') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'clientContract'->>'primaryContract'), '') IS NULL`,
        ],
        [],
      );
    } else if (field === "onecMainAgreement") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'clientContract'->'fieldPresence'->>'mainAgreement') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'clientContract'->>'mainAgreement'), '') IS NULL`,
        ],
        [],
      );
    } else if (field === "code1c") {
      filter = mergeSqlFilters(
        filter,
        [
          `(onec_clients.extended_snapshot->'clientCode'->'fieldPresence'->>'code1c') = 'true'
           AND NULLIF(BTRIM(onec_clients.extended_snapshot->'clientCode'->>'code1c'), '') IS NULL`,
        ],
        [],
      );
    }
  }
  return filter;
}
