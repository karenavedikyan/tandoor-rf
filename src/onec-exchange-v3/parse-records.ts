import {
  normalizeOptionalUuid,
  parseRequiredUuid,
  readBoolean,
  readNumber,
  readObject,
  readOptionalRootExchangeString,
  readString,
  readStringArray,
} from "./normalize";
import { pickSupportedOtherFields } from "./other-fields";
import type { V3Managers, V3TypeCategory, V3ValidatedHolding, V3ValidatedLegal, V3ValidatedRetail } from "./types";

function parseTypeCategory(raw: unknown): V3TypeCategory {
  const obj = readObject(raw);
  return {
    guidType: readString(obj.guid_type),
    nameType: readString(obj.name_type),
    guidCategory: readString(obj.guid_category),
    nameCategory: readString(obj.name_category),
  };
}

function parseManagers(raw: unknown): V3Managers {
  const obj = readObject(raw);
  return {
    guidManager: normalizeOptionalUuid(obj.guid_manager),
    nameManager: readString(obj.name_manager) || null,
    guidRegionalManager: normalizeOptionalUuid(obj.guid_regional_manager),
    nameRegionalManager: readString(obj.name_regional_manager) || null,
    guidHardwareManager: normalizeOptionalUuid(obj.guid_hardware_manager),
    nameHardwareManager: readString(obj.name_hardware_manager) || null,
    guidHeadOfSales: normalizeOptionalUuid(obj.guid_head_of_the_sales_department),
    nameHeadOfSales: readString(obj.name_head_of_the_sales_department) || null,
  };
}

function parseCompositionMembers(
  raw: unknown,
  field: string,
  errors: string[],
): Array<{ guidRetail: string; nameRetail: string; zeroGuid: boolean }> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const members: Array<{ guidRetail: string; nameRetail: string; zeroGuid: boolean }> = [];
  for (let i = 0; i < raw.length; i += 1) {
    const row = readObject(raw[i]);
    const guidRaw = row.guid_retail;
    const zeroGuid =
      guidRaw === undefined ||
      guidRaw === null ||
      (typeof guidRaw === "string" && guidRaw.trim().length === 0) ||
      (typeof guidRaw === "string" && guidRaw.trim().toLowerCase() === "00000000-0000-0000-0000-000000000000");
    const guid = zeroGuid ? "00000000-0000-0000-0000-000000000000" : parseRequiredUuid(guidRaw, `${field}[${i}].guid_retail`, errors);
    if (!guid) {
      continue;
    }
    members.push({
      guidRetail: guid,
      nameRetail: readString(row.name_retail),
      zeroGuid,
    });
  }
  return members;
}

export function parseHoldingRecord(raw: unknown, errors: string[]): V3ValidatedHolding | null {
  const row = readObject(raw);
  const guidHolding = parseRequiredUuid(row.guid_holding, "guid_holding", errors);
  if (!guidHolding) {
    return null;
  }
  return {
    guidHolding,
    nameHolding: readString(row.name_holding),
    typeCategory: parseTypeCategory(row.type_category),
    retailChain: readBoolean(row.retail_chain),
    holdingGroup: readBoolean(row.holding_group),
    managers: parseManagers(row.managers),
    legalEntities: parseCompositionMembers(row.legal_entities, "legal_entities", errors),
    retailOutlets: parseCompositionMembers(row.retail_outlets, "retail_outlets", errors),
  };
}

export function parseLegalRecord(raw: unknown, errors: string[]): V3ValidatedLegal | null {
  const row = readObject(raw);
  const guidClient = parseRequiredUuid(row.guid_client, "guid_client", errors);
  if (!guidClient) {
    return null;
  }
  const markupsRaw = Array.isArray(row.markups) ? row.markups : [];
  const markups = markupsRaw.map((item) => {
    const m = readObject(item);
    return {
      guid: readString(m.guid),
      name: readString(m.name),
      percentage: readNumber(m.percentage),
    };
  });
  return {
    guidClient,
    nameClient: readString(row.name_client),
    inn: readOptionalRootExchangeString(row.inn),
    kpp: readOptionalRootExchangeString(row.kpp),
    guidHolding: normalizeOptionalUuid(row.guid_holding),
    nameHolding: readString(row.name_holding) || null,
    typeCategory: parseTypeCategory(row.type_category),
    managers: parseManagers(row),
    address: readString(row.address),
    telephone: readStringArray(row.telephone),
    discount: readString(row.Discount),
    discountAmount: readNumber(row.DiscountAmount),
    markups,
    otherFields: pickSupportedOtherFields(readObject(row.other)),
    membershipConflict: false,
  };
}

export function parseRetailRecord(raw: unknown, errors: string[]): V3ValidatedRetail | null {
  const row = readObject(raw);
  const guidStore = parseRequiredUuid(row.guid_store, "guid_store", errors);
  if (!guidStore) {
    return null;
  }
  return {
    guidStore,
    guidHolding: normalizeOptionalUuid(row.guid_holding),
    warehouse: readBoolean(row.warehouse),
    closed: readBoolean(row.closed),
    typeCategory: parseTypeCategory(row.type_category),
    address: readObject(row.address),
    informationLoading: readObject(row.information_loading),
    managers: parseManagers(row.managers),
    contactInformation: readObject(row.contact_information),
    lprInformation: readObject(row.LPR_information),
    additionalInformation: readObject(row.additional_information),
    membershipConflict: false,
  };
}
