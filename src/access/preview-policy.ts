import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { getSessionPreviewDetails } from "./preview";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Session control and auth — always allowed while impersonating. */
const PREVIEW_ALLOWLIST: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/api\/auth\/me$/ },
  { method: "POST", pattern: /^\/api\/auth\/logout$/ },
  { method: "GET", pattern: /^\/api\/admin\/access\/preview$/ },
  { method: "GET", pattern: /^\/api\/admin\/access\/preview\/candidates$/ },
  { method: "POST", pattern: /^\/api\/admin\/access\/preview\/start$/ },
  { method: "POST", pattern: /^\/api\/admin\/access\/preview\/stop$/ },
  { method: "POST", pattern: /^\/api\/admin\/access\/preview\/work\/enable$/ },
  { method: "POST", pattern: /^\/api\/admin\/access\/preview\/work\/disable$/ },
];

/** Admin-only assignment prep — forbidden for any active employee preview (readonly or work). */
const PREVIEW_FORBIDDEN_SERVICE_POSTS: RegExp[] = [
  /^\/api\/access\/assignments\/schema$/,
  /^\/api\/access\/assignments\/coordinator$/,
  /^\/api\/access\/assignments\/reviews\/schema$/,
];

/**
 * Explicit audited business mutations allowed in work mode only.
 * Assignments, coordinator decisions, mandatory reviews, in-app notification read markers.
 */
const WORK_MODE_MUTATION_ALLOWLIST: Array<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/api\/access\/delegations$/ },
  {
    method: "POST",
    pattern:
      /^\/api\/access\/delegations\/[0-9a-f-]{36}\/(edit|submit|approve|reject|return|cancel|revoke|change-requests|approve-change|reject-change|return-change|cancel-change|review)$/,
  },
  { method: "POST", pattern: /^\/api\/access\/notifications\/read-all$/ },
  { method: "POST", pattern: /^\/api\/access\/notifications\/[0-9a-f-]{36}\/read$/ },
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

function isWorkModeMutationAllowed(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  return WORK_MODE_MUTATION_ALLOWLIST.some(
    (entry) => entry.method === normalizedMethod && entry.pattern.test(path),
  );
}

function isForbiddenServicePost(method: string, path: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  return PREVIEW_FORBIDDEN_SERVICE_POSTS.some((pattern) => pattern.test(path));
}

export async function enforcePreviewBusinessPolicy(
  req: AuthenticatedRequest,
  res: Response,
): Promise<boolean> {
  if (req.authUser?.role !== "admin" || !req.sessionId) {
    return false;
  }

  const details = await getSessionPreviewDetails(req.sessionId);
  if (!details?.previewUserId) {
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
        details.workEnabled
          ? "Служебные разделы недоступны, пока вы работаете от имени сотрудника. Выйдите из режима."
          : "Раздел недоступен в режиме просмотра от имени сотрудника.",
      ),
    );
    return true;
  }

  if (isForbiddenServicePost(req.method, path)) {
    res.status(403).json(
      apiError(
        ERROR_CODES.FORBIDDEN,
        "Служебные операции назначений недоступны в режиме просмотра от имени сотрудника.",
      ),
    );
    return true;
  }

  const method = req.method.toUpperCase();

  if (details.workEnabled) {
    if (MUTATING_METHODS.has(method)) {
      if (isWorkModeMutationAllowed(method, path)) {
        return false;
      }
      res.status(403).json(
        apiError(
          ERROR_CODES.FORBIDDEN,
          "В рабочем режиме от имени сотрудника доступны только согласованные процессы назначений, оценок и уведомлений ЛК.",
        ),
      );
      return true;
    }
    return false;
  }

  if (MUTATING_METHODS.has(method)) {
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
