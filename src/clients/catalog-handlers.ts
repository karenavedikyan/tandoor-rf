import type { Response } from "express";
import type { AccessRequest } from "../access/middleware";
import {
  loadCatalogProductDetail,
  loadCatalogSnapshotMeta,
  listCatalogSections,
  searchCatalogProducts,
} from "../catalog/read-repository";
import { parseCatalogProductCode, parseCatalogSearchQuery } from "../catalog/query-params";
import { setNoStore } from "../http/no-store";
import { getPool } from "../db/pool";
import { apiError, ERROR_CODES } from "../shared/errors";
import { isValidUuidParam } from "./uuid-param";
import { canReadClientGuid } from "./repository";

async function assertClientCatalogAccess(
  req: AccessRequest,
  res: Response,
  cardGuid: string,
): Promise<boolean> {
  if (!isValidUuidParam(cardGuid)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid client id."));
    return false;
  }
  const allowed = await canReadClientGuid(req.accessContext!, cardGuid);
  if (!allowed) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Client not found."));
    return false;
  }
  return true;
}

export async function getClientCatalogMetaHandler(req: AccessRequest, res: Response): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  if (!(await assertClientCatalogAccess(req, res, cardGuid))) return;

  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Database unavailable."));
    return;
  }
  const client = await pool.connect();
  try {
    const meta = await loadCatalogSnapshotMeta(client);
    const sections =
      meta.versionId !== null ? await listCatalogSections(client, meta.versionId) : [];
    setNoStore(res);
    res.status(200).json({
      ...meta,
      sections,
      outletConfirmed: false,
      futureActionsBlockedReason:
        "Подтверждённая торговая точка ещё не подключена: сохранение факта установки и плана будет доступно на этапе R3.3.",
    });
  } finally {
    client.release();
  }
}

export async function getClientCatalogProductsHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  if (!(await assertClientCatalogAccess(req, res, cardGuid))) return;

  const parsed = parseCatalogSearchQuery({
    q: typeof req.query.q === "string" ? req.query.q : undefined,
    section: typeof req.query.section === "string" ? req.query.section : undefined,
    page: typeof req.query.page === "string" ? req.query.page : undefined,
    pageSize: typeof req.query.pageSize === "string" ? req.query.pageSize : undefined,
  });
  if (!parsed.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, parsed.message));
    return;
  }

  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Database unavailable."));
    return;
  }
  const client = await pool.connect();
  try {
    const meta = await loadCatalogSnapshotMeta(client);
    if (meta.state !== "ready" || !meta.versionId) {
      setNoStore(res);
      res.status(200).json({
        state: "empty",
        message: meta.message ?? "Активный каталог не импортирован.",
        versionId: null,
        query: parsed.value.q,
        sectionCode: parsed.value.sectionCode,
        page: parsed.value.page,
        pageSize: parsed.value.pageSize,
        total: 0,
        items: [],
      });
      return;
    }

    const result = await searchCatalogProducts(client, meta.versionId, parsed.value);
    setNoStore(res);
    res.status(200).json({
      state: "ready",
      ...result,
    });
  } finally {
    client.release();
  }
}

export async function getClientCatalogProductHandler(req: AccessRequest, res: Response): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  if (!(await assertClientCatalogAccess(req, res, cardGuid))) return;

  const productCode = parseCatalogProductCode(req.params.productCode);
  if (!productCode) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid product code."));
    return;
  }

  const expectedVersionId =
    typeof req.query.versionId === "string" && isValidUuidParam(req.query.versionId)
      ? req.query.versionId
      : null;

  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Database unavailable."));
    return;
  }
  const client = await pool.connect();
  try {
    const meta = await loadCatalogSnapshotMeta(client);
    if (meta.state !== "ready" || !meta.versionId) {
      setNoStore(res);
      res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Catalog product not found."));
      return;
    }

    if (expectedVersionId && expectedVersionId !== meta.versionId) {
      setNoStore(res);
      res.status(409).json({
        code: "CATALOG_VERSION_CHANGED",
        message: "Каталог обновился после открытия списка. Обновите данные и повторите выбор.",
        currentVersionId: meta.versionId,
        importedAt: meta.importedAt,
      });
      return;
    }

    const detail = await loadCatalogProductDetail(client, meta.versionId, productCode);
    if (!detail) {
      setNoStore(res);
      if (expectedVersionId) {
        res.status(409).json({
          code: "CATALOG_PRODUCT_UNAVAILABLE",
          message: "Выбранный товар недоступен в текущем снимке каталога.",
          currentVersionId: meta.versionId,
          importedAt: meta.importedAt,
        });
        return;
      }
      res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Catalog product not found."));
      return;
    }

    setNoStore(res);
    res.status(200).json({
      state: "ready",
      product: detail,
      outletConfirmed: false,
      selectionPersisted: false,
      futureActionsBlockedReason:
        "Выбор товара доступен для просмотра. Сохранение факта установки или плана потребует подтверждённой торговой точки (R3.3).",
    });
  } finally {
    client.release();
  }
}
