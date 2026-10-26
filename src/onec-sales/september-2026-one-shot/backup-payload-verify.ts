import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { assertApprovedPrivateBackupRoot } from "./private-backup-publish";
import { sha256CanonicalJson } from "../matched-only/canonical-json";
import type { September047048Backup } from "./backup";
import { SEPTEMBER_2026_SALE_MONTH_ISO } from "./scope-pins";
import type { September047048Snapshot } from "./before-state-047-048";

export const BACKUP_PAYLOAD_MAX_BYTES = 64 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPrivatePathUnderRoot(filePath: string, approvedRoot: string): { ok: true } | { ok: false; code: string; message: string } {
  const root = resolve(approvedRoot);
  const dest = resolve(filePath);
  if (dest !== root && !dest.startsWith(`${root}${sep}`)) {
    return { ok: false, code: "BACKUP_PAYLOAD_PATH_OUTSIDE_ROOT", message: "Backup payload path outside approved private root." };
  }
  return { ok: true };
}

export async function readSeptember047048BackupPayloadFile(input: {
  backupPayloadFilePath: string;
  approvedPrivateRoot?: string;
  skipPathSecurity?: boolean;
}): Promise<{ ok: true; bytes: Buffer } | { ok: false; code: string; message: string }> {
  const filePath = resolve(input.backupPayloadFilePath);
  if (!input.skipPathSecurity) {
    const rootValue = input.approvedPrivateRoot?.trim();
    if (!rootValue) {
      return { ok: false, code: "BACKUP_PRIVATE_ROOT_REQUIRED", message: "SEPTEMBER_2026_BACKUP_PRIVATE_ROOT is required." };
    }
    const rootSec = await assertApprovedPrivateBackupRoot(rootValue);
    if (!rootSec.ok) return rootSec;
    const rootCheck = assertPrivatePathUnderRoot(filePath, rootValue);
    if (!rootCheck.ok) return rootCheck;
  }
  try {
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink()) {
      return { ok: false, code: "BACKUP_PAYLOAD_SYMLINK", message: "Backup payload must not be a symlink." };
    }
    if (!input.skipPathSecurity) {
      const mode = stat.mode & 0o777;
      if (mode & 0o077) {
        return { ok: false, code: "BACKUP_PAYLOAD_NOT_PRIVATE", message: "Backup payload file must be mode 0600." };
      }
    }
    if (stat.size > BACKUP_PAYLOAD_MAX_BYTES) {
      return { ok: false, code: "BACKUP_PAYLOAD_TOO_LARGE", message: "Backup payload exceeds size bound." };
    }
    const bytes = await readFile(filePath);
    if (bytes.length > BACKUP_PAYLOAD_MAX_BYTES) {
      return { ok: false, code: "BACKUP_PAYLOAD_TOO_LARGE", message: "Backup payload exceeds size bound." };
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, code: "BACKUP_PAYLOAD_FILE_MISSING", message: "Backup payload file not found." };
  }
}

export function validateSeptember047048BackupDocument(
  doc: unknown,
  expected: {
    targetDbFingerprint: string;
    beforeStateSha256: string;
  },
): { ok: true; backup: September047048Backup } | { ok: false; code: string; message: string } {
  if (!isRecord(doc)) {
    return { ok: false, code: "BACKUP_PAYLOAD_INVALID", message: "Backup payload is not a JSON object." };
  }
  if (doc.v !== 1 || doc.kind !== "september-2026-047-048-backup") {
    return { ok: false, code: "BACKUP_PAYLOAD_KIND", message: "Invalid backup payload version/kind." };
  }
  if (typeof doc.targetDbFingerprint !== "string" || doc.targetDbFingerprint !== expected.targetDbFingerprint) {
    return { ok: false, code: "BACKUP_PAYLOAD_TARGET_MISMATCH", message: "Backup payload target fingerprint mismatch." };
  }
  if (typeof doc.beforeStateSha256 !== "string" || doc.beforeStateSha256 !== expected.beforeStateSha256) {
    return { ok: false, code: "BACKUP_PAYLOAD_BEFORE_MISMATCH", message: "Backup payload before digest mismatch." };
  }
  if (!isRecord(doc.snapshot)) {
    return { ok: false, code: "BACKUP_PAYLOAD_SNAPSHOT", message: "Backup snapshot missing." };
  }
  const snap = doc.snapshot;
  if (snap.v !== 2) {
    return { ok: false, code: "BACKUP_PAYLOAD_SNAPSHOT_VERSION", message: "Backup snapshot version must be 2." };
  }
  if (snap.saleMonthIso !== SEPTEMBER_2026_SALE_MONTH_ISO) {
    return { ok: false, code: "BACKUP_PAYLOAD_SALE_MONTH", message: "Backup snapshot sale month mismatch." };
  }
  const jsonFields = [
    "saleAggregateLinesJson",
    "saleItemLinesJson",
    "returnLinesJson",
    "returnItemLinesJson",
    "importStatesJson",
    "monthActivationsJson",
  ] as const;
  for (const key of jsonFields) {
    if (typeof snap[key] !== "string") {
      return {
        ok: false,
        code: "BACKUP_PAYLOAD_NATIVE_JSON",
        message: `Backup snapshot ${key} must remain raw PostgreSQL JSON text.`,
      };
    }
  }
  const snapshot = snap as September047048Snapshot;
  const digest = sha256CanonicalJson(snapshot);
  if (digest !== doc.beforeStateSha256) {
    return { ok: false, code: "BACKUP_PAYLOAD_DIGEST_MISMATCH", message: "Backup snapshot digest does not match beforeStateSha256." };
  }
  const backup = doc as September047048Backup;
  return { ok: true, backup };
}

export async function verifySeptember047048BackupPayloadBinding(input: {
  backupPayloadFilePath: string;
  expectedPayloadSha256: string;
  targetDbFingerprint: string;
  beforeStateSha256: string;
  approvedPrivateRoot?: string;
  skipPathSecurity?: boolean;
}): Promise<{ ok: true; payloadSha256: string } | { ok: false; code: string; message: string }> {
  const read = await readSeptember047048BackupPayloadFile({
    backupPayloadFilePath: input.backupPayloadFilePath,
    approvedPrivateRoot: input.approvedPrivateRoot,
    skipPathSecurity: input.skipPathSecurity,
  });
  if (!read.ok) return read;
  const payloadSha256 = createHash("sha256").update(read.bytes).digest("hex");
  if (payloadSha256 !== input.expectedPayloadSha256) {
    return { ok: false, code: "BACKUP_PAYLOAD_SHA_MISMATCH", message: "Backup payload file SHA mismatch vs receipt." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.bytes.toString("utf8"));
  } catch {
    return { ok: false, code: "BACKUP_PAYLOAD_PARSE", message: "Backup payload is not valid JSON." };
  }
  const valid = validateSeptember047048BackupDocument(parsed, {
    targetDbFingerprint: input.targetDbFingerprint,
    beforeStateSha256: input.beforeStateSha256,
  });
  if (!valid.ok) return valid;
  return { ok: true, payloadSha256 };
}
