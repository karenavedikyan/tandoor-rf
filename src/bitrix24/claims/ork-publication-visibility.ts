import type { Bitrix24ObjectType } from "../labels/format";
import type {
  ActiveSummaryPublicationMeta,
  SummaryPublicationOrigin,
  SummaryPublicationRow,
} from "../tasks/work-repository";

export type OrkPublicationAlignmentInput = {
  cacheVersion: number;
  objectType: Bitrix24ObjectType | null;
  objectGuid: string | null;
  bindingStatus: string | null;
};

export type PublicationWithMeta = SummaryPublicationRow & {
  taskCacheVersion?: number | null;
  publicationOrigin?: SummaryPublicationOrigin;
};

export function isOrkPublicationAlignedWithTask(
  task: OrkPublicationAlignmentInput,
  publication: PublicationWithMeta | ActiveSummaryPublicationMeta | null,
): boolean {
  if (!publication || publication.publicationOrigin !== "ork_sync") {
    return false;
  }
  if (
    task.bindingStatus !== "confirmed" ||
    !task.objectType ||
    !task.objectGuid
  ) {
    return false;
  }
  if (
    !publication.objectType ||
    !publication.objectGuid ||
    publication.objectType !== task.objectType ||
    publication.objectGuid.toLowerCase() !== task.objectGuid.toLowerCase()
  ) {
    return false;
  }
  const pubVersion =
    "taskCacheVersion" in publication ? publication.taskCacheVersion : null;
  if (pubVersion === null || pubVersion !== task.cacheVersion) {
    return false;
  }
  return true;
}

export function filterVisibleOrkPublication<T extends PublicationWithMeta>(
  task: OrkPublicationAlignmentInput,
  publication: T | null,
): T | null {
  if (!publication) {
    return null;
  }
  if (publication.publicationOrigin === "admin") {
    return publication;
  }
  return isOrkPublicationAlignedWithTask(task, publication) ? publication : null;
}
