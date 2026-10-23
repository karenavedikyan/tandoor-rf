import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { captureSeptember047048BeforeState, type September047048Snapshot } from "./before-state-047-048";
import { assertExternalWriteAuthorization } from "./operator-guard";
import { publishPrivateBackupJson } from "./private-backup-publish";

export type September047048Backup = {
  v: 1;
  kind: "september-2026-047-048-backup";
  capturedAt: string;
  targetDbFingerprint: string;
  beforeStateSha256: string;
  snapshot: September047048Snapshot;
};

export function septemberBackupSha256(backup: September047048Backup): string {
  return createHash("sha256").update(JSON.stringify(backup), "utf8").digest("hex");
}

export async function captureSeptember047048Backup(
  client: PoolClient,
  targetDbFingerprint: string,
): Promise<September047048Backup> {
  const before = await captureSeptember047048BeforeState(client);
  return {
    v: 1,
    kind: "september-2026-047-048-backup",
    capturedAt: new Date().toISOString(),
    targetDbFingerprint,
    beforeStateSha256: before.digest,
    snapshot: before.snapshot,
  };
}

export async function runSeptember2026BackupToPrivateFile(input: {
  client: PoolClient;
  targetDbFingerprint: string;
  destinationPath: string;
  approvedPrivateRoot: string;
}): Promise<{ ok: true; sha256: string } | { ok: false; code: string; message: string }> {
  const auth = assertExternalWriteAuthorization();
  if (!auth.ok) return auth;
  const backup = await captureSeptember047048Backup(input.client, input.targetDbFingerprint);
  const sha = septemberBackupSha256(backup);
  const published = await publishPrivateBackupJson({
    destinationPath: input.destinationPath,
    approvedPrivateRoot: input.approvedPrivateRoot,
    payload: backup,
  });
  if (!published.ok) return published;
  return { ok: true, sha256: sha };
}
