export const REVIEW_STATES = [
  "unreviewed",
  "in_progress",
  "awaiting_1c_fix",
  "completed",
  "needs_recheck",
] as const;

export type ReviewState = (typeof REVIEW_STATES)[number];

export const REVIEW_DECISIONS = [
  "confirm_current_manager",
  "propose_transfer",
  "request_clarification",
  "propose_active",
  "propose_dormant",
  "propose_closed",
  "propose_archive",
] as const;

export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const UNASSIGNED_CATEGORIES = [
  "opt_without_rop_team",
  "opt_without_account_link",
  "manager_outside_opt_roster",
  "unconfirmed_responsible",
] as const;

export type UnassignedCategory = (typeof UNASSIGNED_CATEGORIES)[number];

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  unreviewed: "Не проверен",
  in_progress: "В работе",
  awaiting_1c_fix: "Ожидает исправления в 1С",
  completed: "Завершён",
  needs_recheck: "Требует повторной проверки",
};

export const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = {
  confirm_current_manager: "Подтвердить текущего ответственного",
  propose_transfer: "Предложить передачу",
  request_clarification: "Запросить уточнение",
  propose_active: "Предложить статус «активный»",
  propose_dormant: "Предложить статус «спящий»",
  propose_closed: "Предложить статус «закрытый»",
  propose_archive: "Предложить архивирование",
};

export const UNASSIGNED_CATEGORY_LABELS: Record<UnassignedCategory, string> = {
  opt_without_rop_team: "Сотрудники ОПТ без команды РОП",
  opt_without_account_link: "Сотрудники ОПТ без подтверждённой связи с аккаунтом",
  manager_outside_opt_roster: "Ответственные вне списка ОПТ",
  unconfirmed_responsible: "Без подтверждённого ответственного / конфликт назначения",
};
