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

/** Deterministic non-zero UUID for large synthetic bundles (no real 1C data). */
export function synthExchangeUuid(series: number, index: number): string {
  const seriesHex = series.toString(16).padStart(4, "0").slice(-4);
  const indexHex = index.toString(16).padStart(12, "0").slice(-12);
  return `${seriesHex}0000-0000-4000-8000-${indexHex}`;
}

/**
 * Minimal synthetic file reproducing a v2 composition distribution (e.g. audit snapshot:
 * 422 mono + 2320 group_network holdings) without embedding production JSON.
 */
export function buildCompositionPatternBundle(options: {
  monoCount: number;
  groupNetworkCount: number;
}): Buffer {
  const rows: Record<string, unknown>[] = [];
  let storeSeq = 0;
  const nextStoreGuid = (): string => synthExchangeUuid(0x0b10, storeSeq++);

  for (let i = 0; i < options.monoCount; i += 1) {
    const headGuid = synthExchangeUuid(0x0a01, i);
    rows.push(
      headRow(headGuid, {
        type_category: typeCategory(),
        retail_outlets: [
          minimalOutlet(nextStoreGuid(), { type_category: typeCategory() }),
        ],
      }),
    );
  }

  for (let j = 0; j < options.groupNetworkCount; j += 1) {
    const headGuid = synthExchangeUuid(0x0a02, j * 2);
    const memberGuid = synthExchangeUuid(0x0a02, j * 2 + 1);
    rows.push(
      headRow(headGuid, {
        type_category: typeCategory(),
        retail_outlets: [
          minimalOutlet(nextStoreGuid(), { type_category: typeCategory() }),
          minimalOutlet(nextStoreGuid(), { type_category: typeCategory() }),
        ],
      }),
    );
    rows.push(memberRow(memberGuid, headGuid, { type_category: typeCategory() }));
  }

  return buildHoldingV2FileBytes(rows);
}
