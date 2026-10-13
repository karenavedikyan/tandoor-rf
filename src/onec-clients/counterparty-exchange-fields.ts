import type { ExtendedSnapshot } from "./extended-types";

/** JSON key — counterparty display name (confirmed F2/F3 audit 2026-10-04). */
export const COUNTERPARTY_JSON_KEY_NAME = "Контрагент";
/** JSON key — legal entity type string, e.g. «Компания» / «Частное лицо». */
export const COUNTERPARTY_JSON_KEY_LEGAL_TYPE = "ЮрФизЛицо";
/** JSON key — OGRN as string (leading zeros preserved). */
export const COUNTERPARTY_JSON_KEY_OGRN = "Оптовик_ОГРН";
/** JSON key — full legal name. */
export const COUNTERPARTY_JSON_KEY_FULL_NAME = "НаименованиеПолное";

export type ParsedCounterpartyExchange = {
  counterparty: string | null;
  legalEntityType: string | null;
  ogrn: string | null;
  fullName: string | null;
  fieldPresence: {
    counterparty: boolean;
    legalEntityType: boolean;
    ogrn: boolean;
    fullName: boolean;
  };
};

export type SnapshotCounterpartyExchange = ParsedCounterpartyExchange;

export function createEmptyCounterpartyExchange(): ParsedCounterpartyExchange {
  return {
    counterparty: null,
    legalEntityType: null,
    ogrn: null,
    fullName: null,
    fieldPresence: {
      counterparty: false,
      legalEntityType: false,
      ogrn: false,
      fullName: false,
    },
  };
}

type ReadPreservedStringResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: "invalid_type" };

function readPreservedStringField(value: unknown): ReadPreservedStringResult {
  if (value === null || value === undefined) {
    return { ok: true, value: null };
  }
  if (typeof value === "string") {
    return { ok: true, value };
  }
  return { ok: false, reason: "invalid_type" };
}

export function parseCounterpartyExchangeFields(raw: Record<string, unknown>): {
  counterparty: ParsedCounterpartyExchange;
  invalid: boolean;
} {
  const counterparty = createEmptyCounterpartyExchange();

  if (COUNTERPARTY_JSON_KEY_NAME in raw) {
    counterparty.fieldPresence.counterparty = true;
    const parsed = readPreservedStringField(raw[COUNTERPARTY_JSON_KEY_NAME]);
    if (!parsed.ok) {
      return { counterparty: createEmptyCounterpartyExchange(), invalid: true };
    }
    counterparty.counterparty = parsed.value;
  }

  if (COUNTERPARTY_JSON_KEY_LEGAL_TYPE in raw) {
    counterparty.fieldPresence.legalEntityType = true;
    const parsed = readPreservedStringField(raw[COUNTERPARTY_JSON_KEY_LEGAL_TYPE]);
    if (!parsed.ok) {
      return { counterparty: createEmptyCounterpartyExchange(), invalid: true };
    }
    counterparty.legalEntityType = parsed.value;
  }

  if (COUNTERPARTY_JSON_KEY_OGRN in raw) {
    counterparty.fieldPresence.ogrn = true;
    const parsed = readPreservedStringField(raw[COUNTERPARTY_JSON_KEY_OGRN]);
    if (!parsed.ok) {
      return { counterparty: createEmptyCounterpartyExchange(), invalid: true };
    }
    counterparty.ogrn = parsed.value;
  }

  if (COUNTERPARTY_JSON_KEY_FULL_NAME in raw) {
    counterparty.fieldPresence.fullName = true;
    const parsed = readPreservedStringField(raw[COUNTERPARTY_JSON_KEY_FULL_NAME]);
    if (!parsed.ok) {
      return { counterparty: createEmptyCounterpartyExchange(), invalid: true };
    }
    counterparty.fullName = parsed.value;
  }

  return { counterparty, invalid: false };
}

export function hasAnyCounterpartyExchangeField(exchange: ParsedCounterpartyExchange): boolean {
  return (
    exchange.fieldPresence.counterparty ||
    exchange.fieldPresence.legalEntityType ||
    exchange.fieldPresence.ogrn ||
    exchange.fieldPresence.fullName
  );
}

export function readSnapshotCounterpartyExchange(
  snapshot: ExtendedSnapshot | null,
): SnapshotCounterpartyExchange | null {
  const raw = snapshot?.counterparty;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return raw as SnapshotCounterpartyExchange;
}

export function mergeCounterpartyExchangeFields(
  incoming: ParsedCounterpartyExchange | undefined,
  previous: ParsedCounterpartyExchange | undefined,
): ParsedCounterpartyExchange {
  const inc = incoming ?? createEmptyCounterpartyExchange();
  const prev = previous ?? createEmptyCounterpartyExchange();
  if (!hasAnyCounterpartyExchangeField(inc)) {
    return {
      counterparty: prev.counterparty,
      legalEntityType: prev.legalEntityType,
      ogrn: prev.ogrn,
      fullName: prev.fullName,
      fieldPresence: { ...prev.fieldPresence },
    };
  }
  return {
    counterparty: inc.fieldPresence.counterparty ? inc.counterparty : prev.counterparty,
    legalEntityType: inc.fieldPresence.legalEntityType ? inc.legalEntityType : prev.legalEntityType,
    ogrn: inc.fieldPresence.ogrn ? inc.ogrn : prev.ogrn,
    fullName: inc.fieldPresence.fullName ? inc.fullName : prev.fullName,
    fieldPresence: {
      counterparty: inc.fieldPresence.counterparty || prev.fieldPresence.counterparty,
      legalEntityType: inc.fieldPresence.legalEntityType || prev.fieldPresence.legalEntityType,
      ogrn: inc.fieldPresence.ogrn || prev.fieldPresence.ogrn,
      fullName: inc.fieldPresence.fullName || prev.fieldPresence.fullName,
    },
  };
}
