import type { WholesaleEmployeeRecord } from "./employee-roster";

export type ResolvedRosterFieldValues = {
  nameManager: string;
  guidPost: string | null;
  post: string | null;
  condition: string | null;
  dateOfAssumption: string | null;
  guidWorkSchedule: string | null;
  workSchedule: string | null;
  decree: string | null;
  email: string | null;
  telephone: string | null;
};

type ExistingRosterFieldValues = {
  name_manager: string;
  guid_post: string | null;
  post: string | null;
  condition: string | null;
  date_of_assumption: string | null;
  guid_work_schedule: string | null;
  work_schedule: string | null;
  decree: string | null;
  email: string | null;
  telephone: string | null;
};

export function hasRosterRawKey(raw: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

export function canonicalAssumptionTimestamptz(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function canonicalUuid(value: string | null | undefined): string | null {
  return value?.trim().toLowerCase() ?? null;
}

function resolveApplyValue<T>(
  raw: Record<string, unknown>,
  key: string,
  parsed: T | null,
  existing: T | null,
): T | null {
  if (hasRosterRawKey(raw, key)) {
    return parsed;
  }
  return existing;
}

export function resolveRosterFieldValues(
  record: WholesaleEmployeeRecord,
  existing: ExistingRosterFieldValues | undefined,
): ResolvedRosterFieldValues {
  const current = existing;
  return {
    nameManager: hasRosterRawKey(record.raw, "name_manager")
      ? record.nameManager
      : (current?.name_manager ?? ""),
    guidPost: resolveApplyValue(record.raw, "guid_post", record.guidPost, current?.guid_post ?? null),
    post: resolveApplyValue(record.raw, "post", record.post, current?.post ?? null),
    condition: resolveApplyValue(record.raw, "condition", record.condition, current?.condition ?? null),
    dateOfAssumption: resolveApplyValue(
      record.raw,
      "date_of_assumption",
      record.dateOfAssumption,
      current?.date_of_assumption ?? null,
    ),
    guidWorkSchedule: resolveApplyValue(
      record.raw,
      "guid_work_schedule",
      record.guidWorkSchedule,
      current?.guid_work_schedule ?? null,
    ),
    workSchedule: resolveApplyValue(
      record.raw,
      "work_schedule",
      record.workSchedule,
      current?.work_schedule ?? null,
    ),
    decree: resolveApplyValue(record.raw, "decree", record.decree, current?.decree ?? null),
    email: resolveApplyValue(record.raw, "email", record.email, current?.email ?? null),
    telephone: resolveApplyValue(record.raw, "telephone", record.telephone, current?.telephone ?? null),
  };
}

export function resolvedRosterValuesEqual(
  left: ResolvedRosterFieldValues,
  right: ResolvedRosterFieldValues,
): boolean {
  return (
    left.nameManager === right.nameManager &&
    canonicalUuid(left.guidPost) === canonicalUuid(right.guidPost) &&
    (left.post ?? null) === (right.post ?? null) &&
    (left.condition ?? null) === (right.condition ?? null) &&
    canonicalAssumptionTimestamptz(left.dateOfAssumption) ===
      canonicalAssumptionTimestamptz(right.dateOfAssumption) &&
    canonicalUuid(left.guidWorkSchedule) === canonicalUuid(right.guidWorkSchedule) &&
    (left.workSchedule ?? null) === (right.workSchedule ?? null) &&
    (left.decree ?? null) === (right.decree ?? null) &&
    (left.email ?? null) === (right.email ?? null) &&
    (left.telephone ?? null) === (right.telephone ?? null)
  );
}

export function rosterRecordValuesEqual(
  existing: ExistingRosterFieldValues,
  record: WholesaleEmployeeRecord,
): boolean {
  const resolved = resolveRosterFieldValues(record, existing);
  const existingResolved: ResolvedRosterFieldValues = {
    nameManager: existing.name_manager,
    guidPost: existing.guid_post,
    post: existing.post,
    condition: existing.condition,
    dateOfAssumption: existing.date_of_assumption,
    guidWorkSchedule: existing.guid_work_schedule,
    workSchedule: existing.work_schedule,
    decree: existing.decree,
    email: existing.email,
    telephone: existing.telephone,
  };
  return resolvedRosterValuesEqual(resolved, existingResolved);
}
