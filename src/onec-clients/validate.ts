import {
  KNOWN_CLIENT_KEYS,
  MAX_DETAILED_ERRORS,
  MAX_DETAILED_WARNINGS,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_RECORDS,
  type KnownClientKey,
} from "./constants";
import { sha256Hex } from "./sha256";
import type {
  ParsedClientRecord,
  ValidatedClientsPayload,
  ValidationIssue,
  ValidationWarning,
} from "./types";
import { isEmptyOrValidNonZeroUuid, isValidNonZeroUuid, normalizeUuid } from "./uuid";

export type ValidationResult =
  | { ok: true; payload: ValidatedClientsPayload }
  | { ok: false; issues: ValidationIssue[]; warnings: ValidationWarning[] };

function stripUtf8Bom(bytes: Buffer): Buffer {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3);
  }
  return bytes;
}

function decodeUtf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pushIssue(
  issues: ValidationIssue[],
  issue: ValidationIssue,
): void {
  if (issues.length < MAX_DETAILED_ERRORS) {
    issues.push(issue);
  }
}

function pushWarning(
  warnings: ValidationWarning[],
  warning: ValidationWarning,
): void {
  if (warnings.length < MAX_DETAILED_WARNINGS) {
    warnings.push(warning);
  }
}

function validateTelephone(value: unknown, index: number, issues: ValidationIssue[]): string[] | null {
  if (!Array.isArray(value)) {
    pushIssue(issues, { code: "INVALID_TYPE", field: "telephone", index });
    return null;
  }
  for (const item of value) {
    if (typeof item !== "string") {
      pushIssue(issues, { code: "INVALID_TYPE", field: "telephone", index });
      return null;
    }
  }
  return value;
}

function validateRecord(
  raw: unknown,
  index: number,
  issues: ValidationIssue[],
  warnings: ValidationWarning[],
): ParsedClientRecord | null {
  if (raw === null) {
    pushIssue(issues, { code: "NULL_RECORD", index });
    return null;
  }
  if (!isPlainObject(raw)) {
    pushIssue(issues, { code: "INVALID_ROOT", index });
    return null;
  }

  for (const key of KNOWN_CLIENT_KEYS) {
    if (!(key in raw)) {
      pushIssue(issues, { code: "MISSING_FIELD", field: key, index });
      return null;
    }
  }

  const extraKeys = Object.keys(raw).filter(
    (key) => !KNOWN_CLIENT_KEYS.includes(key as KnownClientKey),
  );
  if (extraKeys.length > 0) {
    pushWarning(warnings, {
      code: "EXTRA_FIELDS",
      index,
      extraFieldCount: extraKeys.length,
    });
  }

  if (typeof raw.guid_client !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "guid_client", index });
    return null;
  }
  if (!isValidNonZeroUuid(raw.guid_client)) {
    pushIssue(issues, { code: "INVALID_UUID", field: "guid_client", index });
    return null;
  }

  if (typeof raw.name_client !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "name_client", index });
    return null;
  }
  const nameClient = raw.name_client.trim();
  if (nameClient.length === 0) {
    pushIssue(issues, { code: "EMPTY_NAME", field: "name_client", index });
    return null;
  }

  if (typeof raw.guid_holding !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "guid_holding", index });
    return null;
  }
  const guidHoldingRaw = raw.guid_holding.trim();
  if (!isEmptyOrValidNonZeroUuid(guidHoldingRaw)) {
    pushIssue(issues, { code: "INVALID_UUID", field: "guid_holding", index });
    return null;
  }

  if (typeof raw.name_holding !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "name_holding", index });
    return null;
  }
  const nameHolding = raw.name_holding.trim();
  const hasHoldingId = guidHoldingRaw.length > 0;
  const hasHoldingName = nameHolding.length > 0;
  if (hasHoldingId !== hasHoldingName) {
    pushIssue(issues, { code: "HOLDING_CONTRACT", field: "guid_holding", index });
    return null;
  }

  if (typeof raw.guid_manager !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "guid_manager", index });
    return null;
  }
  if (!isValidNonZeroUuid(raw.guid_manager)) {
    pushIssue(issues, { code: "INVALID_UUID", field: "guid_manager", index });
    return null;
  }

  if (typeof raw.name_manager !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "name_manager", index });
    return null;
  }
  const nameManager = raw.name_manager.trim();
  if (nameManager.length === 0) {
    pushIssue(issues, { code: "EMPTY_NAME", field: "name_manager", index });
    return null;
  }

  if (typeof raw.address !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "address", index });
    return null;
  }
  const address = raw.address.trim();
  if (address.length === 0) {
    pushWarning(warnings, { code: "EMPTY_ADDRESS", field: "address", index });
  }

  const telephone = validateTelephone(raw.telephone, index, issues);
  if (telephone === null) {
    return null;
  }
  const hasPhone = telephone.some((item) => item.trim().length > 0);
  if (!hasPhone) {
    pushWarning(warnings, { code: "EMPTY_TELEPHONE", field: "telephone", index });
  }

  return {
    guid_client: normalizeUuid(raw.guid_client),
    name_client: nameClient,
    guid_holding: hasHoldingId ? normalizeUuid(guidHoldingRaw) : null,
    name_holding: nameHolding,
    guid_manager: normalizeUuid(raw.guid_manager),
    name_manager: nameManager,
    address: raw.address,
    telephone,
  };
}

export function validateClientsFileBytes(bytes: Buffer): ValidationResult {
  const issues: ValidationIssue[] = [];
  const warnings: ValidationWarning[] = [];

  if (bytes.length > MAX_SOURCE_BYTES) {
    pushIssue(issues, { code: "FILE_TOO_LARGE" });
    return { ok: false, issues, warnings };
  }

  const withoutBom = stripUtf8Bom(bytes);
  const text = decodeUtf8(withoutBom);
  if (text === null) {
    pushIssue(issues, { code: "INVALID_UTF8" });
    return { ok: false, issues, warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    pushIssue(issues, { code: "INVALID_JSON" });
    return { ok: false, issues, warnings };
  }

  if (!Array.isArray(parsed)) {
    pushIssue(issues, { code: "INVALID_ROOT" });
    return { ok: false, issues, warnings };
  }

  if (parsed.length === 0) {
    pushIssue(issues, { code: "EMPTY_ARRAY" });
    return { ok: false, issues, warnings };
  }

  if (parsed.length > MAX_SOURCE_RECORDS) {
    pushIssue(issues, { code: "TOO_MANY_RECORDS" });
    return { ok: false, issues, warnings };
  }

  const records: ParsedClientRecord[] = [];
  const seenClients = new Set<string>();

  for (let index = 0; index < parsed.length; index += 1) {
    const record = validateRecord(parsed[index], index, issues, warnings);
    if (record === null) {
      continue;
    }
    if (seenClients.has(record.guid_client)) {
      pushIssue(issues, { code: "DUPLICATE_CLIENT", field: "guid_client", index });
      continue;
    }
    seenClients.add(record.guid_client);
    records.push(record);
  }

  if (issues.length > 0) {
    return { ok: false, issues, warnings };
  }

  return {
    ok: true,
    payload: {
      sha256: sha256Hex(bytes),
      byteSize: bytes.length,
      recordCount: records.length,
      records,
      warnings,
    },
  };
}
