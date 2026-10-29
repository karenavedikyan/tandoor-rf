import express, { type Request, type Response } from "express";
import { requireAdmin } from "../middleware/require-admin";
import { requireAuth } from "../middleware/auth";
import { requireDatabaseReady } from "../middleware/database";
import { setNoStore } from "../http/no-store";
import { runTanbotTelegramProbe } from "./probe";

function parseLiveQuery(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function tanbotTelegramDiagnosticsHandler(req: Request, res: Response): Promise<void> {
  const live = parseLiveQuery(req.query.live);
  const report = await runTanbotTelegramProbe({ live, env: process.env });
  setNoStore(res);
  res.status(200).json(report);
}

export function createTanbotTelegramAdminRouter(): express.Router {
  const router = express.Router();
  const adminChain = [requireDatabaseReady, requireAuth, requireAdmin] as const;
  router.get("/diagnostics", ...adminChain, (req, res, next) => {
    void tanbotTelegramDiagnosticsHandler(req, res).catch(next);
  });
  return router;
}
