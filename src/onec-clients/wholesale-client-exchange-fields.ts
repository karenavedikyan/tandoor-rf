import type { ExtendedSnapshot } from "./extended-types";

/** JSON key on client object in `/LC/clients/all_clients.json` (confirmed F2 snapshot 2026-10-04). */
export const WHOLESALE_JSON_KEY_TOP150 = "Оптовик_Топ150";
/** JSON key on client object — category string, not TOP tier mapping. */
export const WHOLESALE_JSON_KEY_OUTLET_CATEGORY = "Оптовик_КатегорияТорговойТочкиТандор";

export type ParsedWholesaleClientExchange = {
  top150: string | null;
  outletCategory: string | null;
  fieldPresence: {
    top150: boolean;
    outletCategory: boolean;
  };
};

export function createEmptyWholesaleClientExchange(): ParsedWholesaleClientExchange {
  return {
    top150: null,
    outletCategory: null,
    fieldPresence: {
      top150: false,
      outletCategory: false,
    },
  };
}

export type SnapshotWholesaleClientExchange = ParsedWholesaleClientExchange;

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
  if (typeof value === "number" && Number.isFinite(value)) {
    return { ok: true, value: String(value) };
  }
  return { ok: false, reason: "invalid_type" };
}

export function parseWholesaleClientExchangeFields(raw: Record<string, unknown>): {
  wholesale: ParsedWholesaleClientExchange;
  invalid: boolean;
} {
  const wholesale = createEmptyWholesaleClientExchange();

  if (WHOLESALE_JSON_KEY_TOP150 in raw) {
    wholesale.fieldPresence.top150 = true;
    const parsed = readPreservedStringField(raw[WHOLESALE_JSON_KEY_TOP150]);
    if (!parsed.ok) {
      return { wholesale: createEmptyWholesaleClientExchange(), invalid: true };
    }
    wholesale.top150 = parsed.value;
  }

  if (WHOLESALE_JSON_KEY_OUTLET_CATEGORY in raw) {
    wholesale.fieldPresence.outletCategory = true;
    const parsed = readPreservedStringField(raw[WHOLESALE_JSON_KEY_OUTLET_CATEGORY]);
    if (!parsed.ok) {
      return { wholesale: createEmptyWholesaleClientExchange(), invalid: true };
    }
    wholesale.outletCategory = parsed.value;
  }

  return { wholesale, invalid: false };
}

export function hasAnyWholesaleClientExchangeField(wholesale: ParsedWholesaleClientExchange): boolean {
  return wholesale.fieldPresence.top150 || wholesale.fieldPresence.outletCategory;
}

export function readSnapshotWholesaleClientExchange(
  snapshot: ExtendedSnapshot | null,
): SnapshotWholesaleClientExchange | null {
  const raw = snapshot?.wholesaleExchange;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return raw as SnapshotWholesaleClientExchange;
}

export function mergeWholesaleClientExchangeFields(
  incoming: ParsedWholesaleClientExchange,
  previous: ParsedWholesaleClientExchange | undefined,
): ParsedWholesaleClientExchange {
  const prev = previous ?? createEmptyWholesaleClientExchange();
  if (!hasAnyWholesaleClientExchangeField(incoming)) {
    return {
      top150: prev.top150,
      outletCategory: prev.outletCategory,
      fieldPresence: { ...prev.fieldPresence },
    };
  }
  return {
    top150: incoming.fieldPresence.top150 ? incoming.top150 : prev.top150,
    outletCategory: incoming.fieldPresence.outletCategory ? incoming.outletCategory : prev.outletCategory,
    fieldPresence: {
      top150: incoming.fieldPresence.top150 || prev.fieldPresence.top150,
      outletCategory: incoming.fieldPresence.outletCategory || prev.fieldPresence.outletCategory,
    },
  };
}
