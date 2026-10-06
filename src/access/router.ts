import express from "express";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/require-admin";
import { requireDatabaseReady } from "../middleware/database";
import { csrfProtection } from "../middleware/csrf";
import {
  accessExplainHandler,
  approveDelegationChangeHandler,
  approveDelegationHandler,
  coordinatorManagersHandler,
  createDelegationHandler,
  createCoordinatorTeamHandler,
  delegationDetailHandler,
  delegatorClientsHandler,
  createDenialHandler,
  createEmployeeLinkHandler,
  createGrantHandler,
  createRopTeamHandler,
  proposeDelegationChangeHandler,
  revokeCoordinatorTeamHandler,
  revokeDenialHandler,
  revokeDelegationHandler,
  revokeEmployeeLinkHandler,
  revokeGrantHandler,
  revokeRopTeamHandler,
  ropTeamMembersHandler,
  scopedOverviewHandler,
  searchAssistantsHandler,
  searchUsersHandler,
  submitDelegationHandler,
} from "./handlers";
import {
  previewCandidatesHandler,
  previewStartHandler,
  previewStateHandler,
  previewStopHandler,
} from "./preview-handlers";
import { listAccessOverview } from "./admin-repository";
import { requireAnyRole } from "./role-middleware";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth";
import { setNoStore } from "../http/no-store";

async function adminOverviewHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const overview = await listAccessOverview();
  setNoStore(res);
  res.status(200).json(overview);
}

export function createAccessAdminRouter(): express.Router {
  const router = express.Router();
  const adminChain = [requireDatabaseReady, requireAuth, requireAdmin] as const;

  router.get("/overview", ...adminChain, (req, res, next) => {
    void adminOverviewHandler(req, res).catch(next);
  });

  router.get("/explain", ...adminChain, (req, res, next) => {
    void accessExplainHandler(req, res).catch(next);
  });

  router.get("/users/search", ...adminChain, (req, res, next) => {
    void searchUsersHandler(req, res).catch(next);
  });

  router.get("/preview", ...adminChain, (req, res, next) => {
    void previewStateHandler(req, res).catch(next);
  });

  router.get("/preview/candidates", ...adminChain, (req, res, next) => {
    void previewCandidatesHandler(req, res).catch(next);
  });

  router.post("/preview/start", csrfProtection, ...adminChain, (req, res, next) => {
    void previewStartHandler(req, res).catch(next);
  });

  router.post("/preview/stop", csrfProtection, ...adminChain, (req, res, next) => {
    void previewStopHandler(req, res).catch(next);
  });

  router.post("/employee-links", csrfProtection, ...adminChain, (req, res, next) => {
    void createEmployeeLinkHandler(req, res).catch(next);
  });

  router.post("/employee-links/:linkId/revoke", csrfProtection, ...adminChain, (req, res, next) => {
    void revokeEmployeeLinkHandler(req, res).catch(next);
  });

  router.post("/grants", csrfProtection, ...adminChain, (req, res, next) => {
    void createGrantHandler(req, res).catch(next);
  });

  router.post("/grants/:grantId/revoke", csrfProtection, ...adminChain, (req, res, next) => {
    void revokeGrantHandler(req, res).catch(next);
  });

  router.post("/rop-teams", csrfProtection, ...adminChain, (req, res, next) => {
    void createRopTeamHandler(req, res).catch(next);
  });

  router.post("/rop-teams/:teamMemberId/revoke", csrfProtection, ...adminChain, (req, res, next) => {
    void revokeRopTeamHandler(req, res).catch(next);
  });

  router.post("/denials", csrfProtection, ...adminChain, (req, res, next) => {
    void createDenialHandler(req, res).catch(next);
  });

  router.post("/denials/:denialId/revoke", csrfProtection, ...adminChain, (req, res, next) => {
    void revokeDenialHandler(req, res).catch(next);
  });

  router.post(
    "/delegations/:delegationId/record-approval",
    csrfProtection,
    ...adminChain,
    (req, res, next) => {
      void approveDelegationHandler(req, res).catch(next);
    },
  );

  router.post("/coordinator-teams", csrfProtection, ...adminChain, (req, res, next) => {
    void createCoordinatorTeamHandler(req, res).catch(next);
  });

  router.post(
    "/coordinator-teams/:assignmentId/revoke",
    csrfProtection,
    ...adminChain,
    (req, res, next) => {
      void revokeCoordinatorTeamHandler(req, res).catch(next);
    },
  );

  return router;
}

export function createAccessRouter(): express.Router {
  const router = express.Router();
  const authChain = [requireDatabaseReady, requireAuth] as const;

  router.get(
    "/overview",
    ...authChain,
    requireAnyRole(["manager", "rop", "coordinator", "director"]),
    (req, res, next) => {
      void scopedOverviewHandler(req, res).catch(next);
    },
  );

  router.get(
    "/explain",
    ...authChain,
    requireAnyRole(["rop", "director", "manager"]),
    (req, res, next) => {
      void accessExplainHandler(req, res).catch(next);
    },
  );

  router.get(
    "/assistants/search",
    ...authChain,
    requireAnyRole(["manager", "rop", "coordinator", "director"]),
    (req, res, next) => {
      void searchAssistantsHandler(req, res).catch(next);
    },
  );

  router.get(
    "/team-members",
    ...authChain,
    requireAnyRole(["rop"]),
    (req, res, next) => {
      void ropTeamMembersHandler(req, res).catch(next);
    },
  );

  router.get(
    "/coordinator-managers",
    ...authChain,
    requireAnyRole(["coordinator"]),
    (req, res, next) => {
      void coordinatorManagersHandler(req, res).catch(next);
    },
  );

  router.get(
    "/delegators/:delegatorUserId/clients",
    ...authChain,
    requireAnyRole(["manager", "rop", "coordinator"]),
    (req, res, next) => {
      void delegatorClientsHandler(req, res).catch(next);
    },
  );

  router.get(
    "/delegations/:delegationId",
    ...authChain,
    requireAnyRole(["manager", "rop", "coordinator", "director"]),
    (req, res, next) => {
      void delegationDetailHandler(req, res).catch(next);
    },
  );

  router.post(
    "/delegations",
    csrfProtection,
    ...authChain,
    requireAnyRole(["manager", "rop", "coordinator", "admin"]),
    (req, res, next) => {
      void createDelegationHandler(req, res).catch(next);
    },
  );

  router.post(
    "/delegations/:delegationId/submit",
    csrfProtection,
    ...authChain,
    requireAnyRole(["manager", "rop", "coordinator"]),
    (req, res, next) => {
      void submitDelegationHandler(req, res).catch(next);
    },
  );

  router.post(
    "/delegations/:delegationId/approve",
    csrfProtection,
    ...authChain,
    requireAnyRole(["rop", "director"]),
    (req, res, next) => {
      void approveDelegationHandler(req, res).catch(next);
    },
  );

  router.post(
    "/delegations/:delegationId/revoke",
    csrfProtection,
    ...authChain,
    requireAnyRole(["manager", "rop", "coordinator", "director"]),
    (req, res, next) => {
      void revokeDelegationHandler(req, res).catch(next);
    },
  );

  router.post(
    "/delegations/:delegationId/change-requests",
    csrfProtection,
    ...authChain,
    requireAnyRole(["manager", "rop", "coordinator"]),
    (req, res, next) => {
      void proposeDelegationChangeHandler(req, res).catch(next);
    },
  );

  router.post(
    "/delegations/change-requests/:changeRequestId/approve",
    csrfProtection,
    ...authChain,
    requireAnyRole(["rop", "director"]),
    (req, res, next) => {
      void approveDelegationChangeHandler(req, res).catch(next);
    },
  );

  return router;
}
