import type { Bitrix24WebhookConfig } from "../types";
import type { Bitrix24OperationContext } from "../types";
import { readBitrixUserById } from "../read-users";
import { findEmployeePortalLink, recordEmployeePortalVerification } from "./repository";
import { isLinkAccessValid, type TaskVisibilityDenyCode } from "./access";
import { loadBitrix24TasksRuntimeConfig } from "./config";

export type EmployeeVerificationResult =
  | { ok: true; refreshed: boolean }
  | { ok: false; code: TaskVisibilityDenyCode | "BITRIX_USER_INACTIVE" | "VERIFICATION_FAILED" };

export async function ensureEmployeePortalLinkVerified(
  userId: string,
  portalId: string,
  config: Bitrix24WebhookConfig,
  operation: Bitrix24OperationContext,
  options: { force?: boolean } = {},
): Promise<EmployeeVerificationResult> {
  const runtime = loadBitrix24TasksRuntimeConfig();
  const link = await findEmployeePortalLink(userId, portalId);
  if (!link) {
    return { ok: false, code: "NO_EMPLOYEE_LINK" };
  }
  if (link.accessExpiresAt) {
    const expiresMs = Date.parse(link.accessExpiresAt);
    if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
      return { ok: false, code: "ACCESS_EXPIRED" };
    }
  }

  const needsRefresh =
    options.force ||
    !isLinkAccessValid(link, runtime) ||
    (runtime.linkVerificationTtlMs > 0 &&
      Date.parse(link.lastVerifiedAt ?? link.confirmedAt) + runtime.linkVerificationTtlMs <= Date.now());

  if (!needsRefresh) {
    return { ok: true, refreshed: false };
  }

  const userResult = await readBitrixUserById(config, link.bitrixUserId, { operation });
  if (!userResult.ok) {
    return { ok: false, code: "VERIFICATION_FAILED" };
  }
  if (userResult.user.active === false) {
    return { ok: false, code: "BITRIX_USER_INACTIVE" };
  }

  await recordEmployeePortalVerification(userId, portalId);
  return { ok: true, refreshed: true };
}
