import express, { type Request, type Response } from "express";
import { requireAdmin } from "../middleware/require-admin";
import { requireAuth } from "../middleware/auth";
import { requireDatabaseReady } from "../middleware/database";
import { setNoStore } from "../http/no-store";
import { runTanbotMaxProbe } from "./probe";

function parseLiveQuery(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseTlsProbeQuery(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function tanbotMaxDiagnosticsHandler(req: Request, res: Response): Promise<void> {
  const live = parseLiveQuery(req.query.live);
  const tlsProbe = parseTlsProbeQuery(req.query.tls_probe);
  const report = await runTanbotMaxProbe({ live, tlsProbe, env: process.env });
  setNoStore(res);
  res.status(200).json(report);
}

export function createTanbotMaxAdminRouter(): express.Router {
  const router = express.Router();
  const adminChain = [requireDatabaseReady, requireAuth, requireAdmin] as const;
  router.get("/diagnostics", ...adminChain, (req, res, next) => {
    void tanbotMaxDiagnosticsHandler(req, res).catch(next);
  });
  return router;
}
