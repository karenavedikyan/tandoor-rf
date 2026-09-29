import { MAX_DETAILED_WARNINGS } from "../onec-clients/constants";
import type { ValidationWarning } from "../onec-clients/types";

const MAX_WARNINGS_JSON_BYTES = 65_536;

export type PreparedJournalWarnings = {
  warningCount: number;
  warningsJson: string;
  warningsTruncated: boolean;
};

export function prepareJournalWarnings(
  warnings: ValidationWarning[],
  options?: { totalWarningCount?: number },
): PreparedJournalWarnings {
  const warningCount = options?.totalWarningCount ?? warnings.length;
  let stored = warnings.slice(0, MAX_DETAILED_WARNINGS);
  let warningsJson = JSON.stringify(stored);
  let warningsTruncated = warningCount > stored.length;

  while (Buffer.byteLength(warningsJson, "utf8") > MAX_WARNINGS_JSON_BYTES && stored.length > 0) {
    stored = stored.slice(0, stored.length - 1);
    warningsJson = JSON.stringify(stored);
    warningsTruncated = true;
  }

  return { warningCount, warningsJson, warningsTruncated };
}
