import type { Bitrix24WebhookConfig } from "../types";
import type { Bitrix24OperationContext } from "../types";
import { readBitrixUserById } from "../read-users";
import {
  clearEmployeePortalVerification,
  findEmployeePortalLink,
  recordEmployeePortalVerification,
  type EmployeePortalLinkIdentity,
} from "./repository";
import { isLinkAccessValid, isLinkIdentityValid, type TaskVisibilityDenyCode } from "./access";
import { loadBitrix24TasksRuntimeConfig } from "./config";

export type EmployeeVerificationResult =
  | { ok: true; refreshed: boolean }
  | { ok: false; code: TaskVisibilityDenyCode | "BITRIX_USER_INACTIVE" | "VERIFICATION_FAILED" };

export async function ensureEmployeePortalLinkVerified(
  userId: string,
  portalId: string,
  config: Bitrix24WebhookConfig,
  operation: Bitrix24OperationContext,
  options: { force?: boolean; expectedIdentity?: { bitrixUserId: string; confirmedAtMs: number } } = {},
): Promise<EmployeeVerificationResult> {
  const runtime = loadBitrix24TasksRuntimeConfig();
  const link = await findEmployeePortalLink(userId, portalId);
  if (!link) {
    return { ok: false, code: "NO_EMPLOYEE_LINK" };
  }
  if (!isLinkIdentityValid(link, runtime)) return { ok: false, code: "ACCESS_EXPIRED" };
  if (options.expectedIdentity && (
    options.expectedIdentity.bitrixUserId !== link.bitrixUserId ||
    options.expectedIdentity.confirmedAtMs !== link.confirmedAtMs
  )) return { ok: false, code: "VERIFICATION_FAILED" };

  const identity: EmployeePortalLinkIdentity = {
    bitrixUserId: link.bitrixUserId,
    confirmedAtMs: link.confirmedAtMs,
    verificationVersion: link.verificationVersion,
  };

  const needsRefresh =
    options.force ||
    !link.lastVerifiedAt ||
    !isLinkAccessValid(link, runtime) ||
    (runtime.linkVerificationTtlMs > 0 &&
      link.lastVerifiedAt &&
      Date.parse(link.lastVerifiedAt) + runtime.linkVerificationTtlMs <= Date.now());

  if (!needsRefresh) {
    return { ok: true, refreshed: false };
  }

  const userResult = await readBitrixUserById(config, identity.bitrixUserId, { operation });
  if (!userResult.ok) {
    return { ok: false, code: "VERIFICATION_FAILED" };
  }
  if (userResult.user.active !== true) {
    await clearEmployeePortalVerification(userId, portalId, identity);
    return { ok: false, code: "BITRIX_USER_INACTIVE" };
  }

  const refreshed = await recordEmployeePortalVerification(userId, portalId, identity);
  if (!refreshed) {
    return { ok: false, code: "VERIFICATION_FAILED" };
  }
  return { ok: true, refreshed: true };
}
