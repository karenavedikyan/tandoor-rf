import {
  KNOWN_CLIENT_KEYS,
  MAX_DETAILED_ERRORS,
  MAX_DETAILED_WARNINGS,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_RECORDS,
  type KnownClientKey,
} from "./constants";
import { detectClientsSourceFormat, isExtendedClientRecord } from "./format";
import { parseManagerRef, parseOptionalHoldingGuid } from "./manager-status";
import { sha256Hex } from "./sha256";
import type {
  ExtendedDiagnosticsSummary,
  ExtendedValidationIssue,
  ExtendedValidationWarning,
  ParsedExtendedClientRecord,
  ParsedOutletAdditional,
  ParsedOutletAddress,
  ParsedOutletContacts,
  ParsedOutletLoading,
  ParsedOutletLpr,
  ParsedOutletManagers,
  ParsedRetailOutlet,
  ValidatedExtendedClientsPayload,
} from "./extended-types";
import type { ValidationIssue, ValidationWarning } from "./types";
import { isEmptyOrValidNonZeroUuid, isValidNonZeroUuid, normalizeUuid } from "./uuid";

export type ExtendedValidationResult =
  | { ok: true; payload: ValidatedExtendedClientsPayload }
  | {
      ok: false;
      issues: ExtendedValidationIssue[];
      warnings: ExtendedValidationWarning[];
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
  issues: ExtendedValidationIssue[],
  issue: ExtendedValidationIssue,
  issueCount: { value: number },
): void {
  issueCount.value += 1;
  if (issues.length < MAX_DETAILED_ERRORS) {
    issues.push(issue);
  }
}

function pushWarning(
  warnings: ExtendedValidationWarning[],
  warning: ExtendedValidationWarning,
  warningCount: { value: number },
): void {
  warningCount.value += 1;
  if (warnings.length < MAX_DETAILED_WARNINGS) {
    warnings.push(warning);
  }
}

function validateTelephone(
  value: unknown,
  index: number,
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): string[] | null {
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

function readStrictBoolean(value: unknown): boolean | null | "invalid" {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return "invalid";
}

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readOptionalCalendarDate(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return "invalid";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return "invalid";
  }
  return trimmed;
}

function validateLegacyCore(
  raw: Record<string, unknown>,
  index: number,
  issues: ExtendedValidationIssue[],
  warnings: ExtendedValidationWarning[],
  issueCount: { value: number },
  warningCount: { value: number },
  extendedFile: boolean,
): {
  guid_client: string;
  name_client: string;
  guid_holding: string | null;
  name_holding: string;
  guid_manager: string;
  name_manager: string;
  address: string;
  telephone: string[];
} | null {
  for (const key of KNOWN_CLIENT_KEYS) {
    if (!(key in raw)) {
      pushIssue(issues, { code: "MISSING_FIELD", field: key, index }, issueCount);
      return null;
    }
  }

  const extraKeys = Object.keys(raw).filter(
    (key) => !KNOWN_CLIENT_KEYS.includes(key as KnownClientKey) &&
      key !== "holding" &&
      key !== "retail_outlets" &&
      key !== "guid_regional_manager" &&
      key !== "name_regional_manager" &&
      key !== "guid_hardware_manager" &&
      key !== "name_hardware_manager" &&
      key !== "guid_head_of_the_sales_department" &&
      key !== "name_head_of_the_sales_department",
  );
  if (extraKeys.length > 0) {
    pushWarning(warnings, {
      code: "EXTRA_FIELDS",
      index,
      extraFieldCount: extraKeys.length,
    }, warningCount);
  }

  if (typeof raw.guid_client !== "string" || !isValidNonZeroUuid(raw.guid_client)) {
    pushIssue(issues, {
      code: typeof raw.guid_client !== "string" ? "INVALID_TYPE" : "INVALID_UUID",
      field: "guid_client",
      index,
    }, issueCount);
    return null;
  }

  if (typeof raw.name_client !== "string" || raw.name_client.trim().length === 0) {
    pushIssue(issues, {
      code: typeof raw.name_client !== "string" ? "INVALID_TYPE" : "EMPTY_NAME",
      field: "name_client",
      index,
    }, issueCount);
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
  const hasHoldingId = guidHoldingRaw.length > 0;

  if (typeof raw.name_holding !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "name_holding", index }, issueCount);
    return null;
  }
  const nameHolding = raw.name_holding.trim();
  const hasHoldingName = nameHolding.length > 0;

  if (!extendedFile && hasHoldingId !== hasHoldingName) {
    pushIssue(issues, { code: "HOLDING_CONTRACT", field: "guid_holding", index }, issueCount);
    return null;
  }

  if (typeof raw.guid_manager !== "string" || !isValidNonZeroUuid(raw.guid_manager)) {
    pushIssue(issues, {
      code: typeof raw.guid_manager !== "string" ? "INVALID_TYPE" : "INVALID_UUID",
      field: "guid_manager",
      index,
    }, issueCount);
    return null;
  }

  if (typeof raw.name_manager !== "string" || raw.name_manager.trim().length === 0) {
    pushIssue(issues, {
      code: typeof raw.name_manager !== "string" ? "INVALID_TYPE" : "EMPTY_NAME",
      field: "name_manager",
      index,
    }, issueCount);
    return null;
  }

  if (typeof raw.address !== "string") {
    pushIssue(issues, { code: "INVALID_TYPE", field: "address", index }, issueCount);
    return null;
  }
  if (raw.address.trim().length === 0) {
    pushWarning(warnings, { code: "EMPTY_ADDRESS", field: "address", index }, warningCount);
  }

  const telephone = validateTelephone(raw.telephone, index, issues, issueCount);
  if (telephone === null) {
    return null;
  }
  if (!telephone.some((item) => item.trim().length > 0)) {
    pushWarning(warnings, { code: "EMPTY_TELEPHONE", field: "telephone", index }, warningCount);
  }

  return {
    guid_client: normalizeUuid(raw.guid_client),
    name_client: raw.name_client.trim(),
    guid_holding: hasHoldingId ? normalizeUuid(guidHoldingRaw) : null,
    name_holding: nameHolding,
    guid_manager: normalizeUuid(raw.guid_manager),
    name_manager: raw.name_manager.trim(),
    address: raw.address,
    telephone,
  };
}

function parseOutletManagers(
  raw: unknown,
  clientIndex: number,
  outletIndex: number,
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): ParsedOutletManagers | null {
  if (!isPlainObject(raw)) {
    pushIssue(issues, {
      code: "INVALID_OUTLET_SHAPE",
      field: "retail_outlets.managers",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  const manager = parseManagerRef(raw.guid_manager, raw.name_manager, { allowMissingKeys: true });
  if (!manager.ok) {
    pushIssue(issues, {
      code: "INVALID_OUTLET_FIELD",
      field: "retail_outlets.managers.guid_manager",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  const regional = parseManagerRef(raw.guid_regional_manager, raw.name_regional_manager, {
    allowMissingKeys: true,
  });
  if (!regional.ok) {
    pushIssue(issues, {
      code: "INVALID_OUTLET_FIELD",
      field: "retail_outlets.managers.guid_regional_manager",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  const hardware = parseManagerRef(raw.guid_hardware_manager, raw.name_hardware_manager, {
    allowMissingKeys: true,
  });
  if (!hardware.ok) {
    pushIssue(issues, {
      code: "INVALID_OUTLET_FIELD",
      field: "retail_outlets.managers.guid_hardware_manager",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  const head = parseManagerRef(
    raw.guid_head_of_the_sales_department,
    raw.name_head_of_the_sales_department,
    { allowMissingKeys: true },
  );
  if (!head.ok) {
    pushIssue(issues, {
      code: "INVALID_OUTLET_FIELD",
      field: "retail_outlets.managers.guid_head_of_the_sales_department",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  return {
    manager: manager.value,
    regionalManager: regional.value,
    hardwareManager: hardware.value,
    headOfSales: head.value,
  };
}

function parseOutletAddress(raw: unknown): ParsedOutletAddress {
  if (!isPlainObject(raw)) {
    return { storeAddress: "", deliveryAddress: "", routeDirection: "" };
  }
  return {
    storeAddress: readOptionalString(raw.store_address).trim(),
    deliveryAddress: readOptionalString(raw.delivery_address).trim(),
    routeDirection: readOptionalString(raw.direction_of_the_route).trim(),
  };
}

function parseOutletLoading(
  raw: unknown,
  clientIndex: number,
  outletIndex: number,
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): ParsedOutletLoading | null {
  const loading: ParsedOutletLoading = {
    loadingOnMonday: null,
    loadingOnTuesday: null,
    loadingOnWednesday: null,
    loadingOnThursday: null,
    loadingOnFriday: null,
    loadingOnSaturday: null,
    loadingOnSunday: null,
    loadingTime: null,
  };
  if (raw === undefined || raw === null) {
    return loading;
  }
  if (!isPlainObject(raw)) {
    pushIssue(issues, {
      code: "INVALID_OUTLET_FIELD",
      field: "retail_outlets.information_loading",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  type LoadingDayField = Exclude<keyof ParsedOutletLoading, "loadingTime">;
  const dayKeys: Array<[LoadingDayField, string]> = [
    ["loadingOnMonday", "loading_on_monday"],
    ["loadingOnTuesday", "loading_on_tuesday"],
    ["loadingOnWednesday", "loading_on_wednesday"],
    ["loadingOnThursday", "loading_on_thursday"],
    ["loadingOnFriday", "loading_on_friday"],
    ["loadingOnSaturday", "loading_on_saturday"],
    ["loadingOnSunday", "loading_on_sunday"],
  ];
  for (const [target, source] of dayKeys) {
    if (!(source in raw)) {
      continue;
    }
    const parsed = readStrictBoolean(raw[source]);
    if (parsed === "invalid") {
      pushIssue(issues, {
        code: "INVALID_OUTLET_FIELD",
        field: `retail_outlets.information_loading.${source}`,
        index: clientIndex,
        outletIndex,
      }, issueCount);
      return null;
    }
    loading[target] = parsed;
  }
  if ("loading_time" in raw) {
    if (raw.loading_time !== null && typeof raw.loading_time !== "string") {
      pushIssue(issues, {
        code: "INVALID_OUTLET_FIELD",
        field: "retail_outlets.information_loading.loading_time",
        index: clientIndex,
        outletIndex,
      }, issueCount);
      return null;
    }
    loading.loadingTime =
      typeof raw.loading_time === "string" && raw.loading_time.trim().length > 0
        ? raw.loading_time.trim()
        : null;
  }
  return loading;
}

function parseOutletContacts(raw: unknown): ParsedOutletContacts {
  if (!isPlainObject(raw)) {
    return { storePhone: "", accountantPhone: "", accountantEmail: "" };
  }
  return {
    storePhone: readOptionalString(raw.store_phone).trim(),
    accountantPhone: readOptionalString(raw.accountant_phone).trim(),
    accountantEmail: readOptionalString(raw.accountant_email).trim(),
  };
}

function parseOutletLpr(raw: unknown): ParsedOutletLpr {
  if (!isPlainObject(raw)) {
    return {
      name: "",
      post: "",
      dateOfBirth: null,
      phone: "",
      email: "",
      bonus: "",
      conditionsBonus: "",
    };
  }
  const dob = readOptionalCalendarDate(raw.date_of_birth);
  return {
    name: readOptionalString(raw.name).trim(),
    post: readOptionalString(raw.post).trim(),
    dateOfBirth: dob === "invalid" ? null : dob,
    phone: readOptionalString(raw.phone).trim(),
    email: readOptionalString(raw.email).trim(),
    bonus: readOptionalString(raw.bonus).trim(),
    conditionsBonus: readOptionalString(raw.conditions_bonus).trim(),
  };
}

function parseOutletAdditional(raw: unknown): ParsedOutletAdditional {
  if (!isPlainObject(raw)) {
    return { statusTandoorClub: "", bonusTandoorClub: "" };
  }
  return {
    statusTandoorClub: readOptionalString(raw.status_tandoor_club).trim(),
    bonusTandoorClub: readOptionalString(raw.bonus_tandoor_club).trim(),
  };
}

function validateRetailOutlets(
  raw: unknown,
  clientIndex: number,
  issues: ExtendedValidationIssue[],
  warnings: ExtendedValidationWarning[],
  issueCount: { value: number },
  warningCount: { value: number },
): ParsedRetailOutlet[] | null {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    pushIssue(issues, { code: "INVALID_RETAIL_OUTLETS", field: "retail_outlets", index: clientIndex }, issueCount);
    return null;
  }

  const outlets: ParsedRetailOutlet[] = [];
  for (let outletIndex = 0; outletIndex < raw.length; outletIndex += 1) {
    const item = raw[outletIndex];
    if (!isPlainObject(item)) {
      pushIssue(issues, {
        code: "INVALID_OUTLET_SHAPE",
        field: "retail_outlets",
        index: clientIndex,
        outletIndex,
      }, issueCount);
      return null;
    }

    if ("holding" in item && typeof item.holding !== "string") {
      pushIssue(issues, {
        code: "INVALID_OUTLET_FIELD",
        field: "retail_outlets.holding",
        index: clientIndex,
        outletIndex,
      }, issueCount);
      return null;
    }

    let warehouse: boolean | null = null;
    if ("warehouse" in item) {
      const parsedWarehouse = readStrictBoolean(item.warehouse);
      if (parsedWarehouse === "invalid") {
        pushIssue(issues, {
          code: "INVALID_OUTLET_FIELD",
          field: "retail_outlets.warehouse",
          index: clientIndex,
          outletIndex,
        }, issueCount);
        return null;
      }
      warehouse = parsedWarehouse;
    }

    const managers = parseOutletManagers(item.managers, clientIndex, outletIndex, issues, issueCount);
    if (managers === null) {
      return null;
    }

    const loading = parseOutletLoading(
      item.information_loading,
      clientIndex,
      outletIndex,
      issues,
      issueCount,
    );
    if (loading === null) {
      return null;
    }

    pushWarning(warnings, {
      code: "UNCONFIRMED_OUTLET_GUID",
      index: clientIndex,
      outletIndex,
    }, warningCount);
    pushWarning(warnings, {
      code: "UNCONFIRMED_CLOSURE_STATUS",
      index: clientIndex,
      outletIndex,
    }, warningCount);

    outlets.push({
      ordinal: outletIndex,
      holdingName: readOptionalString(item.holding).trim(),
      warehouse,
      address: parseOutletAddress(item.address),
      loading,
      managers,
      contacts: parseOutletContacts(item.contact_information),
      lpr: parseOutletLpr(item.LPR_information),
      additional: parseOutletAdditional(item.additional_information),
      outletGuidStatus: "not_provided",
      closureStatus: "not_provided",
      distributionAllowed: false,
      presentInCurrentSnapshot: true,
    });
  }

  if (outlets.length > 0) {
    pushWarning(warnings, { code: "OUTLETS_NOT_NORMALIZED", index: clientIndex }, warningCount);
  }

  return outlets;
}

function validateExtendedRecord(
  raw: unknown,
  index: number,
  extendedFile: boolean,
  issues: ExtendedValidationIssue[],
  warnings: ExtendedValidationWarning[],
  issueCount: { value: number },
  warningCount: { value: number },
): ParsedExtendedClientRecord | null {
  if (raw === null) {
    pushIssue(issues, { code: "NULL_RECORD", index }, issueCount);
    return null;
  }
  if (!isPlainObject(raw)) {
    pushIssue(issues, { code: "INVALID_ROOT", index }, issueCount);
    return null;
  }

  const core = validateLegacyCore(raw, index, issues, warnings, issueCount, warningCount, extendedFile);
  if (core === null) {
    return null;
  }

  const recordExtended = isExtendedClientRecord(raw);
  let isHolding: boolean | null = null;
  if ("holding" in raw) {
    const parsed = readStrictBoolean(raw.holding);
    if (parsed === "invalid") {
      pushIssue(issues, { code: "INVALID_HOLDING_BOOLEAN", field: "holding", index }, issueCount);
      return null;
    }
    isHolding = parsed;
  }

  const regional = parseManagerRef(raw.guid_regional_manager, raw.name_regional_manager, {
    allowMissingKeys: true,
  });
  if (!regional.ok) {
    pushIssue(issues, { code: "INVALID_MANAGER_PAIR", field: "guid_regional_manager", index }, issueCount);
    return null;
  }
  const hardware = parseManagerRef(raw.guid_hardware_manager, raw.name_hardware_manager, {
    allowMissingKeys: true,
  });
  if (!hardware.ok) {
    pushIssue(issues, { code: "INVALID_MANAGER_PAIR", field: "guid_hardware_manager", index }, issueCount);
    return null;
  }
  const head = parseManagerRef(
    raw.guid_head_of_the_sales_department,
    raw.name_head_of_the_sales_department,
    { allowMissingKeys: true },
  );
  if (!head.ok) {
    pushIssue(issues, {
      code: "INVALID_MANAGER_PAIR",
      field: "guid_head_of_the_sales_department",
      index,
    }, issueCount);
    return null;
  }

  let retailOutlets: ParsedRetailOutlet[] = [];
  if (recordExtended) {
    const parsedOutlets = validateRetailOutlets(
      raw.retail_outlets,
      index,
      issues,
      warnings,
      issueCount,
      warningCount,
    );
    if (parsedOutlets === null) {
      return null;
    }
    retailOutlets = parsedOutlets;
  }

  return {
    ...core,
    isHolding,
    regionalManager: regional.value,
    hardwareManager: hardware.value,
    headOfSales: head.value,
    retailOutlets,
    recordFormat: recordExtended ? "extended_v1" : "legacy",
  };
}

function detectHoldingCycles(
  records: ParsedExtendedClientRecord[],
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): void {
  const byGuid = new Map(records.map((record) => [record.guid_client, record]));
  for (const record of records) {
    if (!record.guid_holding) {
      continue;
    }
    if (record.guid_holding === record.guid_client) {
      pushIssue(issues, { code: "HOLDING_SELF_REFERENCE", index: records.indexOf(record) }, issueCount);
      continue;
    }
    if (!byGuid.has(record.guid_holding)) {
      pushIssue(issues, { code: "HOLDING_GUID_UNKNOWN", index: records.indexOf(record) }, issueCount);
      continue;
    }
    const visited = new Set<string>([record.guid_client]);
    let cursor: string | null = record.guid_holding;
    while (cursor) {
      if (visited.has(cursor)) {
        pushIssue(issues, { code: "HOLDING_CYCLE", index: records.indexOf(record) }, issueCount);
        break;
      }
      visited.add(cursor);
      const parent = byGuid.get(cursor);
      cursor = parent?.guid_holding ?? null;
    }
  }
}

function buildDiagnostics(
  sourceFormat: "legacy" | "extended_v1",
  records: ParsedExtendedClientRecord[],
  holdingLinkErrors: number,
): ExtendedDiagnosticsSummary {
  let holdingCardCount = 0;
  let childHoldingLinkCount = 0;
  let nestedOutletCount = 0;
  let recordsWithExtendedFields = 0;
  let legacyOnlyRecords = 0;
  let unmatchedManagerGuidCount = 0;

  for (const record of records) {
    if (record.isHolding === true) {
      holdingCardCount += 1;
    }
    if (record.guid_holding) {
      childHoldingLinkCount += 1;
    }
    nestedOutletCount += record.retailOutlets.length;
    if (record.recordFormat === "extended_v1") {
      recordsWithExtendedFields += 1;
    } else {
      legacyOnlyRecords += 1;
    }
    for (const manager of [
      record.regionalManager,
      record.hardwareManager,
      record.headOfSales,
      ...record.retailOutlets.flatMap((outlet) => [
        outlet.managers.manager,
        outlet.managers.regionalManager,
        outlet.managers.hardwareManager,
        outlet.managers.headOfSales,
      ]),
    ]) {
      if (manager.state === "unmatched") {
        unmatchedManagerGuidCount += 1;
      }
    }
  }

  return {
    sourceFormat,
    holdingCardCount,
    childHoldingLinkCount,
    nestedOutletCount,
    outletsWithoutGuid: nestedOutletCount,
    unconfirmedClosureStatusCount: nestedOutletCount,
    unmatchedManagerGuidCount,
    holdingLinkErrors,
    recordsWithExtendedFields,
    legacyOnlyRecords,
    blocks: {
      legacyImportReady: true,
      clientExtendedReady: sourceFormat === "extended_v1",
      outletNormalizedReady: false,
    },
  };
}

export type ValidateClientsLimits = {
  maxSourceBytes?: number;
  maxSourceRecords?: number;
};

export function validateExtendedClientsFileBytes(
  bytes: Buffer,
  limits?: ValidateClientsLimits,
): ExtendedValidationResult {
  const maxSourceBytes = limits?.maxSourceBytes ?? MAX_SOURCE_BYTES;
  const maxSourceRecords = limits?.maxSourceRecords ?? MAX_SOURCE_RECORDS;
  const issues: ExtendedValidationIssue[] = [];
  const warnings: ExtendedValidationWarning[] = [];
  const issueCount = { value: 0 };
  const warningCount = { value: 0 };

  if (bytes.length > maxSourceBytes) {
    pushIssue(issues, { code: "FILE_TOO_LARGE" }, issueCount);
    return { ok: false, issues, warnings, issueCount: issueCount.value, warningCount: warningCount.value };
  }

  const text = decodeUtf8(stripUtf8Bom(bytes));
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

  const sourceFormat = detectClientsSourceFormat(parsed);
  const records: ParsedExtendedClientRecord[] = [];
  const seenClients = new Set<string>();

  for (let index = 0; index < parsed.length; index += 1) {
    const record = validateExtendedRecord(
      parsed[index],
      index,
      sourceFormat === "extended_v1",
      issues,
      warnings,
      issueCount,
      warningCount,
    );
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

  const holdingErrorsBefore = issueCount.value;
  if (sourceFormat === "extended_v1") {
    detectHoldingCycles(records, issues, issueCount);
  }
  const holdingLinkErrors = issueCount.value - holdingErrorsBefore;

  if (issueCount.value > 0) {
    return { ok: false, issues, warnings, issueCount: issueCount.value, warningCount: warningCount.value };
  }

  const diagnostics = buildDiagnostics(sourceFormat, records, holdingLinkErrors);

  return {
    ok: true,
    payload: {
      sha256: sha256Hex(bytes),
      byteSize: bytes.length,
      recordCount: records.length,
      sourceFormat,
      records,
      warnings,
      warningCount: warningCount.value,
      diagnostics,
    },
  };
}

/** Legacy-only path: delegates shape to extended validator and strips extended-only fields. */
export function validateLegacyClientsFileBytes(
  bytes: Buffer,
  limits?: ValidateClientsLimits,
): ExtendedValidationResult {
  const result = validateExtendedClientsFileBytes(bytes, limits);
  if (!result.ok) {
    return result;
  }
  if (result.payload.sourceFormat !== "legacy") {
    return result;
  }
  return result;
}

export type LegacyCompatiblePayload = {
  sha256: string;
  byteSize: number;
  recordCount: number;
  records: import("./types").ParsedClientRecord[];
  warnings: ValidationWarning[];
  warningCount: number;
  sourceFormat: "legacy";
};

export function toLegacyValidatedPayload(
  payload: ValidatedExtendedClientsPayload,
): LegacyCompatiblePayload {
  return {
    sha256: payload.sha256,
    byteSize: payload.byteSize,
    recordCount: payload.recordCount,
    sourceFormat: "legacy",
    records: payload.records.map((record) => ({
      guid_client: record.guid_client,
      name_client: record.name_client,
      guid_holding: record.guid_holding,
      name_holding: record.name_holding,
      guid_manager: record.guid_manager,
      name_manager: record.name_manager,
      address: record.address,
      telephone: record.telephone,
    })),
    warnings: payload.warnings.filter(
      (warning): warning is ValidationWarning =>
        warning.code === "EXTRA_FIELDS" ||
        warning.code === "EMPTY_ADDRESS" ||
        warning.code === "EMPTY_TELEPHONE",
    ),
    warningCount: payload.warningCount,
  };
}
