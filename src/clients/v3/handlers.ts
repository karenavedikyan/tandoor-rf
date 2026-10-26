import type { Response } from "express";
import type { AccessRequest } from "../../access/middleware";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { isValidUuidParam } from "../uuid-param";
import { listV3Entities, isExchangeV3Active, type V3ListEntity } from "./list";
import { loadV3FilterOptions } from "./options";
import { buildV3UnassignedSummary } from "./unassigned";
import { getV3OrgStructureOverview, listV3RopResponsibles } from "./teams-structure";
import { OrgStructureAccessError } from "../org/structure-repository";
import type { V3ResponsibleKind } from "./list";
import {
  getV3HoldingComposition,
  getV3HoldingDetail,
  getV3LegalDetail,
  getV3RetailDetail,
  type V3DetailEntity,
} from "./detail";
import { parseMultiFilterTokenParam } from "./query-params";
import { getV3FieldCatalog } from "./field-catalog";
import { loadV3ScopeSummary } from "./scope-summary";
import { listFilterFieldsForEntity, parseV3FilterRulesParam } from "./list-field-rules";
import { getLegalSalesForMonth, getLegalSalesImportMeta, listLegalSalesMonths } from "./legal-sales";
import {
  listSalesSectionClientRows,
  listSalesSectionMonths,
  listSalesSectionSkuRows,
  loadSalesSectionOverview,
} from "./sales-section";
import {
  resolveSalesSectionFieldPolicy,
  RETURNS_SOURCE_FINANCE_AVAILABILITY,
  SALES_SOURCE_FINANCE_AVAILABILITY,
} from "./sales-field-policy";
import { resolveV3ListTeamMemberGuids } from "./team-assignment-counts";
import {
  batchClientSalesListSummaries,
  CLIENT_SALES_BATCH_MAX_IDS,
  listClientSalesMonths,
  loadClientSalesCardSummary,
  parseClientSalesBatchTargets,
  parseClientSalesMonthStrict,
  type ClientSalesBatchTarget,
} from "./client-sales-summary";

const LIST_ENTITIES = new Set<V3ListEntity>(["holdings", "legal", "legal_grouped", "retail", "orphan_retail"]);
const DETAIL_ENTITIES = new Set<V3DetailEntity>(["holding", "legal", "retail"]);

async function requireV3Active(res: Response): Promise<boolean> {
  const active = await isExchangeV3Active();
  if (!active) {
    setNoStore(res);
    res.status(503).json(apiError("EXCHANGE_V3_NOT_ACTIVE", "Данные exchange v3 ещё не загружены."));
    return false;
  }
  return true;
}

function parseGuidParam(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidUuidParam(raw) ? raw : null;
}

function parseOptionalGuidQuery(
  value: unknown,
): { ok: true; guid: string | null } | { ok: false } {
  if (value === undefined) {
    return { ok: true, guid: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, guid: null };
  }
  const guid = parseGuidParam(trimmed);
  if (!guid) {
    return { ok: false };
  }
  return { ok: true, guid };
}

function notFoundForAccess(res: Response): void {
  setNoStore(res);
  res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Объект не найден."));
}

async function resolveTeamMemberGuidsForQuery(
  context: AccessRequest["accessContext"],
  res: Response,
  query: AccessRequest["query"],
  responsibleGuid: string | null | undefined,
): Promise<string[] | undefined> {
  if (query.teamGuid === undefined) {
    return undefined;
  }
  const teamGuid = parseGuidParam(query.teamGuid);
  if (!teamGuid) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый teamGuid."));
    return undefined;
  }
  const leaderGuid = parseGuidParam(query.ropBranchGuid);
  if (!leaderGuid) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Для teamGuid нужен ropBranchGuid."));
    return undefined;
  }
  try {
    return await resolveV3ListTeamMemberGuids(context!, teamGuid, leaderGuid, responsibleGuid ?? undefined);
  } catch (error) {
    if (error instanceof OrgStructureAccessError) {
      setNoStore(res);
      res.status(error.code === "FORBIDDEN" ? 403 : 404).json(apiError(ERROR_CODES.FORBIDDEN, error.message));
      return undefined;
    }
    throw error;
  }
}

export async function v3ClientsListHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const context = req.accessContext!;
  const entityRaw = String(req.query.entity ?? "legal");
  if (!LIST_ENTITIES.has(entityRaw as V3ListEntity)) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый entity."));
    return;
  }
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 50)));
  const q = String(req.query.q ?? "");
  const closedRaw = String(req.query.closed ?? "");
  const closed =
    closedRaw === "true" ? true : closedRaw === "false" ? false : undefined;
  const managerGuid = parseGuidParam(req.query.managerGuid);
  const typeGuid = typeof req.query.typeGuid === "string" ? req.query.typeGuid.trim() : undefined;
  const categoryGuid = typeof req.query.categoryGuid === "string" ? req.query.categoryGuid.trim() : undefined;
  const typeGuidsRaw = parseMultiFilterTokenParam(req.query.typeGuids);
  const categoryGuidsRaw = parseMultiFilterTokenParam(req.query.categoryGuids);
  if (req.query.typeGuids !== undefined && typeGuidsRaw === undefined) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый typeGuids."));
    return;
  }
  if (req.query.categoryGuids !== undefined && categoryGuidsRaw === undefined) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый categoryGuids."));
    return;
  }
  const typeGuids = typeGuidsRaw ?? (typeGuid ? [typeGuid] : undefined);
  const categoryGuids = categoryGuidsRaw ?? (categoryGuid ? [categoryGuid] : undefined);
  const missingManager = String(req.query.missingManager ?? "") === "true";
  const responsibleKindRaw = String(req.query.responsibleKind ?? "");
  const responsibleKind = ["manager", "regional", "hardware"].includes(responsibleKindRaw)
    ? (responsibleKindRaw as V3ResponsibleKind)
    : undefined;
  const responsibleGuid = parseGuidParam(req.query.responsibleGuid);
  const ropBranchGuid = parseGuidParam(req.query.ropBranchGuid);
  const trimOptional = (value: unknown): string | undefined => {
    const raw = typeof value === "string" ? value.trim() : "";
    return raw.length > 0 ? raw : undefined;
  };
  const fieldRules = parseV3FilterRulesParam(req.query.filters, entityRaw as V3ListEntity);
  if (req.query.filters !== undefined && String(req.query.filters).trim() !== "" && fieldRules === undefined) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый filters."));
    return;
  }
  const employeePortfolioGuid = parseGuidParam(req.query.employeePortfolioGuid);
  let teamMemberGuids: string[] | undefined;
  if (employeePortfolioGuid) {
    if (req.query.teamGuid !== undefined || ropBranchGuid) {
      setNoStore(res);
      res
        .status(400)
        .json(
          apiError(
            ERROR_CODES.VALIDATION_ERROR,
            "employeePortfolioGuid несовместим с teamGuid или ropBranchGuid.",
          ),
        );
      return;
    }
    teamMemberGuids = [employeePortfolioGuid];
  } else {
    teamMemberGuids = await resolveTeamMemberGuidsForQuery(context, res, req.query, responsibleGuid);
    if (teamMemberGuids === undefined && req.query.teamGuid !== undefined) {
      return;
    }
  }
  const result = await listV3Entities(context, {
    entity: entityRaw as V3ListEntity,
    page,
    pageSize,
    q,
    closed,
    managerGuid: managerGuid ?? undefined,
    responsibleGuid: employeePortfolioGuid ? undefined : responsibleGuid ?? undefined,
    responsibleKind: employeePortfolioGuid ? undefined : responsibleKind,
    ropBranchGuid: employeePortfolioGuid ? undefined : ropBranchGuid ?? undefined,
    teamMemberGuids,
    typeGuid: typeGuids?.length === 1 ? typeGuids[0] : undefined,
    categoryGuid: categoryGuids?.length === 1 ? categoryGuids[0] : undefined,
    typeGuids: typeGuids && typeGuids.length > 1 ? typeGuids : undefined,
    categoryGuids: categoryGuids && categoryGuids.length > 1 ? categoryGuids : undefined,
    missingManager: missingManager || undefined,
    city: trimOptional(req.query.city),
    colManager: trimOptional(req.query.colManager),
    colRegional: trimOptional(req.query.colRegional),
    colRop: trimOptional(req.query.colRop),
    colCity: trimOptional(req.query.colCity),
    colStatus: trimOptional(req.query.colStatus),
    fieldRules: fieldRules ?? [],
  });
  setNoStore(res);
  res.json({ entity: entityRaw, page, pageSize, total: result.total, items: result.items });
}

export async function v3FilterFieldsHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const entityRaw = String(req.query.entity ?? "legal");
  if (!LIST_ENTITIES.has(entityRaw as V3ListEntity)) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый entity."));
    return;
  }
  setNoStore(res);
  res.json({ fields: listFilterFieldsForEntity(entityRaw as V3ListEntity) });
}

export async function v3ScopeSummaryHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const responsibleKindRaw = String(req.query.responsibleKind ?? "");
  const responsibleKind = ["manager", "regional", "hardware"].includes(responsibleKindRaw)
    ? (responsibleKindRaw as V3ResponsibleKind)
    : undefined;
  const responsibleGuid = parseGuidParam(req.query.responsibleGuid);
  const ropBranchGuid = parseGuidParam(req.query.ropBranchGuid);
  const managerGuid = parseGuidParam(req.query.managerGuid);
  const employeePortfolioGuid = parseGuidParam(req.query.employeePortfolioGuid);
  let teamMemberGuids: string[] | undefined;
  if (employeePortfolioGuid) {
    if (req.query.teamGuid !== undefined || ropBranchGuid) {
      setNoStore(res);
      res
        .status(400)
        .json(
          apiError(
            ERROR_CODES.VALIDATION_ERROR,
            "employeePortfolioGuid несовместим с teamGuid или ropBranchGuid.",
          ),
        );
      return;
    }
    teamMemberGuids = [employeePortfolioGuid];
  } else {
    teamMemberGuids = await resolveTeamMemberGuidsForQuery(
      req.accessContext,
      res,
      req.query,
      responsibleGuid,
    );
    if (teamMemberGuids === undefined && req.query.teamGuid !== undefined) {
      return;
    }
  }
  const summary = await loadV3ScopeSummary(req.accessContext!, {
    ropBranchGuid: employeePortfolioGuid ? undefined : ropBranchGuid ?? undefined,
    responsibleGuid: employeePortfolioGuid ? undefined : responsibleGuid ?? undefined,
    responsibleKind: employeePortfolioGuid ? undefined : responsibleKind,
    managerGuid: employeePortfolioGuid ? undefined : managerGuid ?? undefined,
    teamMemberGuids,
  });
  setNoStore(res);
  res.json(summary);
}

export async function v3ClientsOptionsHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const entityRaw = String(req.query.entity ?? "legal");
  if (!LIST_ENTITIES.has(entityRaw as V3ListEntity)) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый entity."));
    return;
  }
  const rawKind = String(req.query.responsibleKind ?? "");
  const kind = ["manager", "regional", "hardware"].includes(rawKind) ? rawKind as V3ResponsibleKind : undefined;
  for (const key of ["managerGuid", "responsibleGuid", "ropBranchGuid", "teamGuid"] as const) {
    if (req.query[key] !== undefined && !parseGuidParam(req.query[key])) {
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимая территория."));
      return;
    }
  }
  if (req.query.responsibleGuid && !kind) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый responsibleKind."));
    return;
  }
  const responsibleGuid = parseGuidParam(req.query.responsibleGuid);
  const teamMemberGuids = await resolveTeamMemberGuidsForQuery(
    req.accessContext,
    res,
    req.query,
    responsibleGuid,
  );
  if (teamMemberGuids === undefined && req.query.teamGuid !== undefined) {
    return;
  }
  const options = await loadV3FilterOptions(req.accessContext!, entityRaw as V3ListEntity, {
    managerGuid: parseGuidParam(req.query.managerGuid) ?? undefined,
    responsibleGuid: responsibleGuid ?? undefined,
    responsibleKind: kind,
    ropBranchGuid: parseGuidParam(req.query.ropBranchGuid) ?? undefined,
    teamMemberGuids,
  });
  setNoStore(res);
  res.json(options);
}

export async function v3OrgStructureHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  try {
    const overview = await getV3OrgStructureOverview(req.accessContext!);
    setNoStore(res);
    res.json(overview);
  } catch (error) {
    if (error instanceof OrgStructureAccessError) {
      setNoStore(res);
      res.status(error.code === "FORBIDDEN" ? 403 : 404).json(apiError(ERROR_CODES.FORBIDDEN, error.message));
      return;
    }
    throw error;
  }
}

export async function v3RopResponsiblesHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const ropGuid = parseGuidParam(req.params.guid);
  if (!ropGuid) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный GUID РОП."));
    return;
  }
  try {
    const teamGuid = parseGuidParam(req.query.teamGuid);
    const items = await listV3RopResponsibles(req.accessContext!, ropGuid, { teamGuid });
    setNoStore(res);
    res.json({ items });
  } catch (error) {
    if (error instanceof OrgStructureAccessError) {
      setNoStore(res);
      res.status(error.code === "FORBIDDEN" ? 403 : 404).json(apiError(ERROR_CODES.FORBIDDEN, error.message));
      return;
    }
    throw error;
  }
}

export async function v3UnassignedSummaryHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const summary = await buildV3UnassignedSummary(req.accessContext!);
  setNoStore(res);
  res.json(summary);
}

export async function v3ClientsDetailHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const entityRaw = String(req.query.entity ?? "");
  if (!DETAIL_ENTITIES.has(entityRaw as V3DetailEntity)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый entity."));
    return;
  }
  const guid = parseGuidParam(req.query.guid);
  if (!guid) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный guid."));
    return;
  }

  const context = req.accessContext!;
  const entity = entityRaw as V3DetailEntity;
  const detail =
    entity === "holding"
      ? await getV3HoldingDetail(context, guid)
      : entity === "legal"
        ? await getV3LegalDetail(context, guid)
        : await getV3RetailDetail(context, guid);

  if (detail.access === "unknown" || detail.access === "withheld") {
    notFoundForAccess(res);
    return;
  }

  setNoStore(res);
  res.json({ entity, ...detail });
}

export async function v3FieldCatalogHandler(_req: AccessRequest, res: Response): Promise<void> {
  setNoStore(res);
  res.json(getV3FieldCatalog());
}

export async function v3HoldingCompositionHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const guid = parseGuidParam(req.params.guid);
  if (!guid) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный guid холдинга."));
    return;
  }
  const responsibleGuid = parseGuidParam(req.query.responsibleGuid);
  const ropBranchGuid = parseGuidParam(req.query.ropBranchGuid);
  const kindRaw = req.query.responsibleKind ?? "manager";
  if (
    (req.query.responsibleGuid !== undefined && !responsibleGuid) ||
    (req.query.ropBranchGuid !== undefined && !ropBranchGuid) ||
    typeof kindRaw !== "string" ||
    !["manager", "regional", "hardware"].includes(kindRaw)
  ) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректная выбранная территория."));
    return;
  }
  const composition = await getV3HoldingComposition(req.accessContext!, guid, {
    responsibleGuid: responsibleGuid ?? undefined,
    responsibleKind: kindRaw as V3ResponsibleKind,
    ropBranchGuid: ropBranchGuid ?? undefined,
  });
  if (composition.access === "unknown" || composition.access === "withheld") {
    notFoundForAccess(res);
    return;
  }
  setNoStore(res);
  res.json(composition);
}

export async function v3LegalSalesMonthsHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const legalGuid = parseGuidParam(req.params.guid);
  if (!legalGuid) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный GUID юрлица."));
    return;
  }
  const months = await listLegalSalesMonths(req.accessContext!, legalGuid);
  if (months === null) {
    notFoundForAccess(res);
    return;
  }
  const importMeta = await getLegalSalesImportMeta();
  setNoStore(res);
  res.json({
    legalGuid,
    months,
    salesImport: {
      applied: Boolean(importMeta && importMeta.rowCount > 0),
      importedAt: importMeta?.importedAt ?? null,
    },
  });
}

export async function v3LegalSalesMonthHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const legalGuid = parseGuidParam(req.params.guid);
  if (!legalGuid) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный GUID юрлица."));
    return;
  }
  const month = typeof req.query.month === "string" ? req.query.month.trim() : "";
  if (!month) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите month (YYYY-MM)."));
    return;
  }
  const sales = await getLegalSalesForMonth(req.accessContext!, legalGuid, month);
  if (sales === "invalid_month") {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный month."));
    return;
  }
  if (sales === null) {
    notFoundForAccess(res);
    return;
  }
  setNoStore(res);
  res.json({ legalGuid, sales });
}

async function resolveSalesSectionTerritory(
  req: AccessRequest,
  res: Response,
): Promise<
  | {
      ropBranchGuid?: string;
      responsibleGuid?: string;
      responsibleKind?: V3ResponsibleKind;
      managerGuid?: string;
      teamMemberGuids?: string[];
    }
  | undefined
> {
  const responsibleKindRaw = String(req.query.responsibleKind ?? "");
  const responsibleKind = ["manager", "regional", "hardware"].includes(responsibleKindRaw)
    ? (responsibleKindRaw as V3ResponsibleKind)
    : undefined;
  const responsibleParsed = parseOptionalGuidQuery(req.query.responsibleGuid);
  if (!responsibleParsed.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый responsibleGuid."));
    return undefined;
  }
  const ropParsed = parseOptionalGuidQuery(req.query.ropBranchGuid);
  if (!ropParsed.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый ropBranchGuid."));
    return undefined;
  }
  const managerParsed = parseOptionalGuidQuery(req.query.managerGuid);
  if (!managerParsed.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый managerGuid."));
    return undefined;
  }
  const portfolioParsed = parseOptionalGuidQuery(req.query.employeePortfolioGuid);
  if (!portfolioParsed.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый employeePortfolioGuid."));
    return undefined;
  }
  const responsibleGuid = responsibleParsed.guid;
  const ropBranchGuid = ropParsed.guid;
  const managerGuid = managerParsed.guid;
  const employeePortfolioGuid = portfolioParsed.guid;
  let teamMemberGuids: string[] | undefined;
  if (employeePortfolioGuid) {
    if (req.query.teamGuid !== undefined || ropBranchGuid) {
      setNoStore(res);
      res
        .status(400)
        .json(
          apiError(
            ERROR_CODES.VALIDATION_ERROR,
            "employeePortfolioGuid несовместим с teamGuid или ropBranchGuid.",
          ),
        );
      return undefined;
    }
    teamMemberGuids = [employeePortfolioGuid];
  } else {
    teamMemberGuids = await resolveTeamMemberGuidsForQuery(
      req.accessContext,
      res,
      req.query,
      responsibleGuid,
    );
    if (teamMemberGuids === undefined && req.query.teamGuid !== undefined) {
      return undefined;
    }
  }
  return {
    ropBranchGuid: ropBranchGuid ?? undefined,
    responsibleGuid: responsibleGuid ?? undefined,
    responsibleKind,
    managerGuid: managerGuid ?? undefined,
    teamMemberGuids,
  };
}

export async function v3SalesSectionMonthsHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const territory = await resolveSalesSectionTerritory(req, res);
  if (!territory) {
    return;
  }
  try {
    const months = await listSalesSectionMonths(req.accessContext!, territory);
    setNoStore(res);
    res.json({ months });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      setNoStore(res);
      res.status(503).json({ months: [], dataState: "schema_not_ready" });
      return;
    }
    throw error;
  }
}

export async function v3SalesSectionOverviewHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const month = typeof req.query.month === "string" ? req.query.month.trim() : "";
  if (!month) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите month (YYYY-MM)."));
    return;
  }
  const territory = await resolveSalesSectionTerritory(req, res);
  if (!territory) {
    return;
  }
  const overview = await loadSalesSectionOverview(req.accessContext!, month, territory);
  if (overview === "invalid_month") {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный month."));
    return;
  }
  setNoStore(res);
  res.json({ overview });
}

export async function v3SalesSectionSkuHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const month = typeof req.query.month === "string" ? req.query.month.trim() : "";
  const productType = typeof req.query.productType === "string" ? req.query.productType.trim() : "";
  const kind = req.query.kind === "returns" ? "returns" : "sales";
  if (!month || !productType) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите month и productType."));
    return;
  }
  const territory = await resolveSalesSectionTerritory(req, res);
  if (!territory) {
    return;
  }
  const skuQuery = typeof req.query.skuQuery === "string" ? req.query.skuQuery : "";
  const rows = await listSalesSectionSkuRows(
    req.accessContext!,
    territory,
    month,
    productType,
    kind,
    skuQuery,
  );
  if (rows === "invalid_month") {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный month."));
    return;
  }
  if (rows === "no_items_source") {
    res.status(409).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Детализация по товарам недоступна для выбранного периода."));
    return;
  }
  setNoStore(res);
  res.json({
    items: rows,
    fieldPolicy: resolveSalesSectionFieldPolicy(req.accessContext!),
    financeAvailability:
      kind === "returns" ? RETURNS_SOURCE_FINANCE_AVAILABILITY : SALES_SOURCE_FINANCE_AVAILABILITY,
  });
}

async function resolveClientSalesTerritoryStrict(
  req: AccessRequest,
  res: Response,
): Promise<
  | {
      ropBranchGuid?: string;
      responsibleGuid?: string;
      responsibleKind?: V3ResponsibleKind;
      managerGuid?: string;
      teamMemberGuids?: string[];
    }
  | undefined
> {
  const responsibleKindRaw =
    typeof req.query.responsibleKind === "string" ? req.query.responsibleKind.trim() : "";
  if (
    responsibleKindRaw &&
    !["manager", "regional", "hardware"].includes(responsibleKindRaw)
  ) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый responsibleKind."));
    return undefined;
  }
  const teamKindRaw = typeof req.query.teamKind === "string" ? req.query.teamKind.trim() : "";
  if (teamKindRaw && !["manager", "regional", "hardware"].includes(teamKindRaw)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый teamKind."));
    return undefined;
  }
  if (req.query.teamGuid !== undefined) {
    const teamParsed = parseOptionalGuidQuery(req.query.teamGuid);
    if (!teamParsed.ok) {
      setNoStore(res);
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый teamGuid."));
      return undefined;
    }
  }
  return resolveSalesSectionTerritory(req, res);
}

export async function v3ClientSalesMonthsHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const territory = await resolveClientSalesTerritoryStrict(req, res);
  if (!territory) {
    return;
  }
  const result = await listClientSalesMonths(req.accessContext!, territory);
  setNoStore(res);
  res.json(result);
}

export async function v3ClientSalesCardHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const entityRaw = typeof req.query.entity === "string" ? req.query.entity.trim() : "";
  const entity = entityRaw === "holding" || entityRaw === "legal" ? entityRaw : null;
  const guid = parseGuidParam(req.query.guid);
  const month = typeof req.query.month === "string" ? req.query.month.trim() : "";
  if (!entity || !guid || !month) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите entity (holding|legal), guid и month."));
    return;
  }
  if (!parseClientSalesMonthStrict(month).ok) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный month (ожидается YYYY-MM)."));
    return;
  }
  const territory = await resolveClientSalesTerritoryStrict(req, res);
  if (!territory) {
    return;
  }
  const summary = await loadClientSalesCardSummary(req.accessContext!, entity, guid, month, territory);
  if (summary === "invalid_month") {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный month."));
    return;
  }
  if (!summary) {
    notFoundForAccess(res);
    return;
  }
  setNoStore(res);
  res.json({ summary });
}

export async function v3ClientSalesBatchHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const body = req.body as { month?: string; targets?: ClientSalesBatchTarget[] } | undefined;
  const month = typeof body?.month === "string" ? body.month.trim() : "";
  if (!month) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите month (YYYY-MM)."));
    return;
  }
  if (!parseClientSalesMonthStrict(month).ok) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный month (ожидается YYYY-MM)."));
    return;
  }
  const rawTargets = body?.targets;
  const parsedTargets = parseClientSalesBatchTargets(rawTargets);
  if (!parsedTargets.ok) {
    const message =
      parsedTargets.code === "too_many"
        ? `Не более ${CLIENT_SALES_BATCH_MAX_IDS} объектов в одном запросе.`
        : parsedTargets.code === "not_array"
          ? "Укажите targets (массив {kind, guid})."
          : "Некорректный элемент targets: ожидается kind holding|legal и guid UUID.";
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, message));
    return;
  }
  const territory = await resolveClientSalesTerritoryStrict(req, res);
  if (!territory) {
    return;
  }
  const result = await batchClientSalesListSummaries(
    req.accessContext!,
    month,
    parsedTargets.targets,
    territory,
  );
  if (result === "invalid_month") {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный month."));
    return;
  }
  if (result === "batch_too_large") {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Слишком много объектов в batch."));
    return;
  }
  setNoStore(res);
  res.json(result);
}

export async function v3SalesSectionClientsHandler(req: AccessRequest, res: Response): Promise<void> {
  if (!(await requireV3Active(res))) {
    return;
  }
  const month = typeof req.query.month === "string" ? req.query.month.trim() : "";
  const productType = typeof req.query.productType === "string" ? req.query.productType.trim() : "";
  const guidItem = typeof req.query.guidItem === "string" ? req.query.guidItem.trim() : "";
  const kind = req.query.kind === "returns" ? "returns" : "sales";
  if (!month || !productType) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите month и productType."));
    return;
  }
  const territory = await resolveSalesSectionTerritory(req, res);
  if (!territory) {
    return;
  }
  const clientQuery = typeof req.query.clientQuery === "string" ? req.query.clientQuery : "";
  const rows = await listSalesSectionClientRows(
    req.accessContext!,
    territory,
    month,
    productType,
    guidItem || "00000000-0000-4000-8000-000000000000",
    kind,
    clientQuery,
  );
  if (rows === "invalid_month") {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный month."));
    return;
  }
  setNoStore(res);
  res.json({
    clients: rows,
    fieldPolicy: resolveSalesSectionFieldPolicy(req.accessContext!),
    financeAvailability:
      kind === "returns" ? RETURNS_SOURCE_FINANCE_AVAILABILITY : SALES_SOURCE_FINANCE_AVAILABILITY,
  });
}
