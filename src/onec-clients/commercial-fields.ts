import type { ExtendedSnapshot } from "./extended-types";

export type ParsedMarkupEntry = {
  name: string;
  percentage: number | null;
};

export type ParsedClientCommercial = {
  discountProgram: string | null;
  discountAmount: number | null;
  markups: ParsedMarkupEntry[];
  fieldPresence: {
    discountProgram: boolean;
    discountAmount: boolean;
    markups: boolean;
  };
};

export function createEmptyCommercial(): ParsedClientCommercial {
  return {
    discountProgram: null,
    discountAmount: null,
    markups: [],
    fieldPresence: {
      discountProgram: false,
      discountAmount: false,
      markups: false,
    },
  };
}

export const EMPTY_COMMERCIAL: ParsedClientCommercial = createEmptyCommercial();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function readNumberField(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : "invalid";
  }
  return "invalid";
}

export function parseClientCommercialFields(raw: Record<string, unknown>): {
  commercial: ParsedClientCommercial;
  invalid: boolean;
} {
  const commercial = createEmptyCommercial();
  const markups: ParsedMarkupEntry[] = [];

  if ("Discount" in raw) {
    commercial.fieldPresence.discountProgram = true;
    commercial.discountProgram = readStringField(raw.Discount);
  }
  if ("DiscountAmount" in raw) {
    commercial.fieldPresence.discountAmount = true;
    const amount = readNumberField(raw.DiscountAmount);
    if (amount === "invalid") {
      return { commercial: createEmptyCommercial(), invalid: true };
    }
    commercial.discountAmount = amount;
  }
  if ("Markups" in raw) {
    commercial.fieldPresence.markups = true;
    if (raw.Markups === null) {
      commercial.markups = [];
    } else if (!Array.isArray(raw.Markups)) {
      return { commercial: createEmptyCommercial(), invalid: true };
    } else {
      for (const entry of raw.Markups) {
        if (!isPlainObject(entry)) {
          return { commercial: createEmptyCommercial(), invalid: true };
        }
        const name = typeof entry.Name === "string" ? entry.Name.trim() : "";
        const percentage = readNumberField(entry.Percentage);
        if (percentage === "invalid") {
          return { commercial: createEmptyCommercial(), invalid: true };
        }
        markups.push({ name, percentage });
      }
      commercial.markups = markups;
    }
  }

  return { commercial, invalid: false };
}

export function hasAnyCommercialField(commercial: ParsedClientCommercial): boolean {
  return (
    commercial.fieldPresence.discountProgram ||
    commercial.fieldPresence.discountAmount ||
    commercial.fieldPresence.markups
  );
}

export type SnapshotCommercial = ParsedClientCommercial;

export function readSnapshotCommercial(snapshot: ExtendedSnapshot | null): SnapshotCommercial | null {
  const raw = snapshot?.commercial;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return raw as SnapshotCommercial;
}

export const COMMERCIAL_JSON_KEYS = ["Discount", "DiscountAmount", "Markups"] as const;

export function mergeCommercialFields(
  incoming: ParsedClientCommercial,
  previous: ParsedClientCommercial | undefined,
): ParsedClientCommercial {
  const prev = previous ?? createEmptyCommercial();
  if (!hasAnyCommercialField(incoming)) {
    return {
      discountProgram: prev.discountProgram,
      discountAmount: prev.discountAmount,
      markups: prev.markups.slice(),
      fieldPresence: { ...prev.fieldPresence },
    };
  }
  return {
    discountProgram: incoming.fieldPresence.discountProgram ? incoming.discountProgram : prev.discountProgram,
    discountAmount: incoming.fieldPresence.discountAmount ? incoming.discountAmount : prev.discountAmount,
    markups: incoming.fieldPresence.markups ? incoming.markups.slice() : prev.markups.slice(),
    fieldPresence: {
      discountProgram: incoming.fieldPresence.discountProgram || prev.fieldPresence.discountProgram,
      discountAmount: incoming.fieldPresence.discountAmount || prev.fieldPresence.discountAmount,
      markups: incoming.fieldPresence.markups || prev.fieldPresence.markups,
    },
  };
}
