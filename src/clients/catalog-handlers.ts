import type { Response } from "express";
import type { AccessRequest } from "../access/middleware";
import {
  CatalogFilterUnavailableError,
  loadCatalogFacets,
} from "../catalog/facets-repository";
import { readReadyImageAssetBytes } from "../catalog/image-sync";
import {
  loadCatalogProductDetail,
  loadCatalogSectionsTree,
  loadCatalogSnapshotMeta,
  listCatalogSections,
  searchCatalogProducts,
} from "../catalog/read-repository";
import {
  parseCatalogProductCode,
  parseCatalogSearchQuery,
  parseCatalogVersionId,
} from "../catalog/query-params";
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

function respondCatalogVersionChanged(
  res: Response,
  currentVersionId: string,
  importedAt: string | null,
): void {
  setNoStore(res);
  res.status(409).json({
    code: "CATALOG_VERSION_CHANGED",
    message: "Каталог обновился после открытия списка. Обновите данные и повторите выбор.",
    currentVersionId,
    importedAt,
  });
}

function respondCatalogFilterUnavailable(res: Response, filters: string[]): void {
  setNoStore(res);
  res.status(422).json({
    code: "CATALOG_FILTER_UNAVAILABLE",
    message: "Выбранный фильтр недоступен в текущем снимке каталога.",
    filters,
  });
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
        "Просмотр каталога. Сохранение дистрибуции станет доступно после подключения торговой точки.",
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
    q: req.query.q,
    section: req.query.section,
    page: req.query.page,
    pageSize: req.query.pageSize,
    filterBrand: req.query.filterBrand,
    filterSeries: req.query.filterSeries,
    filterColor: req.query.filterColor,
    filterCoating: req.query.filterCoating,
    filterOpening: req.query.filterOpening,
    filterArticle: req.query.filterArticle,
  });
  if (!parsed.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, parsed.message));
    return;
  }

  const versionParsed = parseCatalogVersionId(req.query.versionId);
  if (!versionParsed.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, versionParsed.message));
    return;
  }
  const expectedVersionId = versionParsed.value;

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

    if (expectedVersionId && expectedVersionId !== meta.versionId) {
      respondCatalogVersionChanged(res, meta.versionId, meta.importedAt);
      return;
    }

    try {
      const result = await searchCatalogProducts(client, meta.versionId, parsed.value);
      setNoStore(res);
      res.status(200).json({
        state: "ready",
        ...result,
      });
    } catch (error) {
      if (error instanceof CatalogFilterUnavailableError) {
        respondCatalogFilterUnavailable(res, error.filters);
        return;
      }
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function getClientCatalogSectionsTreeHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  if (!(await assertClientCatalogAccess(req, res, cardGuid))) return;

  const versionParsed = parseCatalogVersionId(req.query.versionId);
  if (!versionParsed.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, versionParsed.message));
    return;
  }
  const expectedVersionId = versionParsed.value;

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
      res.status(200).json({ state: "empty", versionId: null, tree: [] });
      return;
    }
    if (expectedVersionId && expectedVersionId !== meta.versionId) {
      respondCatalogVersionChanged(res, meta.versionId, meta.importedAt);
      return;
    }
    const tree = await loadCatalogSectionsTree(client, meta.versionId);
    setNoStore(res);
    res.status(200).json({ state: "ready", versionId: meta.versionId, tree });
  } finally {
    client.release();
  }
}

export async function getClientCatalogFacetsHandler(req: AccessRequest, res: Response): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  if (!(await assertClientCatalogAccess(req, res, cardGuid))) return;

  const parsed = parseCatalogSearchQuery({
    q: req.query.q,
    section: req.query.section,
    page: req.query.page,
    pageSize: req.query.pageSize,
    filterBrand: req.query.filterBrand,
    filterSeries: req.query.filterSeries,
    filterColor: req.query.filterColor,
    filterCoating: req.query.filterCoating,
    filterOpening: req.query.filterOpening,
    filterArticle: req.query.filterArticle,
  });
  if (!parsed.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, parsed.message));
    return;
  }

  const versionParsed = parseCatalogVersionId(req.query.versionId);
  if (!versionParsed.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, versionParsed.message));
    return;
  }
  const expectedVersionId = versionParsed.value;

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
        versionId: null,
        total: 0,
        facets: [],
        availableFilters: [],
      });
      return;
    }
    if (expectedVersionId && expectedVersionId !== meta.versionId) {
      respondCatalogVersionChanged(res, meta.versionId, meta.importedAt);
      return;
    }
    try {
      const facets = await loadCatalogFacets(client, meta.versionId, parsed.value);
      setNoStore(res);
      res.status(200).json({ state: "ready", ...facets });
    } catch (error) {
      if (error instanceof CatalogFilterUnavailableError) {
        respondCatalogFilterUnavailable(res, error.filters);
        return;
      }
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function getClientCatalogMediaHandler(req: AccessRequest, res: Response): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  if (!(await assertClientCatalogAccess(req, res, cardGuid))) return;

  const assetId = String(req.params.assetId ?? "").trim();
  if (!isValidUuidParam(assetId)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid image id."));
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
    const image = await readReadyImageAssetBytes(client, assetId);
    if (!image) {
      setNoStore(res);
      res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Image not found."));
      return;
    }
    setNoStore(res);
    res.setHeader("Content-Type", image.mimeType);
    res.setHeader("Content-Length", String(image.buffer.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(image.buffer);
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

  const versionParsed = parseCatalogVersionId(req.query.versionId);
  if (!versionParsed.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, versionParsed.message));
    return;
  }
  const expectedVersionId = versionParsed.value;

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
      respondCatalogVersionChanged(res, meta.versionId, meta.importedAt);
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
        "Просмотр каталога. Сохранение дистрибуции станет доступно после подключения торговой точки.",
    });
  } finally {
    client.release();
  }
}
