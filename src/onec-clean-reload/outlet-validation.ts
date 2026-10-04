import { isValidNonZeroUuid, normalizeUuid } from "../onec-clients/uuid";

export type CleanReloadOutletIssue = {
  clientIndex: number;
  outletIndex: number;
  field: "guid_store" | "closed";
  code: "MISSING_FIELD" | "INVALID_TYPE" | "INVALID_UUID" | "DUPLICATE_GUID_STORE";
};

export type CleanReloadOutletValidationResult =
  | { ok: true; outletGuids: readonly string[] }
  | { ok: false; code: "INVALID_JSON" | "INVALID_ROOT" | "OUTLET_IDENTITY_REQUIRED"; issues: CleanReloadOutletIssue[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Strict outlet identity contract for clean reload only (legacy import unchanged). */
export function validateCleanReloadOutletIdentityBytes(bytes: Buffer): CleanReloadOutletValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, code: "INVALID_JSON", issues: [] };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, code: "INVALID_ROOT", issues: [] };
  }

  const issues: CleanReloadOutletIssue[] = [];
  const seenGuids = new Set<string>();
  const outletGuids: string[] = [];

  for (let clientIndex = 0; clientIndex < parsed.length; clientIndex += 1) {
    const client = parsed[clientIndex];
    if (!isPlainObject(client)) {
      continue;
    }
    const outlets = client.retail_outlets;
    if (outlets === undefined || outlets === null) {
      continue;
    }
    if (!Array.isArray(outlets)) {
      issues.push({
        clientIndex,
        outletIndex: 0,
        field: "guid_store",
        code: "INVALID_TYPE",
      });
      continue;
    }

    for (let outletIndex = 0; outletIndex < outlets.length; outletIndex += 1) {
      const outlet = outlets[outletIndex];
      if (!isPlainObject(outlet)) {
        issues.push({
          clientIndex,
          outletIndex,
          field: "guid_store",
          code: "INVALID_TYPE",
        });
        continue;
      }

      const guidRaw = outlet.guid_store;
      let guid: string | null = null;
      if (typeof guidRaw !== "string" || guidRaw.trim().length === 0) {
        issues.push({
          clientIndex,
          outletIndex,
          field: "guid_store",
          code: guidRaw === undefined || guidRaw === null ? "MISSING_FIELD" : "INVALID_TYPE",
        });
      } else if (!isValidNonZeroUuid(guidRaw.trim())) {
        issues.push({
          clientIndex,
          outletIndex,
          field: "guid_store",
          code: "INVALID_UUID",
        });
      } else {
        guid = normalizeUuid(guidRaw.trim());
        if (seenGuids.has(guid)) {
          issues.push({
            clientIndex,
            outletIndex,
            field: "guid_store",
            code: "DUPLICATE_GUID_STORE",
          });
        } else {
          seenGuids.add(guid);
          outletGuids.push(guid);
        }
      }

      if (!Object.prototype.hasOwnProperty.call(outlet, "closed")) {
        issues.push({
          clientIndex,
          outletIndex,
          field: "closed",
          code: "MISSING_FIELD",
        });
      } else if (typeof outlet.closed !== "boolean") {
        issues.push({
          clientIndex,
          outletIndex,
          field: "closed",
          code: "INVALID_TYPE",
        });
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, code: "OUTLET_IDENTITY_REQUIRED", issues };
  }

  return { ok: true, outletGuids };
}
