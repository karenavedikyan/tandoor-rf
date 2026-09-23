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
  | {
      ok: false;
      issues: ValidationIssue[];
      warnings: ValidationWarning[];
      issueCount: number;
      warningCount: number;
    };

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
  issueCount: { value: number },
): void {
  issueCount.value += 1;
  if (issues.length < MAX_DETAILED_ERRORS) {
    issues.push(issue);
  }
}

function pushWarning(
  warnings: ValidationWarning[],
  warning: ValidationWarning,
  warningCount: { value: number },
): void {
  warningCount.value += 1;
  if (warnings.length < MAX_DETAILED_WARNINGS) {
    warnings.push(warning);
  }
}

function validateTelephone(value: unknown, index: number, issues: ValidationIssue[], issueCount: { value: number }): string[] | null {
  if (!Array.isArray(value)) {
    pushIssue(issues, { code: "INVALID_TYPE", field: "telephone", index }, issueCount);
    return null;
  }
  for (const item of value) {
    if (typeof item !== "string") {
      pushIssue(issues, { code: "INVALID_TYPE", field: "telephone", index }, issueCount);
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
  issueCount: { value: number },
  warningCount: { value: number },
): ParsedClientRecord | null {
  if (raw === null) {
    pushIssue(issues, { code: "NULL_RECORD", index }, issueCount);
    return null;
  }
  if (!isPlainObject(raw)) {
    pushIssue(issues, { code: "INVALID_ROOT", index }, issueCount);
    return null;
  }

  for (const key of KNOWN_CLIENT_KEYS) {
    if (!(key in raw)) {
      pushIssue(issues, { code: "MISSING_FIELD", field: key, index }, issueCount);
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
    }, warningCount);
  }

  if (typeof raw.guid_client !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "guid_client", index }, issueCount);
    return null;
  }
  if (!isValidNonZeroUuid(raw.guid_client)) {
    pushIssue(issues, { code: "INVALID_UUID", field: "guid_client", index }, issueCount);
    return null;
  }

  if (typeof raw.name_client !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "name_client", index }, issueCount);
    return null;
  }
  const nameClient = raw.name_client.trim();
  if (nameClient.length === 0) {
    pushIssue(issues, { code: "EMPTY_NAME", field: "name_client", index }, issueCount);
    return null;
  }

  if (typeof raw.guid_holding !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "guid_holding", index }, issueCount);
    return null;
  }
  const guidHoldingRaw = raw.guid_holding.trim();
  if (!isEmptyOrValidNonZeroUuid(guidHoldingRaw)) {
    pushIssue(issues, { code: "INVALID_UUID", field: "guid_holding", index }, issueCount);
    return null;
  }

  if (typeof raw.name_holding !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "name_holding", index }, issueCount);
    return null;
  }
  const nameHolding = raw.name_holding.trim();
  const hasHoldingId = guidHoldingRaw.length > 0;
  const hasHoldingName = nameHolding.length > 0;
  if (hasHoldingId !== hasHoldingName) {
    pushIssue(issues, { code: "HOLDING_CONTRACT", field: "guid_holding", index }, issueCount);
    return null;
  }

  if (typeof raw.guid_manager !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "guid_manager", index }, issueCount);
    return null;
  }
  if (!isValidNonZeroUuid(raw.guid_manager)) {
    pushIssue(issues, { code: "INVALID_UUID", field: "guid_manager", index }, issueCount);
    return null;
  }

  if (typeof raw.name_manager !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "name_manager", index }, issueCount);
    return null;
  }
  const nameManager = raw.name_manager.trim();
  if (nameManager.length === 0) {
    pushIssue(issues, { code: "EMPTY_NAME", field: "name_manager", index }, issueCount);
    return null;
  }

  if (typeof raw.address !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "address", index }, issueCount);
    return null;
  }
  const address = raw.address.trim();
  if (address.length === 0) {
    pushWarning(warnings, { code: "EMPTY_ADDRESS", field: "address", index }, warningCount);
  }

  const telephone = validateTelephone(raw.telephone, index, issues, issueCount);
  if (telephone === null) {
    return null;
  }
  const hasPhone = telephone.some((item) => item.trim().length > 0);
  if (!hasPhone) {
    pushWarning(warnings, { code: "EMPTY_TELEPHONE", field: "telephone", index }, warningCount);
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

export type ValidateClientsLimits = {
  maxSourceBytes?: number;
  maxSourceRecords?: number;
};

export function validateClientsFileBytes(
  bytes: Buffer,
  limits?: ValidateClientsLimits,
): ValidationResult {
  const maxSourceBytes = limits?.maxSourceBytes ?? MAX_SOURCE_BYTES;
  const maxSourceRecords = limits?.maxSourceRecords ?? MAX_SOURCE_RECORDS;
  const issues: ValidationIssue[] = [];
  const warnings: ValidationWarning[] = [];
  const issueCount = { value: 0 };
  const warningCount = { value: 0 };

  if (bytes.length > maxSourceBytes) {
    pushIssue(issues, { code: "FILE_TOO_LARGE" }, issueCount);
    return { ok: false, issues, warnings, issueCount: issueCount.value, warningCount: warningCount.value };
  }

  const withoutBom = stripUtf8Bom(bytes);
  const text = decodeUtf8(withoutBom);
  if (text === null) {
    pushIssue(issues, { code: "INVALID_UTF8" }, issueCount);
    return { ok: false, issues, warnings, issueCount: issueCount.value, warningCount: warningCount.value };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    pushIssue(issues, { code: "INVALID_JSON" }, issueCount);
    return { ok: false, issues, warnings, issueCount: issueCount.value, warningCount: warningCount.value };
  }

  if (!Array.isArray(parsed)) {
    pushIssue(issues, { code: "INVALID_ROOT" }, issueCount);
    return { ok: false, issues, warnings, issueCount: issueCount.value, warningCount: warningCount.value };
  }

  if (parsed.length === 0) {
    pushIssue(issues, { code: "EMPTY_ARRAY" }, issueCount);
    return { ok: false, issues, warnings, issueCount: issueCount.value, warningCount: warningCount.value };
  }

  if (parsed.length > maxSourceRecords) {
    pushIssue(issues, { code: "TOO_MANY_RECORDS" }, issueCount);
    return { ok: false, issues, warnings, issueCount: issueCount.value, warningCount: warningCount.value };
  }

  const records: ParsedClientRecord[] = [];
  const seenClients = new Set<string>();

  for (let index = 0; index < parsed.length; index += 1) {
    const record = validateRecord(parsed[index], index, issues, warnings, issueCount, warningCount);
    if (record === null) {
      continue;
    }
    if (seenClients.has(record.guid_client)) {
      pushIssue(issues, { code: "DUPLICATE_CLIENT", field: "guid_client", index }, issueCount);
      continue;
    }
    seenClients.add(record.guid_client);
    records.push(record);
  }

  if (issueCount.value > 0) {
    return { ok: false, issues, warnings, issueCount: issueCount.value, warningCount: warningCount.value };
  }

  return {
    ok: true,
    payload: {
      sha256: sha256Hex(bytes),
      byteSize: bytes.length,
      recordCount: records.length,
      records,
      warnings,
      warningCount: warningCount.value,
    },
  };
}
