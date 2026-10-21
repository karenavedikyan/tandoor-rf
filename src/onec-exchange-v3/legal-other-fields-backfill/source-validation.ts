import type { parseClientsOtherFromJsonBytes } from "./parse-clients-file";

export type ParsedClientsFile = ReturnType<typeof parseClientsOtherFromJsonBytes>;

export type ClientsSourceValidation =
  | { ok: true; parsed: ParsedClientsFile }
  | {
      ok: false;
      code: "DUPLICATE_GUIDS" | "PARSE_ERRORS" | "EMPTY_SOURCE";
      message: string;
      duplicateGuids?: string[];
      parseErrors?: string[];
    };

export function validateClientsSourceForBackfill(parsed: ParsedClientsFile): ClientsSourceValidation {
  if (!parsed.rows.length) {
    return { ok: false, code: "EMPTY_SOURCE", message: "Clients file contains no valid legal rows." };
  }
  if (parsed.duplicateGuids.length > 0) {
    return {
      ok: false,
      code: "DUPLICATE_GUIDS",
      message: "Clients file contains duplicate guid_client values.",
      duplicateGuids: parsed.duplicateGuids,
    };
  }
  if (parsed.parseErrors.length > 0) {
    return {
      ok: false,
      code: "PARSE_ERRORS",
      message: "Clients file contains invalid records.",
      parseErrors: parsed.parseErrors,
    };
  }
  return { ok: true, parsed };
}
