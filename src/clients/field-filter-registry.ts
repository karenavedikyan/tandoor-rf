import type { ClientsEntityMode } from "./query";

/** Client-row fields for filled/empty filters. */
export const CLIENT_FILLED_EMPTY_FIELDS = new Set([
  "address",
  "telephone",
  "holding",
  "discountProgram",
  "discountAmount",
  "markups",
]);

/** Outlet snapshot fields (same-outlet on entity=clients). */
export const OUTLET_FILLED_EMPTY_FIELDS = new Set([
  "storeAddress",
  "deliveryAddress",
  "routeDirection",
  "tandoorClub",
  "bonusTandoorClub",
  "warehouse",
  "storePhone",
  "accountantPhone",
  "accountantEmail",
  "loadingTime",
  "loadingSchedule",
]);

export const ALL_FILLED_EMPTY_FIELDS = new Set([
  ...CLIENT_FILLED_EMPTY_FIELDS,
  ...OUTLET_FILLED_EMPTY_FIELDS,
]);

export function parseFilledEmptyFieldList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function validateFilledEmptyFields(
  filled: string | undefined,
  empty: string | undefined,
  entity: ClientsEntityMode,
): { ok: true; filled: string[]; empty: string[] } | { ok: false; message: string } {
  const filledFields = parseFilledEmptyFieldList(filled);
  const emptyFields = parseFilledEmptyFieldList(empty);

  for (const field of [...filledFields, ...emptyFields]) {
    if (!ALL_FILLED_EMPTY_FIELDS.has(field)) {
      return { ok: false, message: `Неподдерживаемое поле фильтра: ${field}.` };
    }
    if (entity === "outlets" && CLIENT_FILLED_EMPTY_FIELDS.has(field)) {
      return {
        ok: false,
        message: `Поле «${field}» недоступно для фильтрации в режиме торговых точек.`,
      };
    }
  }

  for (const field of filledFields) {
    if (emptyFields.includes(field)) {
      return { ok: false, message: `Поле «${field}» не может быть одновременно заполнено и пустым.` };
    }
  }

  return { ok: true, filled: filledFields, empty: emptyFields };
}

export function hasOutletDerivedClientFilters(query: {
  entity: ClientsEntityMode;
  warehouseFilter: string;
  outletStatus: string;
  tandoorClub?: string;
  bonusTandoorClub?: string;
  discountProgram?: string;
  discountAmountMin?: number;
  discountAmountMax?: number;
  markupName?: string;
  markupPercentage?: number;
  routeDirection?: string;
  storeAddressContains?: string;
  storePhoneContains?: string;
  accountantPhoneContains?: string;
  accountantEmailContains?: string;
  loadingTime?: string;
  loadingSchedule?: string;
  filled?: string;
  empty?: string;
  outletManagerId?: string;
  outletManagerIds?: string[];
  outletRegionalManagerId?: string;
  outletRegionalManagerIds?: string[];
  outletHardwareManagerId?: string;
  outletHardwareManagerIds?: string[];
  outletRopEmployeeGuid?: string;
  outletManagerMode?: string;
  outletRegionalManagerMode?: string;
  outletHardwareManagerMode?: string;
  outletRopEmployeeMode?: string;
  missingOutletManager?: boolean;
  missingOutletRegional?: boolean;
  missingOutletHardware?: boolean;
  missingOutletRop?: boolean;
}): boolean {
  if (query.entity !== "clients") {
    return false;
  }
  if (query.warehouseFilter !== "all" || query.outletStatus !== "all") {
    return true;
  }
  if (
    query.tandoorClub ||
    query.bonusTandoorClub ||
    query.routeDirection ||
    query.storeAddressContains
  ) {
    return true;
  }
  if (
    query.storePhoneContains ||
    query.accountantPhoneContains ||
    query.accountantEmailContains ||
    query.loadingTime ||
    query.loadingSchedule
  ) {
    return true;
  }
  if (query.outletManagerId || (query.outletManagerIds && query.outletManagerIds.length > 0)) {
    return true;
  }
  if (query.outletRegionalManagerId || (query.outletRegionalManagerIds && query.outletRegionalManagerIds.length > 0)) {
    return true;
  }
  if (query.outletHardwareManagerId || (query.outletHardwareManagerIds && query.outletHardwareManagerIds.length > 0)) {
    return true;
  }
  if (query.outletRopEmployeeGuid) {
    return true;
  }
  if (
    query.outletManagerMode ||
    query.outletRegionalManagerMode ||
    query.outletHardwareManagerMode ||
    query.outletRopEmployeeMode
  ) {
    return true;
  }
  if (query.missingOutletManager || query.missingOutletRegional || query.missingOutletHardware || query.missingOutletRop) {
    return true;
  }
  const filled = parseFilledEmptyFieldList(query.filled);
  const empty = parseFilledEmptyFieldList(query.empty);
  return (
    filled.some((field) => OUTLET_FILLED_EMPTY_FIELDS.has(field)) ||
    empty.some((field) => OUTLET_FILLED_EMPTY_FIELDS.has(field))
  );
}
