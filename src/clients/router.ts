import express from "express";
import {
  attachAccessContext,
  requireClientReadAccess,
} from "../access/middleware";
import { csrfProtection } from "../middleware/csrf";
import { requireAuth } from "../middleware/auth";
import { requireDatabaseReady } from "../middleware/database";
import {
  getClientCatalogFacetValuesHandler,
  getClientCatalogFacetsHandler,
  getClientCatalogMediaHandler,
  getClientCatalogMetaHandler,
  getClientCatalogProductHandler,
  getClientCatalogProductsHandler,
  getClientCatalogSectionsTreeHandler,
} from "./catalog-handlers";
import {
  getClientCatalogOutletDistributionHandler,
  getClientCatalogOutletsHandler,
  postClientCatalogOutletDistributionMarkerHandler,
} from "./outlet-distribution-handlers";
import {
  getClientBitrix24ClaimsHandler,
  getClientBitrix24LabelHandler,
  getClientBitrix24TasksHandler,
  postClientBitrix24LabelHandler,
  postClientBitrix24SyncHandler,
  putClientBitrix24TaskContactHandler,
} from "./bitrix24-handlers";
import {
  clientOptionsHandler,
  clientSyncStatusHandler,
  getClientHandler,
  listClientsHandler,
} from "./handlers";

export function createClientsRouter(): express.Router {
  const router = express.Router();

  const readChain = [
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    requireClientReadAccess,
  ] as const;

  router.get("/sync-status", ...readChain, (req, res, next) => {
    void clientSyncStatusHandler(req, res).catch(next);
  });

  router.get("/options", ...readChain, (req, res, next) => {
    void clientOptionsHandler(req, res).catch(next);
  });

  router.get("/", ...readChain, (req, res, next) => {
    void listClientsHandler(req, res).catch(next);
  });

  router.get("/:guid/catalog/meta", ...readChain, (req, res, next) => {
    void getClientCatalogMetaHandler(req, res).catch(next);
  });

  router.get("/:guid/catalog/products", ...readChain, (req, res, next) => {
    void getClientCatalogProductsHandler(req, res).catch(next);
  });

  router.get("/:guid/catalog/products/:productCode", ...readChain, (req, res, next) => {
    void getClientCatalogProductHandler(req, res).catch(next);
  });

  router.get("/:guid/catalog/sections-tree", ...readChain, (req, res, next) => {
    void getClientCatalogSectionsTreeHandler(req, res).catch(next);
  });

  router.get("/:guid/catalog/facets", ...readChain, (req, res, next) => {
    void getClientCatalogFacetsHandler(req, res).catch(next);
  });

  router.get("/:guid/catalog/facet-values", ...readChain, (req, res, next) => {
    void getClientCatalogFacetValuesHandler(req, res).catch(next);
  });

  router.get("/:guid/catalog/media/:assetId", ...readChain, (req, res, next) => {
    void getClientCatalogMediaHandler(req, res).catch(next);
  });

  router.get("/:guid/catalog/outlets", ...readChain, (req, res, next) => {
    void getClientCatalogOutletsHandler(req, res).catch(next);
  });

  router.get("/:guid/catalog/outlets/:storeGuid/distribution", ...readChain, (req, res, next) => {
    void getClientCatalogOutletDistributionHandler(req, res).catch(next);
  });

  router.post(
    "/:guid/catalog/outlets/:storeGuid/distribution/markers",
    csrfProtection,
    ...readChain,
    (req, res, next) => {
      void postClientCatalogOutletDistributionMarkerHandler(req, res).catch(next);
    },
  );

  router.get("/:guid/bitrix24/label", ...readChain, (req, res, next) => {
    void getClientBitrix24LabelHandler(req, res).catch(next);
  });

  router.post("/:guid/bitrix24/label", csrfProtection, ...readChain, (req, res, next) => {
    void postClientBitrix24LabelHandler(req, res).catch(next);
  });

  router.get("/:guid/bitrix24/tasks", ...readChain, (req, res, next) => {
    void getClientBitrix24TasksHandler(req, res).catch(next);
  });

  router.get("/:guid/bitrix24/claims", ...readChain, (req, res, next) => {
    void getClientBitrix24ClaimsHandler(req, res).catch(next);
  });

  router.post("/:guid/bitrix24/sync", csrfProtection, ...readChain, (req, res, next) => {
    void postClientBitrix24SyncHandler(req, res).catch(next);
  });

  router.put("/:guid/bitrix24/tasks/:taskId/contact", csrfProtection, ...readChain, (req, res, next) => {
    void putClientBitrix24TaskContactHandler(req, res).catch(next);
  });

  router.get("/:guid", ...readChain, (req, res, next) => {
    void getClientHandler(req, res).catch(next);
  });

  return router;
}
