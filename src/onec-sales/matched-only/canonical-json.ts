import { createHash } from "node:crypto";

export function sha256CanonicalJson(value: unknown): string {
  const canonical = stableStringify(value);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Exported for tests: normalize values before stable key sort + JSON.stringify. */
export function normalizeForCanonicalJson(value: unknown): unknown {
  return sortValue(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortValue(record[key]);
  }
  return sorted;
}
