export const COMPLETENESS_REASONS = [
  "missing_rop",
  "missing_manager",
  "missing_regional",
  "responsible_outside_roster",
  "invalid_or_conflicting_assignment",
  "org_role_conflict",
  "field_not_provided",
  "data_stale",
  "roster_unavailable",
] as const;

export type CompletenessReason = (typeof COMPLETENESS_REASONS)[number];

export const COMPLETENESS_REASON_LABELS: Record<CompletenessReason, string> = {
  missing_rop: "Не указан РОП",
  missing_manager: "Не указан ответственный менеджер",
  missing_regional: "Не указан региональный менеджер",
  responsible_outside_roster: "Ответственный вне справочника ОПТ",
  invalid_or_conflicting_assignment: "Некорректное или противоречивое назначение",
  org_role_conflict: "Противоречие организационной роли и назначения",
  field_not_provided: "Поле не передано в выгрузке",
  data_stale: "Данные устарели",
  roster_unavailable: "Справочник ОПТ недоступен",
};

export type CompletenessEntityKind = "client" | "outlet";

export type CompletenessQueueItem = {
  entityKind: CompletenessEntityKind;
  guidClient: string;
  guidStore: string | null;
  name: string;
  address: string;
  parentClientName: string | null;
  knownAssignees: {
    rop: { guid: string | null; name: string | null };
    manager: { guid: string | null; name: string | null };
    regional: { guid: string | null; name: string | null };
  };
  reasons: CompletenessReason[];
  reasonLabels: string[];
  lastImportedAt: string | null;
  lastImportedAtLabel: string | null;
  reviewState: string | null;
  reviewStateLabel: string | null;
  hasLinkedAccount: boolean | null;
};
