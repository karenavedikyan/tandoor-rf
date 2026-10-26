import { query } from "../../db/pool";
import type { AccessContext } from "../../access/types";
import { addSaleMoneyStrings, addSaleQuantityStrings } from "../../onec-sales/decimal-sum";
import { loadSalesImportSnapshotState, monthHasSaleAggregate } from "../../onec-sales/import-snapshot";
import { normalizeSaleMonth } from "../../onec-sales/sale-month";
import { v3EntityAssignmentScope, v3HoldingMemberLegalScope } from "./access-scope";
import { resolveV3EntityAccess } from "./detail";
import { appendAssignmentFilters, type V3ListQuery, type V3ResponsibleKind } from "./list";

export const CLIENT_SALES_BATCH_MAX_IDS = 100;

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
  | "incomplete";

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
  accessibleLegalCount: number;
  holdingLegalTotalCount: number | null;
  breakdown: ClientSalesLegalRow[];
  breakdownExpandedDefault: true;
};

export type ClientSalesListCell = {
  incomeTotal: string | null;
  quantityTotal: string | null;
  legalWithSalesCount: number | null;
  dataState: ClientSalesDataState;
  scopeLimited: boolean;
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

function buildBreakdownRows(
  rows: LegalAggRow[],
  month: string,
  monthImported: boolean,
  incomeTotal: string,
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
      quantity: monthImported ? row.quantity : null,
      income: monthImported ? row.income : null,
      sharePercent: monthImported && hasSales ? sharePercent(row.income, incomeTotal) : null,
      rowStatus,
      salesTabPath: `?cardTab=sales&v3salesMonth=${encodeURIComponent(month)}`,
    };
  });
}

async function holdingScopeLimited(
  context: AccessContext,
  holdingGuid: string,
): Promise<{ limited: boolean; holdingLegalTotal: number; accessibleLegal: number }> {
  const legalScope = v3HoldingMemberLegalScope(context, "le");
  const holdingParam = legalScope.params.length + 1;
  const totalRow = await query<{ n: string }>(
    `
      SELECT COUNT(*)::text AS n
      FROM onec_v3_legal_entities le
      WHERE le.guid_holding = $1::uuid
    `,
    [holdingGuid],
  );
  const accessibleRow = await query<{ n: string }>(
    `
      SELECT COUNT(*)::text AS n
      FROM onec_v3_legal_entities le
      WHERE le.guid_holding = $${holdingParam}::uuid AND (${legalScope.clause})
    `,
    [...legalScope.params, holdingGuid],
  );
  const holdingLegalTotal = Number(totalRow.rows[0]?.n ?? 0);
  const accessibleLegal = Number(accessibleRow.rows[0]?.n ?? 0);
  const limited = !context.fullClientBase && holdingLegalTotal > accessibleLegal;
  return { limited, holdingLegalTotal, accessibleLegal };
}

export async function loadClientSalesCardSummary(
  context: AccessContext,
  entity: "holding" | "legal",
  guid: string,
  monthRaw: string,
  territory: ClientSalesTerritory,
): Promise<ClientSalesCardSummary | null | "invalid_month"> {
  const monthParsed = normalizeSaleMonth(monthRaw.length === 7 ? monthRaw : `${monthRaw}-01`);
  if (!monthParsed.ok) {
    return "invalid_month";
  }
  const access = await resolveV3EntityAccess(context, entity, guid);
  if (access !== "visible") {
    return null;
  }

  const snapshot = await loadSalesImportSnapshotState();
  if (!snapshot.schemaReady) {
    return {
      month: monthParsed.yyyyMm,
      currency: "RUB",
      vatNote: "Суммы с НДС, ₽",
      dataState: "schema_not_ready",
      scopeLimited: false,
      incomeTotal: null,
      quantityTotal: null,
      legalEntitiesWithSalesCount: null,
      accessibleLegalCount: 0,
      holdingLegalTotalCount: null,
      breakdown: [],
      breakdownExpandedDefault: true,
    };
  }

  const monthImported = await monthHasSaleAggregate(monthParsed.monthStartIso);
  const dataState: ClientSalesDataState = monthImported ? "loaded" : "month_not_imported";

  const { clause, params } = buildLegalScopeSql(context, territory);
  const monthParam = params.length + 1;
  let extraWhereSql = "";
  const extraParams: unknown[] = [monthParsed.monthStartIso];
  let scopeMeta = { limited: false, holdingLegalTotal: null as number | null, accessibleLegal: 1 };

  if (entity === "holding") {
    const guidParam = params.length + 2;
    extraWhereSql = ` AND le.guid_holding = $${guidParam}::uuid`;
    extraParams.push(guid);
    const meta = await holdingScopeLimited(context, guid);
    scopeMeta = {
      limited: meta.limited,
      holdingLegalTotal: meta.holdingLegalTotal,
      accessibleLegal: meta.accessibleLegal,
    };
  } else {
    const guidParam = params.length + 2;
    extraWhereSql = ` AND le.guid_client = $${guidParam}::uuid`;
    extraParams.push(guid);
    scopeMeta.accessibleLegal = 1;
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

  const incomeParts: string[] = [];
  const quantityParts: string[] = [];
  let legalWithSales = 0;
  if (monthImported) {
    for (const row of rows) {
      if (Number(row.line_count) === 0) {
        continue;
      }
      incomeParts.push(row.income);
      quantityParts.push(row.quantity);
      if (Number(row.income) !== 0 || Number(row.quantity) !== 0) {
        legalWithSales += 1;
      }
    }
  }
  const incomeTotal = monthImported && incomeParts.length ? addSaleMoneyStrings(incomeParts) : "0";
  const quantityTotal = monthImported && quantityParts.length ? addSaleQuantityStrings(quantityParts) : "0";

  const breakdown = buildBreakdownRows(rows, monthParsed.yyyyMm, monthImported, incomeTotal);

  return {
    month: monthParsed.yyyyMm,
    currency: "RUB",
    vatNote: "Суммы с НДС, ₽",
    dataState,
    scopeLimited: scopeMeta.limited,
    incomeTotal: monthImported ? incomeTotal : null,
    quantityTotal: monthImported ? quantityTotal : null,
    legalEntitiesWithSalesCount: monthImported ? legalWithSales : null,
    accessibleLegalCount: scopeMeta.accessibleLegal,
    holdingLegalTotalCount: scopeMeta.holdingLegalTotal,
    breakdown,
    breakdownExpandedDefault: true,
  };
}

export type ClientSalesBatchTarget = {
  kind: "holding" | "legal";
  guid: string;
};

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
  const monthParsed = normalizeSaleMonth(monthRaw.length === 7 ? monthRaw : `${monthRaw}-01`);
  if (!monthParsed.ok) {
    return "invalid_month";
  }
  const unique = new Map<string, ClientSalesBatchTarget>();
  for (const t of targets) {
    unique.set(`${t.kind}:${t.guid.toLowerCase()}`, { kind: t.kind, guid: t.guid.toLowerCase() });
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
  const dataState: ClientSalesDataState = monthImported ? "loaded" : "month_not_imported";
  const summaries: Record<string, ClientSalesListCell> = {};
  for (const target of unique.values()) {
    const card = await loadClientSalesCardSummary(
      context,
      target.kind,
      target.guid,
      monthParsed.yyyyMm,
      territory,
    );
    if (!card || typeof card !== "object") {
      continue;
    }
    const key = `${target.kind}:${target.guid}`;
    summaries[key] = {
      incomeTotal: card.incomeTotal,
      quantityTotal: card.quantityTotal,
      legalWithSalesCount: card.legalEntitiesWithSalesCount,
      dataState: card.dataState,
      scopeLimited: card.scopeLimited,
    };
  }
  return { month: monthParsed.yyyyMm, dataState, summaries };
}
