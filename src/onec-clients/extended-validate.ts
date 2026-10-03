import {
  KNOWN_CLIENT_KEYS,
  MAX_DETAILED_ERRORS,
  MAX_DETAILED_WARNINGS,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_RECORDS,
  type KnownClientKey,
} from "./constants";
import {
  readCalendarDateField,
  readLocalTimeField,
  readOptionalStringField,
  readScalarField,
  readStrictBooleanField,
  readStringField,
} from "./field-value";
import { detectClientsSourceFormat, hasExtendedManagerFields, isExtendedClientRecord } from "./format";
import type { ExtendedRecordFieldPresence } from "./extended-presence";
import { parseManagerFieldWithPresence, parseOptionalHoldingGuid } from "./manager-status";
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
import { outletsAreIdentical } from "./outlet-identity";
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
      if (extendedFile && key === "name_holding") {
        raw.name_holding = "";
        continue;
      }
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

  let nameHolding = "";
  if ("name_holding" in raw) {
    if (typeof raw.name_holding !== "string") {
      pushIssue(issues, { code: "INVALID_TYPE", field: "name_holding", index }, issueCount);
      return null;
    }
    nameHolding = raw.name_holding.trim();
  }
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

function notProvidedOutletManagers(): ParsedOutletManagers {
  const notProvided = { guid: null, name: "", state: "not_provided" as const };
  return {
    manager: notProvided,
    regionalManager: notProvided,
    hardwareManager: notProvided,
    headOfSales: notProvided,
  };
}

function parseOutletManagers(
  raw: unknown,
  clientIndex: number,
  outletIndex: number,
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): ParsedOutletManagers | null {
  if (raw === undefined || raw === null) {
    return notProvidedOutletManagers();
  }
  if (!isPlainObject(raw)) {
    pushIssue(issues, {
      code: "INVALID_OUTLET_SHAPE",
      field: "retail_outlets.managers",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }

  const manager = parseManagerFieldWithPresence(raw, "guid_manager", "name_manager");
  if (!manager.ok) {
    pushIssue(issues, {
      code:
        manager.code === "INVALID_UUID"
          ? "INVALID_MANAGER_GUID"
          : manager.code === "INVALID_MANAGER_PAIR"
            ? "INVALID_MANAGER_PAIR"
            : "INVALID_OUTLET_FIELD",
      field: "retail_outlets.managers.guid_manager",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  const regional = parseManagerFieldWithPresence(raw, "guid_regional_manager", "name_regional_manager");
  if (!regional.ok) {
    pushIssue(issues, {
      code:
        regional.code === "INVALID_UUID"
          ? "INVALID_MANAGER_GUID"
          : regional.code === "INVALID_MANAGER_PAIR"
            ? "INVALID_MANAGER_PAIR"
            : "INVALID_OUTLET_FIELD",
      field: "retail_outlets.managers.guid_regional_manager",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  const hardware = parseManagerFieldWithPresence(raw, "guid_hardware_manager", "name_hardware_manager");
  if (!hardware.ok) {
    pushIssue(issues, {
      code:
        hardware.code === "INVALID_UUID"
          ? "INVALID_MANAGER_GUID"
          : hardware.code === "INVALID_MANAGER_PAIR"
            ? "INVALID_MANAGER_PAIR"
            : "INVALID_OUTLET_FIELD",
      field: "retail_outlets.managers.guid_hardware_manager",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  const head = parseManagerFieldWithPresence(
    raw,
    "guid_head_of_the_sales_department",
    "name_head_of_the_sales_department",
  );
  if (!head.ok) {
    pushIssue(issues, {
      code:
        head.code === "INVALID_UUID"
          ? "INVALID_MANAGER_GUID"
          : head.code === "INVALID_MANAGER_PAIR"
            ? "INVALID_MANAGER_PAIR"
            : "INVALID_OUTLET_FIELD",
      field: "retail_outlets.managers.guid_head_of_the_sales_department",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  return {
    manager: manager.ref,
    regionalManager: regional.ref,
    hardwareManager: hardware.ref,
    headOfSales: head.ref,
  };
}

function parseOutletAddress(
  raw: unknown,
  clientIndex: number,
  outletIndex: number,
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): ParsedOutletAddress | null {
  if (raw === undefined || raw === null) {
    return { storeAddress: "", deliveryAddress: "", routeDirection: "" };
  }
  if (!isPlainObject(raw)) {
    pushIssue(issues, {
      code: "INVALID_OUTLET_FIELD",
      field: "retail_outlets.address",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  const fields: Array<[keyof ParsedOutletAddress, string]> = [
    ["storeAddress", "store_address"],
    ["deliveryAddress", "delivery_address"],
    ["routeDirection", "direction_of_the_route"],
  ];
  const result: ParsedOutletAddress = { storeAddress: "", deliveryAddress: "", routeDirection: "" };
  for (const [target, source] of fields) {
    if (!(source in raw)) {
      continue;
    }
    const parsed = readOptionalStringField(raw[source]);
    if (parsed.kind === "invalid_type") {
      pushIssue(issues, {
        code: "INVALID_OUTLET_FIELD",
        field: `retail_outlets.address.${source}`,
        index: clientIndex,
        outletIndex,
      }, issueCount);
      return null;
    }
    result[target] = parsed.kind === "value" ? parsed.value : "";
  }
  return result;
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
    const parsed = readStrictBooleanField(raw[source]);
    if (parsed.kind === "invalid_type") {
      pushIssue(issues, {
        code: "INVALID_OUTLET_FIELD",
        field: `retail_outlets.information_loading.${source}`,
        index: clientIndex,
        outletIndex,
      }, issueCount);
      return null;
    }
    loading[target] = parsed.kind === "value" ? parsed.value : null;
  }
  if ("loading_time" in raw) {
    const parsedTime = readLocalTimeField(raw.loading_time);
    if (parsedTime.kind === "invalid_type") {
      pushIssue(issues, {
        code: "INVALID_OUTLET_FIELD",
        field: "retail_outlets.information_loading.loading_time",
        index: clientIndex,
        outletIndex,
      }, issueCount);
      return null;
    }
    loading.loadingTime = parsedTime.kind === "value" ? parsedTime.value : null;
  }
  return loading;
}

function parseOutletContacts(
  raw: unknown,
  clientIndex: number,
  outletIndex: number,
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): ParsedOutletContacts | null {
  if (raw === undefined || raw === null) {
    return { storePhone: "", accountantPhone: "", accountantEmail: "" };
  }
  if (!isPlainObject(raw)) {
    pushIssue(issues, {
      code: "INVALID_OUTLET_FIELD",
      field: "retail_outlets.contact_information",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  const fields: Array<[keyof ParsedOutletContacts, string]> = [
    ["storePhone", "store_phone"],
    ["accountantPhone", "accountant_phone"],
    ["accountantEmail", "accountant_email"],
  ];
  const result: ParsedOutletContacts = { storePhone: "", accountantPhone: "", accountantEmail: "" };
  for (const [target, source] of fields) {
    if (!(source in raw)) {
      continue;
    }
    const parsed = readOptionalStringField(raw[source]);
    if (parsed.kind === "invalid_type") {
      pushIssue(issues, {
        code: "INVALID_OUTLET_FIELD",
        field: `retail_outlets.contact_information.${source}`,
        index: clientIndex,
        outletIndex,
      }, issueCount);
      return null;
    }
    result[target] = parsed.kind === "value" ? parsed.value : "";
  }
  return result;
}

function parseOutletLpr(
  raw: unknown,
  clientIndex: number,
  outletIndex: number,
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): ParsedOutletLpr | null {
  if (raw === undefined || raw === null) {
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
  if (!isPlainObject(raw)) {
    pushIssue(issues, {
      code: "INVALID_OUTLET_FIELD",
      field: "retail_outlets.LPR_information",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  const stringFields: Array<[keyof ParsedOutletLpr, string]> = [
    ["name", "name"],
    ["post", "post"],
    ["phone", "phone"],
    ["email", "email"],
    ["bonus", "bonus"],
    ["conditionsBonus", "conditions_bonus"],
  ];
  const result: ParsedOutletLpr = {
    name: "",
    post: "",
    dateOfBirth: null,
    phone: "",
    email: "",
    bonus: "",
    conditionsBonus: "",
  };
  for (const [target, source] of stringFields) {
    if (!(source in raw)) {
      continue;
    }
    const parsed = readOptionalStringField(raw[source]);
    if (parsed.kind === "invalid_type") {
      pushIssue(issues, {
        code: "INVALID_OUTLET_FIELD",
        field: `retail_outlets.LPR_information.${source}`,
        index: clientIndex,
        outletIndex,
      }, issueCount);
      return null;
    }
    if (target !== "dateOfBirth") {
      result[target] = parsed.kind === "value" ? parsed.value : "";
    }
  }
  if ("date_of_birth" in raw) {
    const dob = readCalendarDateField(raw.date_of_birth);
    if (dob.kind === "invalid_type") {
      pushIssue(issues, {
        code: "INVALID_OUTLET_FIELD",
        field: "retail_outlets.LPR_information.date_of_birth",
        index: clientIndex,
        outletIndex,
      }, issueCount);
      return null;
    }
    result.dateOfBirth = dob.kind === "value" ? dob.value : null;
  }
  return result;
}

function formatScalarValue(value: string | number | boolean): string {
  return String(value);
}

function parseOutletAdditional(
  raw: unknown,
  clientIndex: number,
  outletIndex: number,
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): ParsedOutletAdditional | null {
  if (raw === undefined || raw === null) {
    return { statusTandoorClub: "", bonusTandoorClub: "" };
  }
  if (!isPlainObject(raw)) {
    pushIssue(issues, {
      code: "INVALID_OUTLET_FIELD",
      field: "retail_outlets.additional_information",
      index: clientIndex,
      outletIndex,
    }, issueCount);
    return null;
  }
  const result: ParsedOutletAdditional = { statusTandoorClub: "", bonusTandoorClub: "" };
  if ("status_tandoor_club" in raw) {
    const parsed = readOptionalStringField(raw.status_tandoor_club);
    if (parsed.kind === "invalid_type") {
      pushIssue(issues, {
        code: "INVALID_OUTLET_FIELD",
        field: "retail_outlets.additional_information.status_tandoor_club",
        index: clientIndex,
        outletIndex,
      }, issueCount);
      return null;
    }
    result.statusTandoorClub = parsed.kind === "value" ? parsed.value : "";
  }
  if ("bonus_tandoor_club" in raw) {
    const parsed = readScalarField(raw.bonus_tandoor_club);
    if (parsed.kind === "invalid_type") {
      pushIssue(issues, {
        code: "INVALID_OUTLET_FIELD",
        field: "retail_outlets.additional_information.bonus_tandoor_club",
        index: clientIndex,
        outletIndex,
      }, issueCount);
      return null;
    }
    result.bonusTandoorClub =
      parsed.kind === "value" ? formatScalarValue(parsed.value) : "";
  }
  return result;
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

    let guidStore: string | null = null;
    let outletGuidStatus: ParsedRetailOutlet["outletGuidStatus"] = "not_provided";
    if ("guid_store" in item) {
      if (typeof item.guid_store !== "string" || !isValidNonZeroUuid(item.guid_store)) {
        pushIssue(issues, {
          code: "INVALID_OUTLET_GUID",
          field: "retail_outlets.guid_store",
          index: clientIndex,
          outletIndex,
        }, issueCount);
        return null;
      }
      guidStore = normalizeUuid(item.guid_store);
      outletGuidStatus = "confirmed";
    } else {
      pushWarning(warnings, {
        code: "UNCONFIRMED_OUTLET_GUID",
        index: clientIndex,
        outletIndex,
      }, warningCount);
    }

    let closed: boolean | null = null;
    let closureStatus: ParsedRetailOutlet["closureStatus"] = "not_provided";
    if ("closed" in item) {
      const parsedClosed = readStrictBoolean(item.closed);
      if (parsedClosed === "invalid") {
        pushIssue(issues, {
          code: "INVALID_OUTLET_CLOSED",
          field: "retail_outlets.closed",
          index: clientIndex,
          outletIndex,
        }, issueCount);
        return null;
      }
      if (parsedClosed === null) {
        pushIssue(issues, {
          code: "INVALID_OUTLET_CLOSED",
          field: "retail_outlets.closed",
          index: clientIndex,
          outletIndex,
        }, issueCount);
        return null;
      }
      closed = parsedClosed;
      closureStatus = parsedClosed ? "closed" : "open";
    } else {
      pushWarning(warnings, {
        code: "UNCONFIRMED_CLOSURE_STATUS",
        index: clientIndex,
        outletIndex,
      }, warningCount);
    }

    const address = parseOutletAddress(item.address, clientIndex, outletIndex, issues, issueCount);
    if (address === null) {
      return null;
    }
    const contacts = parseOutletContacts(
      item.contact_information,
      clientIndex,
      outletIndex,
      issues,
      issueCount,
    );
    if (contacts === null) {
      return null;
    }
    const lpr = parseOutletLpr(item.LPR_information, clientIndex, outletIndex, issues, issueCount);
    if (lpr === null) {
      return null;
    }
    const additional = parseOutletAdditional(
      item.additional_information,
      clientIndex,
      outletIndex,
      issues,
      issueCount,
    );
    if (additional === null) {
      return null;
    }

    if ("holding" in item) {
      const holdingName = readOptionalStringField(item.holding);
      if (holdingName.kind === "invalid_type") {
        pushIssue(issues, {
          code: "INVALID_OUTLET_FIELD",
          field: "retail_outlets.holding",
          index: clientIndex,
          outletIndex,
        }, issueCount);
        return null;
      }
    }

    let holdingName = "";
    if ("holding" in item) {
      const parsedHolding = readOptionalStringField(item.holding);
      holdingName = parsedHolding.kind === "value" ? parsedHolding.value : "";
    }

    outlets.push({
      ordinal: outletIndex,
      guidStore,
      holdingName,
      warehouse,
      address,
      loading,
      managers,
      contacts,
      lpr,
      additional,
      outletGuidStatus,
      closed,
      closureStatus,
      closureHistory: [],
      distributionAllowed: false,
    });
  }

  if (outlets.some((outlet) => outlet.outletGuidStatus !== "confirmed")) {
    pushWarning(warnings, { code: "OUTLETS_NOT_NORMALIZED", index: clientIndex }, warningCount);
  }

  return outlets;
}

type OutletGuidOccurrence = {
  clientGuid: string;
  clientIndex: number;
  outletIndex: number;
  outlet: ParsedRetailOutlet;
};

function validateOutletGuidsAcrossFile(
  records: ParsedExtendedClientRecord[],
  issues: ExtendedValidationIssue[],
  warnings: ExtendedValidationWarning[],
  issueCount: { value: number },
  warningCount: { value: number },
): { duplicateOutletGuidCount: number; outletParentLinkConflicts: number } {
  const seen = new Map<string, OutletGuidOccurrence>();
  let duplicateOutletGuidCount = 0;
  let outletParentLinkConflicts = 0;

  for (let clientIndex = 0; clientIndex < records.length; clientIndex += 1) {
    const record = records[clientIndex]!;
    for (let outletIndex = 0; outletIndex < record.retailOutlets.length; outletIndex += 1) {
      const outlet = record.retailOutlets[outletIndex]!;
      if (outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore) {
        continue;
      }
      const key = outlet.guidStore.toLowerCase();
      const previous = seen.get(key);
      if (!previous) {
        seen.set(key, {
          clientGuid: record.guid_client,
          clientIndex,
          outletIndex,
          outlet,
        });
        continue;
      }

      if (previous.clientGuid !== record.guid_client) {
        pushIssue(issues, {
          code: "OUTLET_GUID_CONFLICT",
          field: "retail_outlets.guid_store",
          index: clientIndex,
          outletIndex,
        }, issueCount);
        outletParentLinkConflicts += 1;
        continue;
      }

      if (outletsAreIdentical(previous.outlet, outlet)) {
        pushWarning(warnings, {
          code: "DUPLICATE_OUTLET_GUID_ROW",
          index: clientIndex,
          outletIndex,
        }, warningCount);
        duplicateOutletGuidCount += 1;
        continue;
      }

      const previousClosed = previous.outlet.closureStatus;
      const nextClosed = outlet.closureStatus;
      if (
        (previousClosed === "open" || previousClosed === "closed") &&
        (nextClosed === "open" || nextClosed === "closed") &&
        previous.outlet.closed !== outlet.closed
      ) {
        pushIssue(issues, {
          code: "OUTLET_GUID_CONFLICT",
          field: "retail_outlets.closed",
          index: clientIndex,
          outletIndex,
        }, issueCount);
        continue;
      }

      pushIssue(issues, {
        code: "DUPLICATE_OUTLET_GUID",
        field: "retail_outlets.guid_store",
        index: clientIndex,
        outletIndex,
      }, issueCount);
    }
  }

  return { duplicateOutletGuidCount, outletParentLinkConflicts };
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
  let holdingPresence: ExtendedRecordFieldPresence["holding"] = "missing";
  if ("holding" in raw) {
    holdingPresence = "present";
    const parsed = readStrictBoolean(raw.holding);
    if (parsed === "invalid") {
      pushIssue(issues, { code: "INVALID_HOLDING_BOOLEAN", field: "holding", index }, issueCount);
      return null;
    }
    isHolding = parsed;
  }

  const regional = parseManagerFieldWithPresence(raw, "guid_regional_manager", "name_regional_manager");
  if (!regional.ok) {
    pushIssue(issues, {
      code:
        regional.code === "INVALID_UUID"
          ? "INVALID_MANAGER_GUID"
          : regional.code === "INVALID_MANAGER_PAIR"
            ? "INVALID_MANAGER_PAIR"
            : "INVALID_TYPE",
      field: "guid_regional_manager",
      index,
    }, issueCount);
    return null;
  }
  const hardware = parseManagerFieldWithPresence(raw, "guid_hardware_manager", "name_hardware_manager");
  if (!hardware.ok) {
    pushIssue(issues, {
      code:
        hardware.code === "INVALID_UUID"
          ? "INVALID_MANAGER_GUID"
          : hardware.code === "INVALID_MANAGER_PAIR"
            ? "INVALID_MANAGER_PAIR"
            : "INVALID_TYPE",
      field: "guid_hardware_manager",
      index,
    }, issueCount);
    return null;
  }
  const head = parseManagerFieldWithPresence(
    raw,
    "guid_head_of_the_sales_department",
    "name_head_of_the_sales_department",
  );
  if (!head.ok) {
    pushIssue(issues, {
      code:
        head.code === "INVALID_UUID"
          ? "INVALID_MANAGER_GUID"
          : head.code === "INVALID_MANAGER_PAIR"
            ? "INVALID_MANAGER_PAIR"
            : "INVALID_TYPE",
      field: "guid_head_of_the_sales_department",
      index,
    }, issueCount);
    return null;
  }

  const recordHasExtendedManagerFields = hasExtendedManagerFields(raw);

  let retailOutlets: ParsedRetailOutlet[] = [];
  let retailOutletsPresence: ExtendedRecordFieldPresence["retailOutlets"] = "missing";
  if ("retail_outlets" in raw) {
    if (raw.retail_outlets === null) {
      pushIssue(issues, { code: "INVALID_RETAIL_OUTLETS", field: "retail_outlets", index }, issueCount);
      return null;
    }
    retailOutletsPresence = Array.isArray(raw.retail_outlets) && raw.retail_outlets.length === 0
      ? "explicit_empty"
      : "present";
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
  } else if (recordExtended) {
    retailOutletsPresence = "missing";
  }

  const fieldPresence: ExtendedRecordFieldPresence = {
    holding: holdingPresence,
    retailOutlets: retailOutletsPresence,
    regionalManager: regional.presence,
    hardwareManager: hardware.presence,
    headOfSales: head.presence,
  };

  return {
    ...core,
    isHolding,
    regionalManager: regional.ref,
    hardwareManager: hardware.ref,
    headOfSales: head.ref,
    retailOutlets,
    recordFormat: recordExtended ? "extended_v1" : "legacy",
    hasExtendedManagerFields: recordHasExtendedManagerFields,
    fieldPresence,
  };
}

function validateHoldingTargets(
  records: ParsedExtendedClientRecord[],
  issues: ExtendedValidationIssue[],
  issueCount: { value: number },
): void {
  const byGuid = new Map(records.map((record) => [record.guid_client, record]));
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (!record.guid_holding) {
      continue;
    }
    const target = byGuid.get(record.guid_holding);
    if (!target) {
      continue;
    }
    if (target.isHolding !== true) {
      pushIssue(issues, { code: "HOLDING_TARGET_NOT_HOLDING_CARD", index }, issueCount);
    }
  }
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
  outletGuidStats: { duplicateOutletGuidCount: number; outletParentLinkConflicts: number },
): ExtendedDiagnosticsSummary {
  let holdingCardCount = 0;
  let childHoldingLinkCount = 0;
  let nestedOutletCount = 0;
  let outletsWithGuid = 0;
  let outletsWithoutGuid = 0;
  let outletsOpen = 0;
  let outletsClosed = 0;
  let outletsUnknownClosure = 0;
  let recordsWithExtendedFields = 0;
  let legacyOnlyRecords = 0;
  let invalidManagerGuidCount = 0;

  for (const record of records) {
    if (record.isHolding === true) {
      holdingCardCount += 1;
    }
    if (record.guid_holding) {
      childHoldingLinkCount += 1;
    }
    nestedOutletCount += record.retailOutlets.length;
    for (const outlet of record.retailOutlets) {
      if (outlet.outletGuidStatus === "confirmed" && outlet.guidStore) {
        outletsWithGuid += 1;
      } else {
        outletsWithoutGuid += 1;
      }
      if (outlet.closureStatus === "open") {
        outletsOpen += 1;
      } else if (outlet.closureStatus === "closed") {
        outletsClosed += 1;
      } else {
        outletsUnknownClosure += 1;
      }
    }
    if (record.recordFormat === "extended_v1" || record.hasExtendedManagerFields) {
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
      if (manager.state === "invalid") {
        invalidManagerGuidCount += 1;
      }
    }
  }

  const allOutlets = records.flatMap((record) => record.retailOutlets);
  const outletNormalizedReady =
    allOutlets.length > 0 &&
    allOutlets.every(
      (outlet) =>
        outlet.outletGuidStatus === "confirmed" &&
        outlet.guidStore &&
        (outlet.closureStatus === "open" || outlet.closureStatus === "closed"),
    );

  return {
    sourceFormat,
    holdingCardCount,
    childHoldingLinkCount,
    nestedOutletCount,
    outletsWithGuid,
    outletsWithoutGuid,
    outletsOpen,
    outletsClosed,
    outletsUnknownClosure,
    duplicateOutletGuidCount: outletGuidStats.duplicateOutletGuidCount,
    outletParentLinkConflicts: outletGuidStats.outletParentLinkConflicts,
    knownOutletsMissingFromSnapshot: 0,
    invalidManagerGuidCount,
    employeeDirectoryVerified: false,
    holdingLinkErrors,
    recordsWithExtendedFields,
    legacyOnlyRecords,
    blocks: {
      legacyImportReady: true,
      clientExtendedReady: false,
      outletNormalizedReady,
    },
  };
}

export type ValidateClientsLimits = {
  maxSourceBytes?: number;
  maxSourceRecords?: number;
  extendedContractVerification?: import("./types").ExtendedContractVerification;
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
  let outletGuidStats = { duplicateOutletGuidCount: 0, outletParentLinkConflicts: 0 };
  if (sourceFormat === "extended_v1") {
    detectHoldingCycles(records, issues, issueCount);
    validateHoldingTargets(records, issues, issueCount);
    outletGuidStats = validateOutletGuidsAcrossFile(records, issues, warnings, issueCount, warningCount);
  }
  const holdingLinkErrors = issueCount.value - holdingErrorsBefore;

  if (issueCount.value > 0) {
    return { ok: false, issues, warnings, issueCount: issueCount.value, warningCount: warningCount.value };
  }

  if (sourceFormat === "extended_v1") {
    pushWarning(warnings, { code: "EMPLOYEE_DIRECTORY_UNAVAILABLE" }, warningCount);
  }

  const diagnostics = buildDiagnostics(sourceFormat, records, holdingLinkErrors, outletGuidStats);
  const extendedContractVerification = limits?.extendedContractVerification ?? "unverified";

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
      extendedContractVerification,
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
  options?: { keepExtendedWarnings?: boolean },
): LegacyCompatiblePayload {
  const keepExtendedWarnings = options?.keepExtendedWarnings === true;
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
    warnings: keepExtendedWarnings
      ? (payload.warnings as ValidationWarning[])
      : payload.warnings.filter(
          (warning): warning is ValidationWarning =>
            warning.code === "EXTRA_FIELDS" ||
            warning.code === "EMPTY_ADDRESS" ||
            warning.code === "EMPTY_TELEPHONE",
        ),
    warningCount: payload.warningCount,
  };
}
