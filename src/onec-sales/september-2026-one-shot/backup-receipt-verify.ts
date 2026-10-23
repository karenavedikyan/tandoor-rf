import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { OperatorDataScopeV1 } from "./operator-data-scope";
import { operatorDataScopeSha256 } from "./operator-data-scope";
import { verifySeptember047048BackupPayloadBinding } from "./backup-payload-verify";

export type SeptemberBackupReceiptV1 = {
  v: 1;
  kind: "september-2026-047-048-backup-receipt";
  targetDbFingerprint: string;
  operatorDataScopeSha256: string;
  beforeStateSha256: string;
  backupPayloadSha256: string;
  capturedAt: string;
};

export function backupReceiptSha256(receipt: SeptemberBackupReceiptV1): string {
  return createHash("sha256").update(JSON.stringify(receipt), "utf8").digest("hex");
}

export async function verifySeptemberBackupReceiptForApply(input: {
  receiptFilePath: string;
  expectedReceiptSha256: string;
  backupPayloadFilePath: string;
  scope: OperatorDataScopeV1;
  scopeFileSha256: string;
  liveTargetFingerprint: string;
  liveBeforeStateDigest: string;
  approvedPrivateBackupRoot?: string;
  skipBackupPayloadPathSecurity?: boolean;
}): Promise<{ ok: true; receipt: SeptemberBackupReceiptV1 } | { ok: false; code: string; message: string }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(input.receiptFilePath);
  } catch {
    return { ok: false, code: "BACKUP_RECEIPT_MISSING", message: "Backup receipt file not found." };
  }
  const computedSha = createHash("sha256").update(bytes).digest("hex");
  if (computedSha !== input.expectedReceiptSha256) {
    return { ok: false, code: "BACKUP_RECEIPT_SHA_MISMATCH", message: "Backup receipt SHA mismatch." };
  }
  const receipt = JSON.parse(bytes.toString("utf8")) as SeptemberBackupReceiptV1;
  if (receipt.v !== 1 || receipt.kind !== "september-2026-047-048-backup-receipt") {
    return { ok: false, code: "BACKUP_RECEIPT_INVALID", message: "Invalid backup receipt version/kind." };
  }
  if (receipt.targetDbFingerprint !== input.liveTargetFingerprint) {
    return { ok: false, code: "BACKUP_RECEIPT_TARGET_MISMATCH", message: "Backup receipt target fingerprint mismatch." };
  }
  if (receipt.operatorDataScopeSha256 !== input.scopeFileSha256) {
    return { ok: false, code: "BACKUP_RECEIPT_SCOPE_MISMATCH", message: "Backup receipt scope SHA mismatch." };
  }
  if (receipt.beforeStateSha256 !== input.scope.beforeStateDigest) {
    return { ok: false, code: "BACKUP_RECEIPT_BEFORE_SCOPE_MISMATCH", message: "Backup receipt before digest mismatch vs scope." };
  }
  if (receipt.beforeStateSha256 !== input.liveBeforeStateDigest) {
    return { ok: false, code: "BACKUP_RECEIPT_BEFORE_LIVE_MISMATCH", message: "Backup receipt before digest mismatch vs live." };
  }
  const canonicalSha = backupReceiptSha256(receipt);
  if (canonicalSha !== computedSha) {
    return { ok: false, code: "BACKUP_RECEIPT_BINDING_INVALID", message: "Backup receipt canonical binding invalid." };
  }
  if (!receipt.backupPayloadSha256?.trim()) {
    return { ok: false, code: "BACKUP_RECEIPT_PAYLOAD_MISSING", message: "Backup payload SHA missing from receipt." };
  }
  if (!input.backupPayloadFilePath?.trim()) {
    return { ok: false, code: "BACKUP_PAYLOAD_FILE_MISSING", message: "Backup payload file path required." };
  }

  const payload = await verifySeptember047048BackupPayloadBinding({
    backupPayloadFilePath: input.backupPayloadFilePath,
    expectedPayloadSha256: receipt.backupPayloadSha256,
    targetDbFingerprint: input.liveTargetFingerprint,
    beforeStateSha256: input.liveBeforeStateDigest,
    approvedPrivateRoot: input.approvedPrivateBackupRoot,
    skipPathSecurity: input.skipBackupPayloadPathSecurity,
  });
  if (!payload.ok) return payload;

  return { ok: true, receipt };
}

export function buildSeptemberBackupReceiptFromVerifiedPayload(input: {
  targetDbFingerprint: string;
  scopeFileSha256: string;
  beforeStateSha256: string;
  backupPayloadFileSha256: string;
  capturedAt?: string;
}): SeptemberBackupReceiptV1 {
  return {
    v: 1,
    kind: "september-2026-047-048-backup-receipt",
    targetDbFingerprint: input.targetDbFingerprint,
    operatorDataScopeSha256: input.scopeFileSha256,
    beforeStateSha256: input.beforeStateSha256,
    backupPayloadSha256: input.backupPayloadFileSha256,
    capturedAt: input.capturedAt ?? new Date(0).toISOString(),
  };
}

export { operatorDataScopeSha256 };
