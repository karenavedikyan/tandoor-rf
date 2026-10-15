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

const LIST_ENTITIES = new Set<V3ListEntity>(["holdings", "legal", "retail", "orphan_retail"]);
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

function notFoundForAccess(res: Response): void {
  setNoStore(res);
  res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Объект не найден."));
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
  const result = await listV3Entities(context, {
    entity: entityRaw as V3ListEntity,
    page,
    pageSize,
    q,
    closed,
    managerGuid: managerGuid ?? undefined,
    responsibleGuid: responsibleGuid ?? undefined,
    responsibleKind,
    ropBranchGuid: ropBranchGuid ?? undefined,
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
  const summary = await loadV3ScopeSummary(req.accessContext!, {
    ropBranchGuid: ropBranchGuid ?? undefined,
    responsibleGuid: responsibleGuid ?? undefined,
    responsibleKind,
    managerGuid: managerGuid ?? undefined,
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
  for (const key of ["managerGuid", "responsibleGuid", "ropBranchGuid"] as const) {
    if (req.query[key] !== undefined && !parseGuidParam(req.query[key])) {
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимая территория."));
      return;
    }
  }
  if (req.query.responsibleGuid && !kind) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый responsibleKind."));
    return;
  }
  const options = await loadV3FilterOptions(req.accessContext!, entityRaw as V3ListEntity, {
    managerGuid: parseGuidParam(req.query.managerGuid) ?? undefined,
    responsibleGuid: parseGuidParam(req.query.responsibleGuid) ?? undefined,
    responsibleKind: kind,
    ropBranchGuid: parseGuidParam(req.query.ropBranchGuid) ?? undefined,
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
    const items = await listV3RopResponsibles(req.accessContext!, ropGuid);
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
