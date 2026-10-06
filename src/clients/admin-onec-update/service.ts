import {
  countRunningImportRuns,
  insertRegularUpdateJob,
  isExchangeApplyBlocked,
  loadActiveRegularUpdateJob,
  loadLastSuccessfulUpdateAt,
  loadLatestRegularUpdateJob,
  mapJobRowToDto,
} from "./repository";
import type {
  AdminOnecUpdateStartResponse,
  AdminOnecUpdateStatusResponse,
} from "./types";

async function buildBlockedReason(): Promise<string | null> {
  const active = await loadActiveRegularUpdateJob();
  if (active) {
    return "Обновление из 1С уже поставлено в очередь или выполняется.";
  }
  if ((await countRunningImportRuns()) > 0) {
    return "Другой импорт уже выполняется.";
  }
  if (await isExchangeApplyBlocked()) {
    return "Импорт временно заблокирован до разрешения предыдущей неопределённой операции.";
  }
  return null;
}

export async function getAdminOnecUpdateStatus(): Promise<AdminOnecUpdateStatusResponse> {
  const lastSuccessfulUpdateAt = await loadLastSuccessfulUpdateAt();
  const active = await loadActiveRegularUpdateJob();
  const latest = active ?? (await loadLatestRegularUpdateJob());
  const blockedReason = await buildBlockedReason();

  return {
    job: latest ? mapJobRowToDto(latest, lastSuccessfulUpdateAt) : null,
    canStart: blockedReason === null,
    blockedReason,
  };
}

export async function startAdminOnecUpdate(input: {
  requestedByUserId: string;
}): Promise<AdminOnecUpdateStartResponse> {
  const blockedReason = await buildBlockedReason();
  if (blockedReason) {
    throw Object.assign(new Error(blockedReason), { code: "UPDATE_ALREADY_RUNNING" });
  }

  const jobId = await insertRegularUpdateJob(input.requestedByUserId);
  console.info(
    JSON.stringify({
      event: "admin_onec_update_requested",
      jobId,
      requestedByUserId: input.requestedByUserId,
    }),
  );

  return {
    jobId,
    phase: "pending",
    message: "Обновление из 1С поставлено в очередь.",
  };
}
