import { bitrixChangedAtToDate } from "../bitrix24/parse-changed-at";
import { buildTaskOverviewMetadata } from "../bitrix24/tasks/overview-metadata";

export type DeadlineGroup =
  | "overdue"
  | "today"
  | "upcoming"
  | "no_deadline"
  | "completed";

export const OPEN_DEADLINE_GROUPS: DeadlineGroup[] = [
  "overdue",
  "today",
  "upcoming",
  "no_deadline",
];

const GROUP_SORT_RANK: Record<DeadlineGroup, number> = {
  overdue: 0,
  today: 1,
  upcoming: 2,
  no_deadline: 3,
  completed: 4,
};

function mskDateKey(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function getMskTodayKey(nowMs = Date.now()): string {
  return mskDateKey(new Date(nowMs));
}

export function classifyDeadlineGroup(
  statusLabel: string,
  deadline: string | null | undefined,
  nowMs = Date.now(),
): DeadlineGroup {
  if (statusLabel === "completed") {
    return "completed";
  }
  const date = bitrixChangedAtToDate(deadline ?? null);
  if (!date) {
    return "no_deadline";
  }
  const deadlineKey = mskDateKey(date);
  const todayKey = getMskTodayKey(nowMs);
  if (deadlineKey < todayKey) {
    return "overdue";
  }
  if (deadlineKey === todayKey) {
    return "today";
  }
  return "upcoming";
}

export type WorkQueueSortRow = {
  deadlineGroup: DeadlineGroup;
  deadlineAt: string | null;
  taskId: string;
};

export function compareWorkQueueRows(a: WorkQueueSortRow, b: WorkQueueSortRow): number {
  const rankDiff = GROUP_SORT_RANK[a.deadlineGroup] - GROUP_SORT_RANK[b.deadlineGroup];
  if (rankDiff !== 0) {
    return rankDiff;
  }
  const aDue = a.deadlineAt ? Date.parse(a.deadlineAt) : Number.POSITIVE_INFINITY;
  const bDue = b.deadlineAt ? Date.parse(b.deadlineAt) : Number.POSITIVE_INFINITY;
  if (aDue !== bDue) {
    return aDue - bDue;
  }
  return a.taskId.localeCompare(b.taskId);
}

export function buildWorkOverviewFields(
  statusLabel: string,
  deadline: string | null,
  canReadDeadline: boolean,
  nowMs = Date.now(),
): {
  deadlineGroup: DeadlineGroup;
  isOpen: boolean | null;
  isOverdue: boolean | null;
  deadlineAt: string | null;
} {
  const overview = buildTaskOverviewMetadata(statusLabel, deadline, canReadDeadline, nowMs);
  return {
    deadlineGroup: classifyDeadlineGroup(statusLabel, deadline, nowMs),
    isOpen: overview.isOpen,
    isOverdue: overview.isOverdue,
    deadlineAt: overview.deadlineAt,
  };
}
