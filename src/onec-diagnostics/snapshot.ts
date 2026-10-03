import { createHash } from "node:crypto";
import { MAX_SOURCE_BYTES, MAX_SOURCE_RECORDS } from "../onec-clients/constants";
import { detectClientsSourceFormat } from "../onec-clients/format";
import { validateExtendedClientsFileBytes } from "../onec-clients/extended-validate";
import { isValidNonZeroUuid } from "../onec-clients/uuid";

type Row = Record<string, unknown>;

function guid(value: unknown): string | null {
  return typeof value === "string" && isValidNonZeroUuid(value)
    ? value.trim().toLowerCase()
    : null;
}

function safeLabel(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 256)
    : "";
}

/** Deliberately excludes client names, addresses, contacts and financial values. */
export function buildIdentitySnapshot(bytes: Buffer) {
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error("FILE_TOO_LARGE");
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!Array.isArray(parsed) || parsed.length > MAX_SOURCE_RECORDS) {
    throw new Error("INVALID_PAYLOAD");
  }
  const fields = new Map<string, { present: number; nonempty: number }>();
  const managers = new Map<string, { guid: string; names: Set<string>; clients: number }>();
  const clientGuids = new Set<string>();
  let invalidRows = 0;
  let invalidClientGuids = 0;
  let invalidManagerGuids = 0;
  let duplicateClientGuids = 0;
  const assignments: { clientGuid: string | null; holdingGuid: string | null; managerGuid: string | null }[] = [];
  for (const raw of parsed) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      invalidRows++;
      continue;
    }
    const row = raw as Row;
    for (const key of Object.keys(row)) {
      if (key.length > 128 || fields.size >= 128 && !fields.has(key)) throw new Error("TOO_MANY_FIELDS");
      const count = fields.get(key) ?? { present: 0, nonempty: 0 };
      count.present++;
      if (row[key] !== null && row[key] !== undefined && row[key] !== "" &&
          !(Array.isArray(row[key]) && row[key].length === 0)) count.nonempty++;
      fields.set(key, count);
    }
    const clientGuid = guid(row.guid_client);
    const managerGuid = guid(row.guid_manager);
    if (!clientGuid) invalidClientGuids++;
    else if (clientGuids.has(clientGuid)) duplicateClientGuids++;
    else clientGuids.add(clientGuid);
    if (!managerGuid) invalidManagerGuids++;
    else {
      const manager = managers.get(managerGuid) ?? { guid: managerGuid, names: new Set<string>(), clients: 0 };
      manager.names.add(safeLabel(row.name_manager));
      manager.clients++;
      managers.set(managerGuid, manager);
    }
    assignments.push({ clientGuid, holdingGuid: guid(row.guid_holding), managerGuid });
  }
  const sourceFormat = detectClientsSourceFormat(parsed);
  const extendedValidation = validateExtendedClientsFileBytes(bytes);
  const result = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    remotePath: "/LC/clients/all_clients.json",
    sourceModifiedAt: null, // Reading now does not prove when 1C generated the file.
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    records: parsed.length,
    sourceFormat,
    uniqueClientGuids: clientGuids.size,
    invalidRows, invalidClientGuids, invalidManagerGuids, duplicateClientGuids,
    fields: [...fields].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name: safeLabel(name), ...count })),
    managers: [...managers.values()].sort((a, b) => a.guid.localeCompare(b.guid))
      .map(m => ({ ...m, names: [...m.names].sort() })),
    assignments,
    extendedSummary: extendedValidation.ok
      ? extendedValidation.payload.diagnostics
      : {
          validationOk: false,
          issueCount: extendedValidation.issueCount,
          warningCount: extendedValidation.warningCount,
          ...(extendedValidation.diagnostics ?? {}),
          issueCodes: extendedValidation.issueCodes,
          warningCodes: extendedValidation.warningCodes,
          issuesTruncated: extendedValidation.issuesTruncated,
          warningsTruncated: extendedValidation.warningsTruncated,
        },
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 2_000_000) throw new Error("REPORT_TOO_LARGE");
  return result;
}
