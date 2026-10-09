import { buildClientsFileBytes } from "./onec-clients-fixtures";

const MANAGER = "22222222-2222-4222-8222-222222222222";

export function typeCategory(overrides: Record<string, string> = {}) {
  return {
    guid_type: "",
    name_type: "",
    guid_category: "",
    name_category: "",
    ...overrides,
  };
}

export function minimalOutlet(
  guidStore: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    guid_store: guidStore,
    closed: false,
    ...overrides,
  };
}

export function headRow(
  headGuid: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    guid_client: headGuid,
    name_client: `SYNTH Head ${headGuid.slice(0, 8)}`,
    guid_holding: headGuid,
    name_holding: "SYNTH Holding",
    guid_manager: MANAGER,
    name_manager: "SYNTH Manager",
    address: "",
    telephone: [],
    retail_outlets: [],
    Код: "",
    Контрагент: null,
    НаименованиеПолное: null,
    ЮрФизЛицо: null,
    Оптовик_ОГРН: null,
    Discount: "",
    DiscountAmount: 0,
    Markups: [],
    ...overrides,
  };
}

export function memberRow(
  memberGuid: string,
  headGuid: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    guid_client: memberGuid,
    name_client: `SYNTH Member ${memberGuid.slice(0, 8)}`,
    guid_holding: headGuid,
    name_holding: "SYNTH Holding",
    guid_manager: MANAGER,
    name_manager: "SYNTH Manager",
    address: "",
    telephone: [],
    retail_outlets: [],
    Код: "M",
    Контрагент: "SYNTH",
    НаименованиеПолное: "SYNTH",
    ЮрФизЛицо: "Юрлицо",
    Оптовик_ОГРН: "0",
    Discount: "",
    DiscountAmount: 0,
    Markups: [],
    ...overrides,
  };
}

export function buildHoldingV2FileBytes(records: Record<string, unknown>[]): Buffer {
  return buildClientsFileBytes(records);
}
