const STATUS_RU: Record<string, string> = {
  waiting: "Ожидает выполнения",
  in_progress: "В работе",
  awaiting_control: "Ждёт контроля",
  completed: "Завершена",
  deferred: "Отложена",
  unknown: "Статус неизвестен",
};

export function formatTaskStatusLabel(statusLabel: string): string {
  return STATUS_RU[statusLabel] ?? statusLabel;
}
