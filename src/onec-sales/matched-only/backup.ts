import { readFile } from "node:fs/promises";
import { sha256CanonicalJson } from "./canonical-json";
import type { MatchedOnlyBundlePlanV1, MatchedOnlyScopedBackupV1 } from "./types";
import { planHashFromPlan } from "./plan-build";

export function backupSha256(backup: MatchedOnlyScopedBackupV1): string {
  return sha256CanonicalJson(backup);
}

export function parseBackupJson(bytes: Buffer): MatchedOnlyScopedBackupV1 {
  const parsed = JSON.parse(bytes.toString("utf8")) as MatchedOnlyScopedBackupV1;
  if (parsed.v !== 1) {
    throw new Error("BACKUP_VERSION_UNSUPPORTED");
  }
  return parsed;
}

export async function readBackupFile(path: string): Promise<MatchedOnlyScopedBackupV1> {
  const bytes = await readFile(path);
  return parseBackupJson(bytes);
}

export type BackupValidationFailure = {
  code: string;
  message: string;
};

export function validateBackupAgainstPlan(
  backup: MatchedOnlyScopedBackupV1,
  plan: MatchedOnlyBundlePlanV1,
  expectedBackupSha256?: string,
): BackupValidationFailure | null {
  const computedPlanHash = planHashFromPlan(plan);
  if (backup.planHash !== computedPlanHash) {
    return { code: "BACKUP_PLAN_HASH_MISMATCH", message: "Backup planHash does not match plan document." };
  }
  if (backup.targetDbFingerprint !== plan.identity.targetDbFingerprint) {
    return { code: "BACKUP_TARGET_MISMATCH", message: "Backup target DB fingerprint mismatch." };
  }
  if (backup.beforeStateSha256 !== plan.beforeStateSha256) {
    return { code: "BACKUP_BEFORE_STATE_MISMATCH", message: "Backup before-state digest mismatch." };
  }
  const sha = backupSha256(backup);
  if (expectedBackupSha256 && expectedBackupSha256 !== sha) {
    return { code: "BACKUP_SHA_MISMATCH", message: "Backup SHA-256 does not match expected value." };
  }
  for (const key of Object.keys(plan.sourceHashes) as (keyof typeof plan.sourceHashes)[]) {
    if (backup.sourceHashes[key] !== plan.sourceHashes[key]) {
      return { code: "BACKUP_SOURCE_SHA_MISMATCH", message: `Backup source SHA mismatch for ${key}.` };
    }
  }
  const monthSet = new Set(plan.scope.saleMonthsIso);
  for (const month of backup.saleMonthsIso) {
    if (!monthSet.has(month)) {
      return { code: "BACKUP_SCOPE_MISMATCH", message: "Backup month scope is wider than plan." };
    }
  }
  return null;
}
