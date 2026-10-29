import { readFile } from "node:fs/promises";
import { sha256CanonicalJson } from "./canonical-json";
import type { MatchedOnlyScopedBackupV1 } from "./types";

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
