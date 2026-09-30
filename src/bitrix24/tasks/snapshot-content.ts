import { createHash } from "node:crypto";
import type { TaskSnapshotInput } from "./repository";

/** Bitrix24 source fields versioned by changed_at (excludes local publish/binding policy). */
export type SnapshotSourceContent = {
  responsibleBitrixUserId: string | null;
  title: string;
  statusLabel: string;
  deadline: string | null;
  descriptionHash: string;
};

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

export function fingerprintSourceContent(content: SnapshotSourceContent): string {
  return createHash("sha256")
    .update(
      stableJson({
        responsibleBitrixUserId: content.responsibleBitrixUserId,
        title: content.title,
        statusLabel: content.statusLabel,
        deadline: content.deadline,
        descriptionHash: content.descriptionHash,
      }),
    )
    .digest("hex");
}

export function sourceContentFromSnapshot(row: TaskSnapshotInput): SnapshotSourceContent {
  return {
    responsibleBitrixUserId: row.responsibleBitrixUserId,
    title: row.title,
    statusLabel: row.statusLabel,
    deadline: row.deadline,
    descriptionHash: row.descriptionHash,
  };
}
