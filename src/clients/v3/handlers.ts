import type { Response } from "express";
import type { AccessRequest } from "../../access/middleware";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { isValidUuidParam } from "../uuid-param";
import { listV3Entities, isExchangeV3Active, type V3ListEntity } from "./list";
import {
  getV3HoldingComposition,
  getV3HoldingDetail,
  getV3LegalDetail,
  getV3RetailDetail,
  type V3DetailEntity,
} from "./detail";

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
  const result = await listV3Entities(context, {
    entity: entityRaw as V3ListEntity,
    page,
    pageSize,
    q,
    closed,
    managerGuid: managerGuid ?? undefined,
    typeGuid: typeGuid || undefined,
    categoryGuid: categoryGuid || undefined,
  });
  setNoStore(res);
  res.json({ entity: entityRaw, page, pageSize, total: result.total, items: result.items });
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
  const composition = await getV3HoldingComposition(req.accessContext!, guid);
  if (composition.access === "unknown" || composition.access === "withheld") {
    notFoundForAccess(res);
    return;
  }
  setNoStore(res);
  res.json(composition);
}
