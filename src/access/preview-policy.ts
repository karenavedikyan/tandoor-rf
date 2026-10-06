import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { getSessionPreviewUserId } from "./preview";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const PREVIEW_ALLOWLIST: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/api\/auth\/me$/ },
  { method: "POST", pattern: /^\/api\/auth\/logout$/ },
  { method: "GET", pattern: /^\/api\/admin\/access\/preview$/ },
  { method: "GET", pattern: /^\/api\/admin\/access\/preview\/candidates$/ },
  { method: "POST", pattern: /^\/api\/admin\/access\/preview\/start$/ },
  { method: "POST", pattern: /^\/api\/admin\/access\/preview\/stop$/ },
];

/** Lowercase path without query — matches Express case-insensitive route matching. */
export function normalizePreviewRequestPath(originalUrl: string): string {
  const path = originalUrl.split("?")[0] ?? originalUrl;
  return path.toLowerCase();
}

export function isPreviewAllowlisted(method: string, originalUrl: string): boolean {
  const normalizedMethod = method.toUpperCase();
  const path = normalizePreviewRequestPath(originalUrl);
  return PREVIEW_ALLOWLIST.some(
    (entry) => entry.method === normalizedMethod && entry.pattern.test(path),
  );
}

export async function enforcePreviewBusinessPolicy(
  req: AuthenticatedRequest,
  res: Response,
): Promise<boolean> {
  if (req.authUser?.role !== "admin" || !req.sessionId) {
    return false;
  }

  const previewUserId = await getSessionPreviewUserId(req.sessionId);
  if (!previewUserId) {
    return false;
  }

  if (isPreviewAllowlisted(req.method, req.originalUrl)) {
    return false;
  }

  const path = normalizePreviewRequestPath(req.originalUrl);
  setNoStore(res);

  if (path.startsWith("/api/admin/") || path.startsWith("/api/profile/")) {
    res.status(403).json(
      apiError(
        ERROR_CODES.FORBIDDEN,
        "Раздел недоступен в режиме просмотра от имени сотрудника.",
      ),
    );
    return true;
  }

  if (MUTATING_METHODS.has(req.method.toUpperCase())) {
    res.status(403).json(
      apiError(
        ERROR_CODES.FORBIDDEN,
        "Изменения запрещены в режиме просмотра от имени сотрудника.",
      ),
    );
    return true;
  }

  return false;
}
