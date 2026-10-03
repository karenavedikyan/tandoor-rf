import {
  toLegacyValidatedPayload,
  validateExtendedClientsFileBytes,
  type ValidateClientsLimits,
} from "./extended-validate";
import type { QuarantineManifest } from "./quarantine-manifest";
import {
  validateQuarantineAgainstIssues,
  type QuarantineValidationFailure,
  type QuarantineValidationSuccess,
} from "./quarantine-validation";
import { sha256Hex } from "./sha256";
import type { ValidatedClientsPayload } from "./types";
import { normalizeUuid } from "./uuid";

export type QuarantineProjectionFailure =
  | QuarantineValidationFailure
  | { code: "VALIDATION_PASSED_WITHOUT_QUARANTINE"; message: string }
  | { code: "PARSE_INCOMPLETE"; message: string }
  | { code: "INVALID_SOURCE_ARRAY"; message: string }
  | { code: "ACCEPTED_REVALIDATION_FAILED"; message: string; issueCount: number };

export type QuarantineProjectionSuccess = {
  sourceSha256: string;
  acceptedBytes: Buffer;
  quarantine: QuarantineValidationSuccess;
  payload: ValidatedClientsPayload;
};

export function buildAcceptedClientsFileBytes(
  originalBytes: Buffer,
  acceptedGuids: Set<string>,
): Buffer | { code: "INVALID_SOURCE_ARRAY"; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(originalBytes.toString("utf8"));
  } catch {
    return { code: "INVALID_SOURCE_ARRAY", message: "Clients source is not valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { code: "INVALID_SOURCE_ARRAY", message: "Clients source must be a JSON array." };
  }
  const filtered = parsed.filter((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return false;
    }
    const guid = (row as Record<string, unknown>).guid_client;
    if (typeof guid !== "string") {
      return false;
    }
    return acceptedGuids.has(normalizeUuid(guid.trim()).toLowerCase());
  });
  return Buffer.from(JSON.stringify(filtered), "utf8");
}

export function projectAcceptedClientsWithQuarantine(input: {
  clientsBytes: Buffer;
  manifest: QuarantineManifest;
  limits?: ValidateClientsLimits;
}): QuarantineProjectionFailure | QuarantineProjectionSuccess {
  const sourceSha256 = sha256Hex(input.clientsBytes);
  const extended = validateExtendedClientsFileBytes(input.clientsBytes, input.limits);

  if (extended.ok) {
    return {
      code: "VALIDATION_PASSED_WITHOUT_QUARANTINE",
      message: "Source validates without errors; quarantine manifest is not applicable.",
    };
  }

  if (!extended.parsedRecords || !extended.sourceSha256) {
    return {
      code: "PARSE_INCOMPLETE",
      message: "Validation failed before a quarantine projection could be built.",
    };
  }

  const quarantine = validateQuarantineAgainstIssues({
    sourceSha256: extended.sourceSha256,
    manifest: input.manifest,
    records: extended.parsedRecords,
    issues: extended.issues,
  });
  if ("code" in quarantine) {
    return quarantine;
  }

  const acceptedBytesResult = buildAcceptedClientsFileBytes(input.clientsBytes, quarantine.acceptedGuids);
  if (!Buffer.isBuffer(acceptedBytesResult)) {
    return acceptedBytesResult;
  }
  const acceptedBytes = acceptedBytesResult;

  const revalidated = validateExtendedClientsFileBytes(acceptedBytes, input.limits);
  if (!revalidated.ok) {
    return {
      code: "ACCEPTED_REVALIDATION_FAILED",
      message: "Accepted projection failed re-validation.",
      issueCount: revalidated.issueCount,
    };
  }

  const payload: ValidatedClientsPayload = {
    ...toLegacyValidatedPayload(revalidated.payload, { keepExtendedWarnings: true }),
    sourceFormat: revalidated.payload.sourceFormat,
    extendedRecords: revalidated.payload.records,
    extendedDiagnostics: revalidated.payload.diagnostics,
    extendedContractVerification: revalidated.payload.extendedContractVerification ?? "unverified",
    holdingLinkValidationPolicy: revalidated.payload.holdingLinkValidationPolicy,
    employeeRosterSourceSha256: revalidated.payload.employeeRosterSourceSha256,
    wholesaleCompositionMode: "standard",
  };

  return {
    sourceSha256,
    acceptedBytes,
    quarantine,
    payload,
  };
}
