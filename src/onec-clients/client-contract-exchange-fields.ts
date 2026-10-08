import type { ExtendedSnapshot } from "./extended-types";

/** JSON key — primary contract string (confirmed F4 audit 2026-10-04). */
export const CLIENT_CONTRACT_JSON_KEY_PRIMARY = "Оптовик_ОсновнойДоговор";
/** JSON key — main agreement string. */
export const CLIENT_CONTRACT_JSON_KEY_AGREEMENT = "Оптовик_ОсновноеСоглашение";

export type ParsedClientContractExchange = {
  primaryContract: string | null;
  mainAgreement: string | null;
  fieldPresence: {
    primaryContract: boolean;
    mainAgreement: boolean;
  };
};

export type SnapshotClientContractExchange = ParsedClientContractExchange;

export function createEmptyClientContractExchange(): ParsedClientContractExchange {
  return {
    primaryContract: null,
    mainAgreement: null,
    fieldPresence: {
      primaryContract: false,
      mainAgreement: false,
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

export function parseClientContractExchangeFields(raw: Record<string, unknown>): {
  clientContract: ParsedClientContractExchange;
  invalid: boolean;
} {
  const clientContract = createEmptyClientContractExchange();

  if (CLIENT_CONTRACT_JSON_KEY_PRIMARY in raw) {
    clientContract.fieldPresence.primaryContract = true;
    const parsed = readPreservedStringField(raw[CLIENT_CONTRACT_JSON_KEY_PRIMARY]);
    if (!parsed.ok) {
      return { clientContract: createEmptyClientContractExchange(), invalid: true };
    }
    clientContract.primaryContract = parsed.value;
  }

  if (CLIENT_CONTRACT_JSON_KEY_AGREEMENT in raw) {
    clientContract.fieldPresence.mainAgreement = true;
    const parsed = readPreservedStringField(raw[CLIENT_CONTRACT_JSON_KEY_AGREEMENT]);
    if (!parsed.ok) {
      return { clientContract: createEmptyClientContractExchange(), invalid: true };
    }
    clientContract.mainAgreement = parsed.value;
  }

  return { clientContract, invalid: false };
}

export function hasAnyClientContractExchangeField(exchange: ParsedClientContractExchange): boolean {
  return exchange.fieldPresence.primaryContract || exchange.fieldPresence.mainAgreement;
}

export function readSnapshotClientContractExchange(
  snapshot: ExtendedSnapshot | null,
): SnapshotClientContractExchange | null {
  const raw = snapshot?.clientContract;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return raw as SnapshotClientContractExchange;
}

export function mergeClientContractExchangeFields(
  incoming: ParsedClientContractExchange,
  previous: ParsedClientContractExchange | undefined,
): ParsedClientContractExchange {
  const prev = previous ?? createEmptyClientContractExchange();
  if (!hasAnyClientContractExchangeField(incoming)) {
    return {
      primaryContract: prev.primaryContract,
      mainAgreement: prev.mainAgreement,
      fieldPresence: { ...prev.fieldPresence },
    };
  }
  return {
    primaryContract: incoming.fieldPresence.primaryContract ? incoming.primaryContract : prev.primaryContract,
    mainAgreement: incoming.fieldPresence.mainAgreement ? incoming.mainAgreement : prev.mainAgreement,
    fieldPresence: {
      primaryContract: incoming.fieldPresence.primaryContract || prev.fieldPresence.primaryContract,
      mainAgreement: incoming.fieldPresence.mainAgreement || prev.fieldPresence.mainAgreement,
    },
  };
}
