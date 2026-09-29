export function sampleValidBitrixTask(overrides: Record<string, unknown> = {}) {
  return {
    ID: "10",
    TITLE: "Sample task",
    REAL_STATUS: 5,
    RESPONSIBLE_ID: "42",
    CREATED_BY: "7",
    CHANGED_DATE: "2026-09-29T10:00:00+03:00",
    ...overrides,
  };
}
