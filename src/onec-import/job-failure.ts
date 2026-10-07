import { randomUUID } from "node:crypto";
import type { RegularUpdateResult } from "../onec-regular-update/types";
import { redactSecrets } from "../onec-ftp/sanitize";

export const IMPORT_JOB_UNKNOWN_CODE = "IMPORT_JOB_UNKNOWN" as const;

export const IMPORT_JOB_FAILURE_STAGES = [
  "config",
  "file_read",
  "manifest_validation",
  "bundle_validation",
  "apply",
  "employee_roster",
  "unknown",
] as const;

export type ImportJobFailureStage = (typeof IMPORT_JOB_FAILURE_STAGES)[number];

const STAGE_BY_ERROR_CODE: Partial<Record<string, ImportJobFailureStage>> = {
  CONFIG_INVALID: "config",
  CONFIG_ERROR: "config",
  FTP_ERROR: "file_read",
  FTP_READ_FAILED: "file_read",
  TIMEOUT: "file_read",
  EMPLOYEE_ROSTER_UNREADABLE: "employee_roster",
  EMPLOYEE_ROSTER_MISMATCH: "employee_roster",
  EMPLOYEE_ROSTER_EMPTY: "bundle_validation",
  VALIDATION_FAILED: "bundle_validation",
  HASH_MISMATCH: "bundle_validation",
  BUNDLE_READ_DRIFT: "bundle_validation",
  MANIFEST_NOT_FOUND: "manifest_validation",
  MANIFEST_UNREADABLE: "manifest_validation",
  MANIFEST_INVALID_JSON: "manifest_validation",
  MANIFEST_INVALID_SCHEMA: "manifest_validation",
  MANIFEST_HASH_MISMATCH: "manifest_validation",
  RELEASE_CONSISTENCY_NOT_CONFIRMED: "manifest_validation",
  COMMIT_UNCERTAIN: "apply",
  DATABASE_ERROR: "apply",
};

const USER_MESSAGES: Partial<Record<string, string>> = {
  CONFIG_INVALID:
    "Настройки FTP для 1С не проходят проверку безопасности. Обновление не запускалось.",
  CONFIG_ERROR: "Параметры FTP 1С заданы неполностью или некорректно.",
  FTP_ERROR: "Не удалось прочитать файлы выгрузки 1С по FTP.",
  FTP_READ_FAILED: "Не удалось прочитать файлы выгрузки 1С по FTP.",
  TIMEOUT: "Превышено время ожидания при чтении файлов 1С.",
  EMPLOYEE_ROSTER_UNREADABLE: "Не удалось прочитать справочник сотрудников из 1С.",
  EMPLOYEE_ROSTER_MISMATCH: "Справочник сотрудников не совпадает с ожидаемым снимком.",
  MANIFEST_NOT_FOUND:
    "Файл export_bundle_manifest.json не найден на FTP. Обновление недоступно.",
  MANIFEST_UNREADABLE: "Не удалось прочитать export_bundle_manifest.json с FTP.",
  MANIFEST_INVALID_JSON: "export_bundle_manifest.json содержит некорректный JSON.",
  MANIFEST_INVALID_SCHEMA: "export_bundle_manifest.json не соответствует схеме.",
  MANIFEST_HASH_MISMATCH: "Хеши в export_bundle_manifest.json не совпадают с файлами комплекта.",
};

export class ImportJobError extends Error {
  readonly errorCode: string;
  readonly stage: ImportJobFailureStage;

  constructor(errorCode: string, stage: ImportJobFailureStage, message: string) {
    super(message);
    this.name = "ImportJobError";
    this.errorCode = errorCode;
    this.stage = stage;
  }
}

export type ImportJobFailureRecord = {
  errorCode: string;
  stage: ImportJobFailureStage;
  message: string;
  diagnosticId: string | null;
  result: RegularUpdateResult;
};

/** Collect secrets for redaction even when FTP config parsing fails. */
export function collectEnvRedactionSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const secrets: string[] = [];
  const password = env.ONEC_FTP_PASSWORD;
  if (typeof password === "string" && password.length > 0) {
    secrets.push(password);
  }
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) {
    secrets.push(databaseUrl);
  }
  return secrets;
}

export function resolveImportJobStage(errorCode: string | null | undefined): ImportJobFailureStage {
  if (!errorCode) {
    return "unknown";
  }
  return STAGE_BY_ERROR_CODE[errorCode] ?? "unknown";
}

function resolveUserMessage(errorCode: string, fallback?: string): string {
  return USER_MESSAGES[errorCode] ?? fallback ?? "Не удалось выполнить обновление из 1С.";
}

export function inferImportJobStage(result: RegularUpdateResult): ImportJobFailureStage {
  if (result.stage) {
    return result.stage;
  }
  if (result.errorCode) {
    return resolveImportJobStage(result.errorCode);
  }
  if (result.applyPermitted === false || result.releaseConsistencyConfirmed === false) {
    return "manifest_validation";
  }
  return "unknown";
}

export function normalizeRegularUpdateResult(result: RegularUpdateResult): RegularUpdateResult {
  const stage = inferImportJobStage(result);
  if (result.stage === stage) {
    return result;
  }
  return { ...result, stage };
}

export function buildImportJobFailure(
  error: unknown,
  mode: "dry_run" | "apply",
  env: NodeJS.ProcessEnv = process.env,
): ImportJobFailureRecord {
  const finishedAtMs = Date.now();
  const startedAtMs = finishedAtMs;
  const startedAt = new Date(startedAtMs).toISOString();

  if (error instanceof ImportJobError) {
    const message = resolveUserMessage(error.errorCode, error.message);
    const result: RegularUpdateResult = {
      status: "ERROR",
      mode,
      startedAt,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: 0,
      errorCode: error.errorCode,
      message,
      stage: error.stage,
    };
    return {
      errorCode: error.errorCode,
      stage: error.stage,
      message,
      diagnosticId: null,
      result,
    };
  }

  const rawCode =
    error instanceof Error
      ? error.message
      : error !== null && typeof error === "object" && "errorCode" in error
        ? String((error as { errorCode?: unknown }).errorCode ?? "")
        : "";

  const knownCode =
    rawCode && STAGE_BY_ERROR_CODE[rawCode] !== undefined ? rawCode : null;

  if (knownCode) {
    const stage = resolveImportJobStage(knownCode);
    const message = resolveUserMessage(knownCode);
    const result: RegularUpdateResult = {
      status: "ERROR",
      mode,
      startedAt,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: 0,
      errorCode: knownCode,
      message,
      stage,
    };
    return {
      errorCode: knownCode,
      stage,
      message,
      diagnosticId: null,
      result,
    };
  }

  const diagnosticId = randomUUID();
  const message = `Внутренняя ошибка при выполнении обновления. Идентификатор диагностики: ${diagnosticId}.`;
  const result: RegularUpdateResult = {
    status: "ERROR",
    mode,
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: 0,
    errorCode: IMPORT_JOB_UNKNOWN_CODE,
    message,
    stage: "unknown",
    diagnosticId,
  };

  console.info(
    JSON.stringify({
      event: "onec_import_job_internal_error",
      diagnosticId,
    }),
  );

  return {
    errorCode: IMPORT_JOB_UNKNOWN_CODE,
    stage: "unknown",
    message,
    diagnosticId,
    result,
  };
}

export function redactImportJobResult(
  result: unknown,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  const secrets = collectEnvRedactionSecrets(env);
  let serialized = JSON.stringify(result);
  for (const secret of secrets) {
    serialized = serialized.split(secret).join("[REDACTED]");
  }
  serialized = redactSecrets(serialized, secrets);
  const parsed = JSON.parse(serialized) as Record<string, unknown>;
  if (typeof parsed.message === "string") {
    parsed.message = redactSecrets(parsed.message, secrets);
  }
  return parsed;
}

export function finalizeRegularUpdateResult(
  result: RegularUpdateResult,
  env: NodeJS.ProcessEnv = process.env,
): RegularUpdateResult {
  return redactImportJobResult(normalizeRegularUpdateResult(result), env) as RegularUpdateResult;
}
