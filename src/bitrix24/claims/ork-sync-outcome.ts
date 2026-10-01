import type { OrkPublicationSyncResult } from "./ork-publication-sync";

const BENIGN_PARSE_REASONS = new Set(["missing_tag", "empty_summary"]);

export function mapOrkParseReasonMessage(reason: string): string {
  switch (reason) {
    case "too_long":
      return "Текст #орк превышает допустимую длину; публикация отклонена.";
    case "unsafe_content":
      return "Текст #орк содержит небезопасное содержимое; публикация отклонена.";
    case "multiple_tags":
      return "В описании найдено несколько меток #орк; публикация отклонена.";
    default:
      return "Публикация #орк отклонена.";
  }
}

export type OrkSyncOutcomeClassification = {
  isIssue: boolean;
  isBenignRevoke: boolean;
  denyEntry?: { code: string; message: string };
};

export function classifyOrkSyncResult(
  result: OrkPublicationSyncResult,
): OrkSyncOutcomeClassification {
  const benignParse =
    result.parseReason !== undefined && BENIGN_PARSE_REASONS.has(result.parseReason);

  if (
    result.action === "revoked" &&
    !result.denyCode &&
    (!result.parseReason || benignParse)
  ) {
    return { isIssue: false, isBenignRevoke: true };
  }

  if (result.denyCode && result.denyMessage) {
    return {
      isIssue: true,
      isBenignRevoke: false,
      denyEntry: { code: result.denyCode, message: result.denyMessage },
    };
  }

  if (result.parseReason && !benignParse) {
    return {
      isIssue: true,
      isBenignRevoke: false,
      denyEntry: {
        code: result.parseReason,
        message: mapOrkParseReasonMessage(result.parseReason),
      },
    };
  }

  if (result.action === "skipped_unauthorized") {
    return {
      isIssue: true,
      isBenignRevoke: false,
      denyEntry: {
        code: result.denyCode ?? "NO_EXECUTOR",
        message:
          result.denyMessage ??
          "Публикация #орк требует подтверждённого исполнителя синхронизации в ЛК.",
      },
    };
  }

  return { isIssue: false, isBenignRevoke: false };
}

export type OrkSyncMetrics = {
  orkPublicationsRevoked: number;
  orkPublishIssues: number;
  orkPublishDenied: Array<{ taskId: string; code: string; message: string }>;
};

export function applyOrkSyncResultMetrics(
  metrics: OrkSyncMetrics,
  taskId: string,
  result: OrkPublicationSyncResult,
): void {
  const classified = classifyOrkSyncResult(result);
  if (classified.isBenignRevoke && result.action === "revoked") {
    metrics.orkPublicationsRevoked += 1;
    return;
  }
  if (!classified.isIssue) {
    return;
  }
  if (result.action === "revoked") {
    metrics.orkPublicationsRevoked += 1;
  }
  metrics.orkPublishIssues += 1;
  if (classified.denyEntry) {
    metrics.orkPublishDenied.push({
      taskId,
      code: classified.denyEntry.code,
      message: classified.denyEntry.message,
    });
  }
}
