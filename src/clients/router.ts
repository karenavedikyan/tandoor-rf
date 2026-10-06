import express from "express";
import {
  attachAccessContext,
  blockPreviewWrites,
  requireClientReadAccess,
} from "../access/middleware";
import { csrfProtection } from "../middleware/csrf";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/require-admin";
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
import { clientsPresentationHandler } from "./presentation-handlers";
import { listWholesaleEmployeesHandler } from "./wholesale-employees-handlers";
import {
  eligibleReviewManagersHandler,
  eligibleReviewersHandler,
  getClientReviewHandler,
  listClientReviewHistoryHandler,
  reviewOptionsHandler,
  upsertClientReviewHandler,
} from "./review/handlers";
import {
  completenessQueueHandler,
  orgRopResponsiblesHandler,
  orgStructureOverviewHandler,
} from "./org/handlers";
import { listTeamManagersHandler, listTeamRopsHandler } from "./teams/handlers";
import { unassignedSummaryHandler } from "./unassigned/handlers";

export function createClientsRouter(): express.Router {
  const router = express.Router();

  const readChain = [
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    requireClientReadAccess,
  ] as const;

  const writeChain = [
    requireDatabaseReady,
    requireAuth,
    attachAccessContext,
    blockPreviewWrites,
    requireClientReadAccess,
  ] as const;

  router.get("/sync-status", ...readChain, (req, res, next) => {
    void clientSyncStatusHandler(req, res).catch(next);
  });

  router.get("/options", ...readChain, (req, res, next) => {
    void clientOptionsHandler(req, res).catch(next);
  });

  router.get("/presentation", ...readChain, (req, res, next) => {
    void clientsPresentationHandler(req, res).catch(next);
  });

  router.get("/org-structure", ...readChain, (req, res, next) => {
    void orgStructureOverviewHandler(req, res).catch(next);
  });

  router.get("/org-structure/:ropEmployeeGuid/responsibles", ...readChain, (req, res, next) => {
    void orgRopResponsiblesHandler(req, res).catch(next);
  });

  router.get("/completeness-queue", ...readChain, (req, res, next) => {
    void completenessQueueHandler(req, res).catch(next);
  });

  router.get("/teams", ...readChain, (req, res, next) => {
    void listTeamRopsHandler(req, res).catch(next);
  });

  router.get("/teams/:ropUserId/managers", ...readChain, (req, res, next) => {
    void listTeamManagersHandler(req, res).catch(next);
  });

  router.get("/unassigned/summary", ...readChain, (req, res, next) => {
    void unassignedSummaryHandler(req, res).catch(next);
  });

  router.get("/review/options", ...readChain, (req, res, next) => {
    void reviewOptionsHandler(req, res).catch(next);
  });

  router.get("/review/eligible-managers", ...readChain, (req, res, next) => {
    void eligibleReviewManagersHandler(req, res).catch(next);
  });

  router.get("/review/eligible-reviewers", ...readChain, (req, res, next) => {
    void eligibleReviewersHandler(req, res).catch(next);
  });

  router.get("/", ...readChain, (req, res, next) => {
    void listClientsHandler(req, res).catch(next);
  });

  router.get("/wholesale-employees", requireDatabaseReady, requireAuth, requireAdmin, (req, res, next) => {
    void listWholesaleEmployeesHandler(req, res).catch(next);
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
    ...writeChain,
    (req, res, next) => {
      void postClientCatalogOutletDistributionMarkerHandler(req, res).catch(next);
    },
  );

  router.get("/:guid/bitrix24/label", ...readChain, (req, res, next) => {
    void getClientBitrix24LabelHandler(req, res).catch(next);
  });

  router.post("/:guid/bitrix24/label", csrfProtection, ...writeChain, (req, res, next) => {
    void postClientBitrix24LabelHandler(req, res).catch(next);
  });

  router.get("/:guid/bitrix24/tasks", ...readChain, (req, res, next) => {
    void getClientBitrix24TasksHandler(req, res).catch(next);
  });

  router.get("/:guid/bitrix24/claims", ...readChain, (req, res, next) => {
    void getClientBitrix24ClaimsHandler(req, res).catch(next);
  });

  router.post("/:guid/bitrix24/sync", csrfProtection, ...writeChain, (req, res, next) => {
    void postClientBitrix24SyncHandler(req, res).catch(next);
  });

  router.put(
    "/:guid/bitrix24/tasks/:taskId/contact",
    csrfProtection,
    ...writeChain,
    (req, res, next) => {
      void putClientBitrix24TaskContactHandler(req, res).catch(next);
    },
  );

  router.get("/:guid/review/history", ...readChain, (req, res, next) => {
    void listClientReviewHistoryHandler(req, res).catch(next);
  });

  router.get("/:guid/review", ...readChain, (req, res, next) => {
    void getClientReviewHandler(req, res).catch(next);
  });

  router.put("/:guid/review", csrfProtection, ...writeChain, (req, res, next) => {
    void upsertClientReviewHandler(req, res).catch(next);
  });

  router.get("/:guid", ...readChain, (req, res, next) => {
    void getClientHandler(req, res).catch(next);
  });

  return router;
}
