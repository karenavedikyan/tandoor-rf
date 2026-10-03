import { createHash } from "node:crypto";
import { isValidNonZeroUuid, normalizeUuid } from "./uuid";

export const QUARANTINE_REASONS = ["HOLDING_TARGET_NOT_HOLDING_CARD"] as const;
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

export type QuarantineManifestEntry = {
  guidClient: string;
  reason: QuarantineReason;
  relatedGuid?: string | null;
};

export type QuarantineManifest = {
  v: 1;
  sourceSha256: string;
  entries: QuarantineManifestEntry[];
};

export type QuarantineManifestParseFailure =
  | { code: "INVALID_JSON"; message: string }
  | { code: "INVALID_MANIFEST"; message: string };

function isQuarantineReason(value: unknown): value is QuarantineReason {
  return typeof value === "string" && (QUARANTINE_REASONS as readonly string[]).includes(value);
}

export function parseQuarantineManifestBytes(bytes: Buffer): QuarantineManifestParseFailure | QuarantineManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { code: "INVALID_JSON", message: "Quarantine manifest is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { code: "INVALID_MANIFEST", message: "Quarantine manifest must be an object." };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.v !== 1) {
    return { code: "INVALID_MANIFEST", message: "Quarantine manifest version must be 1." };
  }
  if (typeof obj.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(obj.sourceSha256.trim())) {
    return { code: "INVALID_MANIFEST", message: "Quarantine manifest requires sourceSha256 (64 hex)." };
  }
  if (!Array.isArray(obj.entries) || obj.entries.length === 0) {
    return { code: "INVALID_MANIFEST", message: "Quarantine manifest requires a non-empty entries array." };
  }

  const entries: QuarantineManifestEntry[] = [];
  const seen = new Set<string>();
  for (const raw of obj.entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { code: "INVALID_MANIFEST", message: "Each quarantine entry must be an object." };
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.guidClient !== "string" || !isValidNonZeroUuid(entry.guidClient.trim())) {
      return { code: "INVALID_MANIFEST", message: "Each quarantine entry requires guidClient UUID." };
    }
    if (!isQuarantineReason(entry.reason)) {
      return { code: "INVALID_MANIFEST", message: "Unsupported quarantine reason." };
    }
    const guidClient = normalizeUuid(entry.guidClient.trim());
    if (seen.has(guidClient)) {
      return { code: "INVALID_MANIFEST", message: "Duplicate quarantine guidClient." };
    }
    seen.add(guidClient);

    let relatedGuid: string | null = null;
    if (entry.relatedGuid !== undefined && entry.relatedGuid !== null) {
      if (typeof entry.relatedGuid !== "string" || !isValidNonZeroUuid(entry.relatedGuid.trim())) {
        return { code: "INVALID_MANIFEST", message: "relatedGuid must be a UUID when provided." };
      }
      relatedGuid = normalizeUuid(entry.relatedGuid.trim());
    }

    entries.push({ guidClient, reason: entry.reason, relatedGuid });
  }

  return {
    v: 1,
    sourceSha256: obj.sourceSha256.trim().toLowerCase(),
    entries,
  };
}

export function canonicalQuarantineManifest(manifest: QuarantineManifest): string {
  return JSON.stringify({
    v: manifest.v,
    sourceSha256: manifest.sourceSha256.toLowerCase(),
    entries: [...manifest.entries]
      .map((entry) => ({
        guidClient: entry.guidClient.toLowerCase(),
        reason: entry.reason,
        relatedGuid: entry.relatedGuid?.toLowerCase() ?? null,
      }))
      .sort((a, b) => a.guidClient.localeCompare(b.guidClient)),
  });
}

export function quarantineManifestSha256(manifest: QuarantineManifest): string {
  return createHash("sha256")
    .update(canonicalQuarantineManifest(manifest), "utf8")
    .digest("hex");
}

export function quarantinedGuidSet(manifest: QuarantineManifest): Set<string> {
  return new Set(manifest.entries.map((entry) => entry.guidClient.toLowerCase()));
}
