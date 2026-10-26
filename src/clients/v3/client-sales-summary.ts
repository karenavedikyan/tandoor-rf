import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { addSaleMoneyStrings, addSaleQuantityStrings } from "../../onec-sales/decimal-sum";
import { loadSalesImportSnapshotState, monthHasSaleAggregate } from "../../onec-sales/import-snapshot";
import { v3EntityAssignmentScope } from "./access-scope";
import { resolveV3EntityAccess } from "./detail";
import { appendAssignmentFilters, type V3ListQuery, type V3ResponsibleKind } from "./list";

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
    if (typeof guidRaw !== "string" || !/^[0-9a-f-]{36}$/i.test(guidRaw.trim())) {
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

async function filterVisibleTargets(
  context: AccessContext,
  targets: ClientSalesBatchTarget[],
): Promise<ClientSalesBatchTarget[]> {
  const visible: ClientSalesBatchTarget[] = [];
  for (const target of targets) {
    const access = await resolveV3EntityAccess(context, target.kind, target.guid);
    if (access === "visible") {
      visible.push(target);
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
  const visibleTargets = await filterVisibleTargets(context, targets);
  const memberMap = await loadMemberRowsForTargets(
    context,
    territory,
    visibleTargets,
    monthParsed.monthStartIso,
  );

  const summaries: Record<string, ClientSalesListCell> = {};
  for (const target of targets) {
    const key = `${target.kind}:${target.guid}`;
    const access = visibleTargets.some((t) => t.kind === target.kind && t.guid === target.guid);
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
