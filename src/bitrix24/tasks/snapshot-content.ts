import { createHash } from "node:crypto";
import type { Bitrix24ObjectType } from "../labels/format";
import type { TaskSnapshotInput } from "./repository";

export type SnapshotCacheContent = {
  responsibleBitrixUserId: string | null;
  title: string;
  statusLabel: string;
  deadline: string | null;
  descriptionHash: string;
  published: boolean;
};

export type SnapshotBindingContent = {
  objectType: Bitrix24ObjectType | null;
  objectGuid: string | null;
  labelCode: string | null;
  bindingStatus: string;
  conflictReason: string | null;
  responsibleBitrixUserId: string | null;
};

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

export function fingerprintCacheContent(content: SnapshotCacheContent): string {
  return createHash("sha256")
    .update(
      stableJson({
        responsibleBitrixUserId: content.responsibleBitrixUserId,
        title: content.title,
        statusLabel: content.statusLabel,
        deadline: content.deadline,
        descriptionHash: content.descriptionHash,
        published: content.published,
      }),
    )
    .digest("hex");
}

export function fingerprintBindingContent(content: SnapshotBindingContent): string {
  return createHash("sha256")
    .update(
      stableJson({
        objectType: content.objectType,
        objectGuid: content.objectGuid,
        labelCode: content.labelCode,
        bindingStatus: content.bindingStatus,
        conflictReason: content.conflictReason,
        responsibleBitrixUserId: content.responsibleBitrixUserId,
      }),
    )
    .digest("hex");
}

export function cacheContentFromSnapshot(row: TaskSnapshotInput): SnapshotCacheContent {
  return {
    responsibleBitrixUserId: row.responsibleBitrixUserId,
    title: row.title,
    statusLabel: row.statusLabel,
    deadline: row.deadline,
    descriptionHash: row.descriptionHash,
    published: row.published,
  };
}

export function bindingContentFromSnapshot(row: TaskSnapshotInput): SnapshotBindingContent {
  return {
    objectType: row.objectType,
    objectGuid: row.objectGuid,
    labelCode: row.labelCode,
    bindingStatus: row.bindingStatus,
    conflictReason: row.conflictReason,
    responsibleBitrixUserId: row.responsibleBitrixUserId,
  };
}
