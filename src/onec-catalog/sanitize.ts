import { MAX_DETAILED_ERRORS, MAX_DETAILED_QUARANTINE, MAX_DETAILED_WARNINGS } from "./constants";
import type { CatalogImportResult } from "./types";

export const PLAIN_FTP_TRANSPORT_WARNING =
  "Transport uses plain FTP; ensure network path is trusted and credentials stay server-side.";

export function sanitizeCatalogImportResult(result: CatalogImportResult): CatalogImportResult {
  return {
    ...result,
    errors: result.errors?.slice(0, MAX_DETAILED_ERRORS),
    warnings: result.warnings?.slice(0, MAX_DETAILED_WARNINGS),
    quarantine: result.quarantine?.slice(0, MAX_DETAILED_QUARANTINE),
    errorsTruncated: result.errorCount !== undefined && result.errorCount > MAX_DETAILED_ERRORS,
    warningsTruncated:
      result.warningCount !== undefined && result.warningCount > MAX_DETAILED_WARNINGS,
    quarantineTruncated:
      result.quarantineCount !== undefined && result.quarantineCount > MAX_DETAILED_QUARANTINE,
  };
}
