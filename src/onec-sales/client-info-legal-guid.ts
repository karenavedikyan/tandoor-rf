import { isValidNonZeroUuid, normalizeUuid } from "../onec-clients/uuid";

export type ClientInfoLegalGuidFailureCode =
  | "MISSING_CLIENT_INFO"
  | "INVALID_LEGAL_GUID"
  | "CLIENT_INFO_GUID_ID_CONFLICT";

export type ClientInfoLegalGuidResult =
  | { ok: true; legalGuid: string; source: "guid" | "legacy_id" }
  | { ok: false; code: ClientInfoLegalGuidFailureCode };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseUuidField(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!isValidNonZeroUuid(trimmed)) {
    return null;
  }
  return normalizeUuid(trimmed);
}

/**
 * Canonical legal entity key from 1C sale/return client_info.
 * Prefer `guid` (matches all_clients.guid_client); `id` only when `guid` is absent.
 */
export function readLegalEntityGuidFromClientInfo(clientInfo: unknown): ClientInfoLegalGuidResult {
  if (!isPlainObject(clientInfo)) {
    return { ok: false, code: "MISSING_CLIENT_INFO" };
  }
  const guidParsed = parseUuidField(clientInfo.guid);
  const idParsed = parseUuidField(clientInfo.id);
  const hasGuidKey = "guid" in clientInfo && clientInfo.guid != null && String(clientInfo.guid).trim() !== "";
  const hasIdKey = "id" in clientInfo && clientInfo.id != null && String(clientInfo.id).trim() !== "";

  if (hasGuidKey && hasIdKey && guidParsed && idParsed && guidParsed !== idParsed) {
    return { ok: false, code: "CLIENT_INFO_GUID_ID_CONFLICT" };
  }
  if (hasGuidKey) {
    if (!guidParsed) {
      return { ok: false, code: "INVALID_LEGAL_GUID" };
    }
    return { ok: true, legalGuid: guidParsed, source: "guid" };
  }
  if (hasIdKey) {
    if (!idParsed) {
      return { ok: false, code: "INVALID_LEGAL_GUID" };
    }
    return { ok: true, legalGuid: idParsed, source: "legacy_id" };
  }
  return { ok: false, code: "INVALID_LEGAL_GUID" };
}
