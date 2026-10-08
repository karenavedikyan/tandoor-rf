import type { ExtendedSnapshot } from "./extended-types";

/** JSON key — 1C client code string (confirmed F5 audit 2026-10-04). */
export const CLIENT_CODE_JSON_KEY = "Код";

export type ParsedClientCodeExchange = {
  code1c: string | null;
  fieldPresence: {
    code1c: boolean;
  };
};

export type SnapshotClientCodeExchange = ParsedClientCodeExchange;

export function createEmptyClientCodeExchange(): ParsedClientCodeExchange {
  return {
    code1c: null,
    fieldPresence: {
      code1c: false,
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

export function parseClientCodeExchangeFields(raw: Record<string, unknown>): {
  clientCode: ParsedClientCodeExchange;
  invalid: boolean;
} {
  const clientCode = createEmptyClientCodeExchange();

  if (CLIENT_CODE_JSON_KEY in raw) {
    clientCode.fieldPresence.code1c = true;
    const parsed = readPreservedStringField(raw[CLIENT_CODE_JSON_KEY]);
    if (!parsed.ok) {
      return { clientCode: createEmptyClientCodeExchange(), invalid: true };
    }
    clientCode.code1c = parsed.value;
  }

  return { clientCode, invalid: false };
}

export function hasAnyClientCodeExchangeField(exchange: ParsedClientCodeExchange): boolean {
  return exchange.fieldPresence.code1c;
}

export function readSnapshotClientCodeExchange(
  snapshot: ExtendedSnapshot | null,
): SnapshotClientCodeExchange | null {
  const raw = snapshot?.clientCode;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return raw as SnapshotClientCodeExchange;
}

export function mergeClientCodeExchangeFields(
  incoming: ParsedClientCodeExchange,
  previous: ParsedClientCodeExchange | undefined,
): ParsedClientCodeExchange {
  const prev = previous ?? createEmptyClientCodeExchange();
  if (!hasAnyClientCodeExchangeField(incoming)) {
    return {
      code1c: prev.code1c,
      fieldPresence: { ...prev.fieldPresence },
    };
  }
  return {
    code1c: incoming.fieldPresence.code1c ? incoming.code1c : prev.code1c,
    fieldPresence: {
      code1c: incoming.fieldPresence.code1c || prev.fieldPresence.code1c,
    },
  };
}
