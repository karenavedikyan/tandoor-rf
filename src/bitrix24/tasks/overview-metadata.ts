import { bitrixChangedAtToDate } from "../parse-changed-at";

/** Metadata from an already authorized task, never from the whole portal. */
export function buildTaskOverviewMetadata(
  status: string,
  deadline: string | null,
  canReadDeadline: boolean,
  nowMs = Date.now(),
): { isOpen: boolean | null; isOverdue: boolean | null; deadlineAt: string | null } {
  const isOpen = status === "completed"
    ? false
    : ["waiting", "in_progress", "awaiting_control", "deferred"].includes(status)
      ? true
      : null;
  // A published brief does not grant access to the internal deadline.
  if (!canReadDeadline) {
    return { isOpen, isOverdue: isOpen === false ? false : null, deadlineAt: null };
  }
  const date = bitrixChangedAtToDate(deadline);
  const isOverdue = isOpen === false ? false
    : isOpen === null ? null
      : !deadline ? false
        : date ? date.getTime() < nowMs : null;
  return { isOpen, isOverdue, deadlineAt: date?.toISOString() ?? null };
}
