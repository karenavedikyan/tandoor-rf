import { createHash } from "node:crypto";
import { pickSupportedOtherFields } from "../other-fields";
import { parseLegalRecord } from "../parse-records";

export type ParsedClientsOtherRow = {
  guidClient: string;
  otherFields: Record<string, unknown>;
};

export function stableJsonHash(value: unknown): string {
  return createHash("sha256").update(stableJsonStringify(value)).digest("hex");
}

export function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

export function parseClientsOtherFromJsonBytes(bytes: Buffer): {
  sourceSha256: string;
  rows: ParsedClientsOtherRow[];
  duplicateGuids: string[];
  parseErrors: string[];
} {
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const raw = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("Clients JSON must be an array.");
  }
  const rows: ParsedClientsOtherRow[] = [];
  const seen = new Map<string, number>();
  const duplicateGuids: string[] = [];
  const parseErrors: string[] = [];
  for (const entry of raw) {
    const errors: string[] = [];
    const parsed = parseLegalRecord(entry, errors);
    if (!parsed) {
      parseErrors.push(...errors);
      continue;
    }
    const guid = parsed.guidClient.toLowerCase();
    if (seen.has(guid)) {
      duplicateGuids.push(guid);
      continue;
    }
    seen.set(guid, 1);
    rows.push({
      guidClient: guid,
      otherFields: pickSupportedOtherFields(parsed.otherFields as Record<string, unknown>),
    });
  }
  return { sourceSha256, rows, duplicateGuids, parseErrors };
}
