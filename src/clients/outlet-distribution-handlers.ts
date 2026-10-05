import type { Response } from "express";
import type { AccessRequest } from "../access/middleware";
import { loadCatalogSnapshotMeta } from "../catalog/read-repository";
import { parseCatalogVersionId } from "../catalog/query-params";
import { getPool } from "../db/pool";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { canReadClientGuid } from "./repository";
import { canAccessRetailOutletGuid, listAccessibleOutletGuidsForClient } from "./outlet-scope";
import {
  assertOutletBelongsToClient,
  assertOutletDistributionWritable,
  lockOutletDistributionContext,
  loadOutletDistributionOptions,
} from "./outlet-distribution-readiness";
import {
  clearDistributionMarker,
  listDistributionMarkers,
  type DistributionMarkerKind,
  upsertDistributionMarker,
} from "./outlet-distribution-repository";
import { isValidUuidParam } from "./uuid-param";

async function assertOutletReadable(
  req: AccessRequest,
  res: Response,
  cardGuid: string,
  storeGuid: string,
): Promise<boolean> {
  if (!(await canAccessRetailOutletGuid(req.accessContext!, cardGuid, storeGuid))) {
    setNoStore(res);
    res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, "Outlet not found."));
    return false;
  }
  return true;
}

async function assertClientAccess(
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

function parseStoreGuid(value: string, res: Response): string | null {
  if (!isValidUuidParam(value)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid outlet id."));
    return null;
  }
  return value;
}

function parseMarkerKind(value: unknown): DistributionMarkerKind | null {
  if (value === "installed" || value === "planned") return value;
  return null;
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

export async function getClientCatalogOutletsHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  if (!(await assertClientAccess(req, res, cardGuid))) return;

  const pool = getPool();
  if (!pool) {
    setNoStore(res);
    res.status(503).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Database unavailable."));
    return;
  }
  const client = await pool.connect();
  try {
    const accessible = await listAccessibleOutletGuidsForClient(req.accessContext!, cardGuid);
    const outlets = await loadOutletDistributionOptions(client, cardGuid, accessible);
    setNoStore(res);
    res.status(200).json({ outlets });
  } finally {
    client.release();
  }
}

export async function getClientCatalogOutletDistributionHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  const storeGuid = parseStoreGuid(String(req.params.storeGuid ?? ""), res);
  if (
    !storeGuid ||
    !(await assertClientAccess(req, res, cardGuid)) ||
    !(await assertOutletReadable(req, res, cardGuid, storeGuid))
  ) {
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
    if (!(await assertOutletBelongsToClient(client, cardGuid, storeGuid))) {
      setNoStore(res);
      res.status(404).json({
        code: "OUTLET_NOT_FOUND",
        message: "Торговая точка не найдена для выбранного клиента.",
      });
      return;
    }
    const meta = await loadCatalogSnapshotMeta(client);
    const installed = await listDistributionMarkers(client, {
      storeGuid,
      markerKind: "installed",
      activeCatalogVersionId: meta.versionId,
    });
    const planned = await listDistributionMarkers(client, {
      storeGuid,
      markerKind: "planned",
      activeCatalogVersionId: meta.versionId,
    });
    setNoStore(res);
    res.status(200).json({
      storeGuid,
      installed,
      planned,
      selectionPersisted: installed.length + planned.length > 0,
    });
  } finally {
    client.release();
  }
}

export async function postClientCatalogOutletDistributionMarkerHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const cardGuid = String(req.params.guid ?? "");
  const storeGuid = parseStoreGuid(String(req.params.storeGuid ?? ""), res);
  if (
    !storeGuid ||
    !(await assertClientAccess(req, res, cardGuid)) ||
    !(await assertOutletReadable(req, res, cardGuid, storeGuid))
  ) {
    return;
  }

  const action = req.body?.action;
  const markerKind = parseMarkerKind(req.body?.markerKind);
  const productCode =
    typeof req.body?.productCode === "string" ? req.body.productCode.trim() : "";
  const versionParsed = parseCatalogVersionId(req.body?.versionId);

  if (action !== "set" && action !== "clear") {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid marker action."));
    return;
  }
  if (!markerKind) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Invalid marker kind."));
    return;
  }
  if (!productCode) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Product code is required."));
    return;
  }
  if (!versionParsed.ok) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, versionParsed.message));
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
    await client.query("BEGIN");
    const locked = await lockOutletDistributionContext(client, cardGuid, storeGuid);
    if (!locked.ok) {
      await client.query("ROLLBACK");
      setNoStore(res);
      res.status(404).json({
        code: locked.code,
        message: locked.message,
      });
      return;
    }
    const writable = await assertOutletDistributionWritable(client, cardGuid, storeGuid);
    if (!writable.ok) {
      await client.query("ROLLBACK");
      setNoStore(res);
      res.status(writable.code === "OUTLET_NOT_FOUND" ? 404 : 422).json({
        code: writable.code,
        message: writable.message,
      });
      return;
    }

    const meta = await loadCatalogSnapshotMeta(client);
    if (meta.state !== "ready" || !meta.versionId) {
      await client.query("ROLLBACK");
      setNoStore(res);
      res.status(422).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Catalog is not ready."));
      return;
    }
    if (versionParsed.value !== meta.versionId) {
      await client.query("ROLLBACK");
      respondCatalogVersionChanged(res, meta.versionId, meta.importedAt);
      return;
    }

    if (action === "set") {
      const product = await client.query<{ code: string }>(
        `SELECT code FROM onec_catalog_products WHERE version_id = $1::uuid AND code = $2 LIMIT 1`,
        [meta.versionId, productCode],
      );
      if (!product.rows[0]) {
        await client.query("ROLLBACK");
        setNoStore(res);
        res.status(404).json({
          code: "CATALOG_PRODUCT_UNAVAILABLE",
          message: "Выбранный товар недоступен в текущем снимке каталога.",
          currentVersionId: meta.versionId,
          importedAt: meta.importedAt,
        });
        return;
      }
    }

    const actorUserId = req.accessContext!.userId;
    const result =
      action === "set"
        ? await upsertDistributionMarker(client, {
            storeGuid,
            cardGuid,
            productCode,
            markerKind,
            actorUserId,
            catalogVersionId: meta.versionId,
          })
        : await clearDistributionMarker(client, {
            storeGuid,
            cardGuid,
            productCode,
            markerKind,
            actorUserId,
            catalogVersionId: meta.versionId,
          });

    await client.query("COMMIT");
    setNoStore(res);
    res.status(200).json({
      ok: true,
      changed: result.changed,
      storeGuid,
      productCode,
      markerKind,
      action,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    setNoStore(res);
    res.status(500).json(apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Failed to save distribution marker."));
  } finally {
    client.release();
  }
}
