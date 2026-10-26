import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { addSaleMoneyStrings, addSaleQuantityStrings } from "../../onec-sales/decimal-sum";
import { loadSalesImportSnapshotState, monthHasSaleAggregate, resolveMonthDatasetSha } from "../../onec-sales/import-snapshot";
import { isValidUuidParam } from "../uuid-param";
import { v3EntityAssignmentScope, v3HoldingVisibilityScope } from "./access-scope";
import { resolveV3EntityAccess } from "./detail";
import { appendAssignmentFilters, type V3ListQuery, type V3ResponsibleKind } from "./list";
import { renumberV3ScopeClause } from "./list-legal-grouped";

export const CLIENT_SALES_BATCH_MAX_IDS = 100;

const STRICT_MONTH_RE = /^(\d{4})-(\d{2})$/;

export function parseClientSalesMonthStrict(value: string): { ok: true; yyyyMm: string; monthStartIso: string } | { ok: false } {
  const trimmed = value.trim();
  const m = STRICT_MONTH_RE.exec(trimmed);
  if (!m) {
    return { ok: false };
  }
  const month = Number(m[2]);
  if (month < 1 || month > 12) {
    return { ok: false };
  }
  const yyyyMm = `${m[1]}-${m[2]}`;
  return { ok: true, yyyyMm, monthStartIso: `${yyyyMm}-01` };
}

export type ClientSalesTerritory = {
  ropBranchGuid?: string;
  responsibleGuid?: string;
  responsibleKind?: V3ResponsibleKind;
  managerGuid?: string;
  teamMemberGuids?: string[];
};

export type ClientSalesDataState =
  | "schema_not_ready"
  | "month_not_imported"
  | "loaded"
  | "incomplete"
  | "unavailable";

export type ClientSalesLegalRow = {
  legalGuid: string;
  name: string;
  inn: string | null;
  quantity: string | null;
  income: string | null;
  sharePercent: string | null;
  rowStatus: "has_sales" | "known_zero" | "unavailable";
  salesTabPath: string;
};

export type ClientSalesCardSummary = {
  month: string;
  currency: "RUB";
  vatNote: string;
  dataState: ClientSalesDataState;
  scopeLimited: boolean;
  incomeTotal: string | null;
  quantityTotal: string | null;
  legalEntitiesWithSalesCount: number | null;
  breakdown: ClientSalesLegalRow[];
  breakdownExpandedDefault: true;
};

export type ClientSalesListCell = {
  incomeTotal: string | null;
  quantityTotal: string | null;
  legalWithSalesCount: number | null;
  dataState: ClientSalesDataState;
  scopeLimited: boolean;
  breakdown: ClientSalesLegalRow[];
};

function territoryListInput(territory: ClientSalesTerritory): V3ListQuery {
  return {
    entity: "legal",
    page: 1,
    pageSize: 1,
    q: "",
    ropBranchGuid: territory.ropBranchGuid,
    responsibleGuid: territory.responsibleGuid,
    responsibleKind: territory.responsibleKind,
    managerGuid: territory.managerGuid,
    teamMemberGuids: territory.teamMemberGuids,
  };
}

function hasTerritoryNarrowing(territory: ClientSalesTerritory): boolean {
  return Boolean(
    territory.ropBranchGuid ||
      territory.managerGuid ||
      territory.responsibleGuid ||
      (territory.teamMemberGuids && territory.teamMemberGuids.length > 0),
  );
}

function inferScopeLimited(
  context: AccessContext,
  territory: ClientSalesTerritory,
  entity: "holding" | "legal",
): boolean {
  if (hasTerritoryNarrowing(territory)) {
    return true;
  }
  if (!context.fullClientBase || context.hasScopedClientAccess || context.explicitlyDeniedAll) {
    return true;
  }
  if (entity === "holding") {
    return true;
  }
  return false;
}

function buildLegalScopeSql(context: AccessContext, territory: ClientSalesTerritory): {
  clause: string;
  params: unknown[];
} {
  const scope = v3EntityAssignmentScope(context, "le", "legal");
  const params = [...scope.params];
  const filters = appendAssignmentFilters(territoryListInput(territory), "le", params);
  return { clause: `(${scope.clause})${filters}`, params };
}

export async function listClientSalesMonths(
  context: AccessContext,
  territory: ClientSalesTerritory,
): Promise<{ months: string[]; dataState: ClientSalesDataState }> {
  const snapshot = await loadSalesImportSnapshotState();
  if (!snapshot.schemaReady) {
    return { months: [], dataState: "schema_not_ready" };
  }
  const { clause, params } = buildLegalScopeSql(context, territory);
  const rows = await query<{ month: string }>(
    `
      SELECT DISTINCT to_char(sl.sale_month, 'YYYY-MM') AS month
      FROM onec_v3_legal_sales_lines sl
      INNER JOIN onec_v3_legal_entities le ON le.guid_client = sl.legal_guid
      WHERE (${clause})
      ORDER BY month DESC
    `,
    params,
  );
  return { months: rows.rows.map((r) => r.month), dataState: "loaded" };
}

export async function resolveDefaultClientSalesMonth(
  context: AccessContext,
  territory: ClientSalesTerritory,
): Promise<string | null> {
  const listed = await listClientSalesMonths(context, territory);
  return listed.months[0] ?? null;
}

type LegalAggRow = {
  legal_guid: string;
  name_client: string;
  inn: string | null;
  quantity: string;
  income: string;
  line_count: string;
};

function sharePercent(income: string, totalIncome: string): string | null {
  if (!totalIncome || totalIncome === "0" || totalIncome === "0.0000") {
    return null;
  }
  const inc = Number(income);
  const tot = Number(totalIncome);
  if (!Number.isFinite(inc) || !Number.isFinite(tot) || tot === 0) {
    return null;
  }
  return ((inc / tot) * 100).toFixed(2);
}

export function buildClientSalesTabPath(legalGuid: string, month: string, returnQuery?: string): string {
  const base =
    `/clients/${encodeURIComponent(legalGuid)}?v3Entity=legal&cardTab=sales&v3salesMonth=${encodeURIComponent(month)}`;
  if (!returnQuery) {
    return base;
  }
  const trimmed = returnQuery.startsWith("?") ? returnQuery : `?${returnQuery}`;
  return `${base}&return=${encodeURIComponent(trimmed)}`;
}

function buildBreakdownRows(
  rows: LegalAggRow[],
  month: string,
  monthImported: boolean,
  incomeTotal: string | null,
  returnQuery?: string,
): ClientSalesLegalRow[] {
  return rows.map((row) => {
    const lineCount = Number(row.line_count ?? 0);
    const hasSales = lineCount > 0 && (Number(row.income) !== 0 || Number(row.quantity) !== 0);
    const knownZero = monthImported && lineCount > 0 && Number(row.income) === 0 && Number(row.quantity) === 0;
    const rowStatus: ClientSalesLegalRow["rowStatus"] = !monthImported
      ? "unavailable"
      : lineCount === 0
        ? "unavailable"
        : knownZero
          ? "known_zero"
          : hasSales
            ? "has_sales"
            : "unavailable";
    return {
      legalGuid: row.legal_guid,
      name: row.name_client,
      inn: row.inn,
      quantity: rowStatus === "has_sales" || rowStatus === "known_zero" ? row.quantity : null,
      income: rowStatus === "has_sales" || rowStatus === "known_zero" ? row.income : null,
      sharePercent:
        monthImported && rowStatus === "has_sales" && incomeTotal ? sharePercent(row.income, incomeTotal) : null,
      rowStatus,
      salesTabPath: buildClientSalesTabPath(row.legal_guid, month, returnQuery),
    };
  });
}

function finalizeCardSummary(
  rows: LegalAggRow[],
  month: string,
  monthImported: boolean,
  scopeLimited: boolean,
  returnQuery?: string,
): ClientSalesCardSummary {
  if (!monthImported) {
    return {
      month,
      currency: "RUB",
      vatNote: "Суммы с НДС, ₽",
      dataState: "month_not_imported",
      scopeLimited,
      incomeTotal: null,
      quantityTotal: null,
      legalEntitiesWithSalesCount: null,
      breakdown: buildBreakdownRows(rows, month, false, null, returnQuery),
      breakdownExpandedDefault: true,
    };
  }

  if (!rows.length) {
    return {
      month,
      currency: "RUB",
      vatNote: "Суммы с НДС, ₽",
      dataState: "unavailable",
      scopeLimited,
      incomeTotal: null,
      quantityTotal: null,
      legalEntitiesWithSalesCount: null,
      breakdown: [],
      breakdownExpandedDefault: true,
    };
  }

  let incomplete = false;
  for (const row of rows) {
    if (Number(row.line_count) === 0) {
      incomplete = true;
      break;
    }
  }

  const incomeParts: string[] = [];
  const quantityParts: string[] = [];
  let legalWithSales = 0;
  if (!incomplete) {
    for (const row of rows) {
      incomeParts.push(row.income);
      quantityParts.push(row.quantity);
      if (Number(row.income) !== 0 || Number(row.quantity) !== 0) {
        legalWithSales += 1;
      }
    }
  }

  const incomeTotal = !incomplete && incomeParts.length ? addSaleMoneyStrings(incomeParts) : null;
  const quantityTotal = !incomplete && quantityParts.length ? addSaleQuantityStrings(quantityParts) : null;
  const dataState: ClientSalesDataState = incomplete ? "incomplete" : "loaded";
  const breakdown = buildBreakdownRows(rows, month, true, incomeTotal, returnQuery);

  return {
    month,
    currency: "RUB",
    vatNote: "Суммы с НДС, ₽",
    dataState,
    scopeLimited,
    incomeTotal,
    quantityTotal,
    legalEntitiesWithSalesCount: incomplete ? null : legalWithSales,
    breakdown,
    breakdownExpandedDefault: true,
  };
}

function cardToListCell(card: ClientSalesCardSummary): ClientSalesListCell {
  return {
    incomeTotal: card.incomeTotal,
    quantityTotal: card.quantityTotal,
    legalWithSalesCount: card.legalEntitiesWithSalesCount,
    dataState: card.dataState,
    scopeLimited: card.scopeLimited,
    breakdown: card.breakdown,
  };
}

export async function loadClientSalesCardSummary(
  context: AccessContext,
  entity: "holding" | "legal",
  guid: string,
  monthRaw: string,
  territory: ClientSalesTerritory,
  options?: { returnQuery?: string },
): Promise<ClientSalesCardSummary | null | "invalid_month"> {
  const monthParsed = parseClientSalesMonthStrict(monthRaw);
  if (!monthParsed.ok) {
    return "invalid_month";
  }
  const access = await resolveV3EntityAccess(context, entity, guid);
  if (access !== "visible") {
    return null;
  }

  const snapshot = await loadSalesImportSnapshotState();
  const scopeLimited = inferScopeLimited(context, territory, entity);
  if (!snapshot.schemaReady) {
    return {
      month: monthParsed.yyyyMm,
      currency: "RUB",
      vatNote: "Суммы с НДС, ₽",
      dataState: "schema_not_ready",
      scopeLimited,
      incomeTotal: null,
      quantityTotal: null,
      legalEntitiesWithSalesCount: null,
      breakdown: [],
      breakdownExpandedDefault: true,
    };
  }

  const monthImported = await monthHasSaleAggregate(monthParsed.monthStartIso);
  const { clause, params } = buildLegalScopeSql(context, territory);
  const monthParam = params.length + 1;
  let extraWhereSql = "";
  const extraParams: unknown[] = [monthParsed.monthStartIso];

  if (entity === "holding") {
    const guidParam = params.length + 2;
    extraWhereSql = ` AND le.guid_holding = $${guidParam}::uuid AND COALESCE(le.membership_conflict, false) = false`;
    extraParams.push(guid);
  } else {
    const guidParam = params.length + 2;
    extraWhereSql = ` AND le.guid_client = $${guidParam}::uuid`;
    extraParams.push(guid);
  }

  const allParams = [...params, ...extraParams];
  const rows = await query<LegalAggRow>(
    `
      SELECT
        le.guid_client::text AS legal_guid,
        le.name_client,
        le.inn,
        COALESCE(SUM(sl.quantity), 0)::text AS quantity,
        COALESCE(SUM(sl.income), 0)::text AS income,
        COUNT(sl.legal_guid)::text AS line_count
      FROM onec_v3_legal_entities le
      LEFT JOIN onec_v3_legal_sales_lines sl
        ON sl.legal_guid = le.guid_client AND sl.sale_month = $${monthParam}::date
      WHERE (${clause})
        ${extraWhereSql}
      GROUP BY le.guid_client, le.name_client, le.inn
      ORDER BY le.name_client
    `,
    allParams,
  ).then((r) => r.rows);

  return finalizeCardSummary(rows, monthParsed.yyyyMm, monthImported, scopeLimited, options?.returnQuery);
}

export type ClientSalesBatchTarget = {
  kind: "holding" | "legal";
  guid: string;
};

/** Only accepts a summary already authorized by loadClientSalesCardSummary. */
export async function loadClientSalesDrilldown(
  summary: ClientSalesCardSummary,
  options: { legalGuid: string | null; productType: string | null; search: string; page: number },
) {
  const allowed = summary.breakdown.map((row) => row.legalGuid);
  if (options.legalGuid && !allowed.includes(options.legalGuid)) {
    return { error: "legal_unavailable" as const };
  }
  const guids = options.legalGuid ? [options.legalGuid] : allowed;
  const snapshot = await loadSalesImportSnapshotState();
  const empty = { summary, selectedLegalGuid: options.legalGuid, categories: [], items: [],
    itemState: "not_imported", itemTotals: null, page: options.page, hasMore: false };
  if (!guids.length || !snapshot.schemaReady) return empty;
  const categories = await query<{
    productType: string; quantityTotal: string; incomeTotal: string;
  }>(`
    SELECT product_type AS "productType", SUM(quantity)::text AS "quantityTotal",
           SUM(income)::text AS "incomeTotal"
    FROM onec_v3_legal_sales_lines
    WHERE legal_guid = ANY($1::uuid[]) AND sale_month = $2::date
    GROUP BY product_type ORDER BY product_type
  `, [guids, `${summary.month}-01`]);
  const base = { ...empty, categories: categories.rows };
  if (options.productType === null) return { ...base, itemState: "choose_category" };
  if (!categories.rows.some((row) => row.productType === options.productType)) {
    return { error: "category_unavailable" as const };
  }
  const sha = await resolveMonthDatasetSha("sale_items", `${summary.month}-01`, snapshot.saleItemsSha);
  if (!sha) return base;
  const params = [guids, `${summary.month}-01`, sha, options.productType];
  const predicate = `legal_guid = ANY($1::uuid[]) AND sale_month = $2::date
    AND source_sha256 = $3 AND product_type = $4 AND catalog_matched = TRUE`;
  const totals = await query<{ quantityTotal: string | null; incomeTotal: string | null }>(`
    SELECT SUM(quantity)::text AS "quantityTotal", SUM(income)::text AS "incomeTotal"
    FROM onec_v3_legal_sale_item_lines WHERE ${predicate}
  `, params);
  const result = await query<{
    modelGuid: string; name: string | null; productType: string; quantityTotal: string; incomeTotal: string;
  }>(`
    SELECT guid_item::text AS "modelGuid", MAX(NULLIF(name_item, '')) AS name,
      product_type AS "productType", SUM(quantity)::text AS "quantityTotal",
      SUM(income)::text AS "incomeTotal"
    FROM onec_v3_legal_sale_item_lines WHERE ${predicate}
    GROUP BY guid_item, product_type
    HAVING $5 = '' OR STRPOS(LOWER(COALESCE(MAX(name_item), '')), LOWER($5)) > 0
      OR STRPOS(guid_item::text, LOWER($5)) > 0
    ORDER BY name NULLS LAST, guid_item
    LIMIT 51 OFFSET $6
  `, [...params, options.search, (options.page - 1) * 50]);
  const categoryTotal = categories.rows.find((row) => row.productType === options.productType);
  const itemTotal = totals.rows[0];
  const totalsDiffer = categoryTotal && itemTotal?.incomeTotal != null && itemTotal.quantityTotal != null
    ? addSaleMoneyStrings([categoryTotal.incomeTotal]) !== addSaleMoneyStrings([itemTotal.incomeTotal]) ||
      addSaleQuantityStrings([categoryTotal.quantityTotal]) !== addSaleQuantityStrings([itemTotal.quantityTotal])
    : null;
  return { ...base, items: result.rows.slice(0, 50), hasMore: result.rows.length > 50, totalsDiffer,
    itemState: "loaded", itemTotals: totals.rows[0] ?? null };
}

export type ClientSalesBatchTargetParse =
  | { ok: true; targets: ClientSalesBatchTarget[] }
  | { ok: false; code: "not_array" | "too_many" | "invalid_entry" };

export function parseClientSalesBatchTargets(raw: unknown): ClientSalesBatchTargetParse {
  if (!Array.isArray(raw)) {
    return { ok: false, code: "not_array" };
  }
  if (raw.length > CLIENT_SALES_BATCH_MAX_IDS) {
    return { ok: false, code: "too_many" };
  }
  const normalized: ClientSalesBatchTarget[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, code: "invalid_entry" };
    }
    const kind = (entry as ClientSalesBatchTarget).kind;
    const guidRaw = (entry as ClientSalesBatchTarget).guid;
    if (kind !== "holding" && kind !== "legal") {
      return { ok: false, code: "invalid_entry" };
    }
    if (typeof guidRaw !== "string" || !isValidUuidParam(guidRaw.trim())) {
      return { ok: false, code: "invalid_entry" };
    }
    normalized.push({ kind, guid: guidRaw.trim().toLowerCase() });
  }
  const unique = new Map<string, ClientSalesBatchTarget>();
  for (const t of normalized) {
    unique.set(`${t.kind}:${t.guid}`, t);
  }
  return { ok: true, targets: [...unique.values()] };
}

export function parseClientSalesBatchTargetsFromQueryStrings(raw: unknown): ClientSalesBatchTargetParse {
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const asObjects: Array<{ kind: string; guid: string }> = [];
  for (const entry of list) {
    if (typeof entry !== "string") {
      return { ok: false, code: "invalid_entry" };
    }
    const trimmed = entry.trim();
    const sep = trimmed.indexOf(":");
    if (sep <= 0) {
      return { ok: false, code: "invalid_entry" };
    }
    asObjects.push({ kind: trimmed.slice(0, sep), guid: trimmed.slice(sep + 1) });
  }
  return parseClientSalesBatchTargets(asObjects);
}

/** Max DB round-trips for batch auth + aggregates (not linear in target count). */
export const CLIENT_SALES_BATCH_QUERY_BUDGET = 8;

async function visibleBatchTargetKeys(
  context: AccessContext,
  targets: ClientSalesBatchTarget[],
): Promise<Set<string>> {
  const visible = new Set<string>();
  const holdingGuids = [...new Set(targets.filter((t) => t.kind === "holding").map((t) => t.guid))];
  const legalGuids = [...new Set(targets.filter((t) => t.kind === "legal").map((t) => t.guid))];

  if (holdingGuids.length) {
    const scope = v3HoldingVisibilityScope(context, "h");
    const clause = renumberV3ScopeClause(scope.clause, 2);
    const rows = await query<{ guid: string }>(
      `
        SELECT h.guid_holding::text AS guid
        FROM onec_v3_holdings h
        WHERE h.guid_holding = ANY($1::uuid[])
          AND (${clause})
      `,
      [holdingGuids, ...scope.params],
    );
    for (const row of rows.rows) {
      visible.add(`holding:${row.guid.toLowerCase()}`);
    }
  }

  if (legalGuids.length) {
    const scope = v3EntityAssignmentScope(context, "le", "legal");
    const clause = renumberV3ScopeClause(scope.clause, 2);
    const rows = await query<{ guid: string }>(
      `
        SELECT le.guid_client::text AS guid
        FROM onec_v3_legal_entities le
        WHERE le.guid_client = ANY($1::uuid[])
          AND (${clause})
      `,
      [legalGuids, ...scope.params],
    );
    for (const row of rows.rows) {
      visible.add(`legal:${row.guid.toLowerCase()}`);
    }
  }

  return visible;
}

async function loadMemberRowsForTargets(
  context: AccessContext,
  territory: ClientSalesTerritory,
  targets: ClientSalesBatchTarget[],
  monthStartIso: string,
): Promise<Map<string, LegalAggRow[]>> {
  const result = new Map<string, LegalAggRow[]>();
  for (const target of targets) {
    result.set(`${target.kind}:${target.guid}`, []);
  }
  if (!targets.length) {
    return result;
  }

  const holdingGuids = targets.filter((t) => t.kind === "holding").map((t) => t.guid);
  const legalGuids = targets.filter((t) => t.kind === "legal").map((t) => t.guid);
  const { clause, params } = buildLegalScopeSql(context, territory);
  const monthParam = params.length + 1;

  type TargetRow = LegalAggRow & { target_guid: string };

  if (holdingGuids.length) {
    const holdingParam = params.length + 2;
    const holdingRows = await query<TargetRow>(
      `
        SELECT
          le.guid_holding::text AS target_guid,
          le.guid_client::text AS legal_guid,
          le.name_client,
          le.inn,
          COALESCE(SUM(sl.quantity), 0)::text AS quantity,
          COALESCE(SUM(sl.income), 0)::text AS income,
          COUNT(sl.legal_guid)::text AS line_count
        FROM onec_v3_legal_entities le
        LEFT JOIN onec_v3_legal_sales_lines sl
          ON sl.legal_guid = le.guid_client AND sl.sale_month = $${monthParam}::date
        WHERE (${clause})
          AND le.guid_holding = ANY($${holdingParam}::uuid[])
          AND COALESCE(le.membership_conflict, false) = false
        GROUP BY le.guid_holding, le.guid_client, le.name_client, le.inn
        ORDER BY le.name_client
      `,
      [...params, monthStartIso, holdingGuids],
    );
    for (const row of holdingRows.rows) {
      const key = `holding:${row.target_guid.toLowerCase()}`;
      const list = result.get(key) ?? [];
      list.push({
        legal_guid: row.legal_guid,
        name_client: row.name_client,
        inn: row.inn,
        quantity: row.quantity,
        income: row.income,
        line_count: row.line_count,
      });
      result.set(key, list);
    }
  }

  if (legalGuids.length) {
    const legalParam = params.length + 2;
    const legalRows = await query<TargetRow>(
      `
        SELECT
          le.guid_client::text AS target_guid,
          le.guid_client::text AS legal_guid,
          le.name_client,
          le.inn,
          COALESCE(SUM(sl.quantity), 0)::text AS quantity,
          COALESCE(SUM(sl.income), 0)::text AS income,
          COUNT(sl.legal_guid)::text AS line_count
        FROM onec_v3_legal_entities le
        LEFT JOIN onec_v3_legal_sales_lines sl
          ON sl.legal_guid = le.guid_client AND sl.sale_month = $${monthParam}::date
        WHERE (${clause})
          AND le.guid_client = ANY($${legalParam}::uuid[])
        GROUP BY le.guid_client, le.name_client, le.inn
        ORDER BY le.name_client
      `,
      [...params, monthStartIso, legalGuids],
    );
    for (const row of legalRows.rows) {
      const key = `legal:${row.target_guid.toLowerCase()}`;
      const list = result.get(key) ?? [];
      list.push({
        legal_guid: row.legal_guid,
        name_client: row.name_client,
        inn: row.inn,
        quantity: row.quantity,
        income: row.income,
        line_count: row.line_count,
      });
      result.set(key, list);
    }
  }

  return result;
}

export async function batchClientSalesListSummaries(
  context: AccessContext,
  monthRaw: string,
  targets: ClientSalesBatchTarget[],
  territory: ClientSalesTerritory,
): Promise<
  | { summaries: Record<string, ClientSalesListCell>; dataState: ClientSalesDataState; month: string }
  | "invalid_month"
  | "batch_too_large"
> {
  if (targets.length > CLIENT_SALES_BATCH_MAX_IDS) {
    return "batch_too_large";
  }
  const monthParsed = parseClientSalesMonthStrict(monthRaw);
  if (!monthParsed.ok) {
    return "invalid_month";
  }

  const snapshot = await loadSalesImportSnapshotState();
  if (!snapshot.schemaReady) {
    return {
      month: monthParsed.yyyyMm,
      dataState: "schema_not_ready",
      summaries: {},
    };
  }

  const monthImported = await monthHasSaleAggregate(monthParsed.monthStartIso);
  const visibleKeys = await visibleBatchTargetKeys(context, targets);
  const visibleTargets = targets.filter((t) => visibleKeys.has(`${t.kind}:${t.guid}`));
  const memberMap = await loadMemberRowsForTargets(
    context,
    territory,
    visibleTargets,
    monthParsed.monthStartIso,
  );

  const summaries: Record<string, ClientSalesListCell> = {};
  for (const target of targets) {
    const key = `${target.kind}:${target.guid}`;
    const access = visibleKeys.has(key);
    if (!access) {
      summaries[key] = {
        incomeTotal: null,
        quantityTotal: null,
        legalWithSalesCount: null,
        dataState: "unavailable",
        scopeLimited: true,
        breakdown: [],
      };
      continue;
    }
    const rows = memberMap.get(key) ?? [];
    const scopeLimited = inferScopeLimited(context, territory, target.kind);
    const card = finalizeCardSummary(rows, monthParsed.yyyyMm, monthImported, scopeLimited);
    summaries[key] = cardToListCell(card);
  }

  const dataState: ClientSalesDataState = monthImported ? "loaded" : "month_not_imported";
  return { month: monthParsed.yyyyMm, dataState, summaries };
}
