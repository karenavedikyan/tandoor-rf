import type { Response } from "express";
import type { AccessRequest } from "../../access/middleware";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { listV3Entities, isExchangeV3Active, type V3ListEntity } from "./list";

const ENTITIES = new Set<V3ListEntity>(["holdings", "legal", "retail", "orphan_retail"]);

export async function v3ClientsListHandler(req: AccessRequest, res: Response): Promise<void> {
  setNoStore(res);
  const active = await isExchangeV3Active();
  if (!active) {
    res.status(503).json(apiError("EXCHANGE_V3_NOT_ACTIVE", "Данные exchange v3 ещё не загружены."));
    return;
  }
  const context = req.accessContext!;
  const entityRaw = String(req.query.entity ?? "legal");
  if (!ENTITIES.has(entityRaw as V3ListEntity)) {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Недопустимый entity."));
    return;
  }
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 50)));
  const q = String(req.query.q ?? "");
  const result = await listV3Entities(context, {
    entity: entityRaw as V3ListEntity,
    page,
    pageSize,
    q,
  });
  res.json({ entity: entityRaw, page, pageSize, total: result.total, items: result.items });
}
