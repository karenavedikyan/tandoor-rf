import { randomUUID } from "node:crypto";
import type { Request } from "express";

export type SafeServerErrorLogContext = {
  diagnosticId: string;
  method: string;
  route: string;
  status: number;
};

/** Pathname / mounted route template only — never query string. */
export function safeRouteTemplate(req: Request): string {
  const routePath =
    req.route && typeof (req.route as { path?: unknown }).path === "string"
      ? (req.route as { path: string }).path
      : req.path || "/";
  const base = req.baseUrl || "";
  const suffix = routePath === "/" ? "" : routePath;
  const combined = `${base}${suffix}`.replace(/\/{2,}/g, "/");
  return combined.length > 0 ? combined : "/";
}

const ALLOWLISTED_PG_CODE = /^[0-9A-Z]{5}$/;

function logAllowlistedErrorTraits(diagnosticId: string, err: unknown): void {
  if (err === null || typeof err !== "object") {
    return;
  }
  const record = err as Record<string, unknown>;
  const traits: string[] = [];
  if (typeof record.code === "string" && ALLOWLISTED_PG_CODE.test(record.code)) {
    traits.push(`code=${record.code}`);
  }
  if (traits.length === 0) {
    return;
  }
  console.error(`Server error traits requestId=${diagnosticId} ${traits.join(" ")}`);
}

export function logServerError(req: Request, status: number, err: unknown): SafeServerErrorLogContext {
  const diagnosticId = randomUUID();
  const method = (req.method || "GET").toUpperCase();
  const route = safeRouteTemplate(req);
  console.error(`Server error (${status}) ${method} ${route} requestId=${diagnosticId}`);

  if (process.env.TANDOOR_DEBUG_HTTP_ERRORS === "1") {
    logAllowlistedErrorTraits(diagnosticId, err);
  }

  return { diagnosticId, method, route, status };
}
