import { isLinkAccessValid } from "../tasks/access";
import { loadBitrix24TasksRuntimeConfig } from "../tasks/config";
import { findEmployeePortalLink } from "../tasks/repository";

export type OrkPublishDenyCode =
  | "NO_EXECUTOR"
  | "NO_EMPLOYEE_LINK"
  | "ACCESS_EXPIRED"
  | "LINK_UNVERIFIED"
  | "NOT_RESPONSIBLE";

export type OrkPublishAuthorityResult =
  | { ok: true; executorUserId: string }
  | { ok: false; code: OrkPublishDenyCode; message: string };

export function mapOrkPublishDenyMessage(code: OrkPublishDenyCode): string {
  switch (code) {
    case "NO_EXECUTOR":
      return "Публикация #орк требует подтверждённого исполнителя синхронизации в ЛК.";
    case "NO_EMPLOYEE_LINK":
      return "Связь сотрудника с порталом Bitrix24 не подтверждена.";
    case "ACCESS_EXPIRED":
      return "Подтверждение доступа к Bitrix24 истекло.";
    case "LINK_UNVERIFIED":
      return "Доступ к Bitrix24 не подтверждён повторной верификацией.";
    case "NOT_RESPONSIBLE":
      return "Публикация #орк разрешена только ответственному специалисту задачи в Bitrix24.";
    default:
      return "Публикация #орк недоступна.";
  }
}

export async function evaluateOrkPublishAuthority(input: {
  portalId: string;
  responsibleBitrixUserId: string | null;
  syncExecutorUserId: string | null | undefined;
}): Promise<OrkPublishAuthorityResult> {
  if (!input.syncExecutorUserId) {
    return {
      ok: false,
      code: "NO_EXECUTOR",
      message: mapOrkPublishDenyMessage("NO_EXECUTOR"),
    };
  }

  const runtime = loadBitrix24TasksRuntimeConfig();
  const link = await findEmployeePortalLink(input.syncExecutorUserId, input.portalId);
  if (!link) {
    return {
      ok: false,
      code: "NO_EMPLOYEE_LINK",
      message: mapOrkPublishDenyMessage("NO_EMPLOYEE_LINK"),
    };
  }
  if (!link.lastVerifiedAt && runtime.linkVerificationTtlMs > 0) {
    return {
      ok: false,
      code: "LINK_UNVERIFIED",
      message: mapOrkPublishDenyMessage("LINK_UNVERIFIED"),
    };
  }
  if (!isLinkAccessValid(link, runtime)) {
    return {
      ok: false,
      code: "ACCESS_EXPIRED",
      message: mapOrkPublishDenyMessage("ACCESS_EXPIRED"),
    };
  }
  if (
    !input.responsibleBitrixUserId ||
    input.responsibleBitrixUserId !== link.bitrixUserId
  ) {
    return {
      ok: false,
      code: "NOT_RESPONSIBLE",
      message: mapOrkPublishDenyMessage("NOT_RESPONSIBLE"),
    };
  }

  return { ok: true, executorUserId: input.syncExecutorUserId };
}
