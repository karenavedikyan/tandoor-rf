import type { OnecFtpConfig } from "../onec-ftp/types";
import { DEFAULT_HOLDING_LINK_VALIDATION_POLICY, type HoldingLinkValidationPolicy } from "./holding-link-policy";
import type { WholesaleEmployeeRoster } from "./employee-roster";
import { defaultFtpReader, type FtpReader } from "./ftp-read";
import { verificationFingerprintFromPayload } from "./import-verification-fingerprint";
import { readStableClientsFile } from "./read-stable";
import { readStableEmployeeRosterFile, type EmployeeRosterReader } from "./read-stable-roster";
import type { ValidatedClientsPayload } from "./types";
import { mergeHoldingV2StableReadLimits } from "./stable-read-validation";
import type { ValidateClientsLimits } from "./validate";
import { validateClientsFileBytes } from "./validate";

export type StableBundleFailureCode =
  | "FTP_ERROR"
  | "TIMEOUT"
  | "VALIDATION_FAILED"
  | "UNSTABLE_SOURCE"
  | "BUNDLE_READ_DRIFT"
  | "FILE_TOO_LARGE"
  | "EMPLOYEE_ROSTER_EMPTY";

export type StableBundleReadResult =
  | {
      ok: true;
      clientsPayload: ValidatedClientsPayload;
      roster: WholesaleEmployeeRoster;
      verificationFingerprint: string;
      clientsReadCount: number;
      rosterReadCount: number;
    }
  | {
      ok: false;
      code: StableBundleFailureCode;
      message: string;
      clientsReadCount: number;
      rosterReadCount: number;
      clientsSha256?: string;
      rosterSha256?: string;
    };

export async function readStableImportBundle(
  config: OnecFtpConfig,
  options: {
    clientsReader?: FtpReader;
    rosterReader?: EmployeeRosterReader;
    stabilityDelayMs: number;
    readDeadlineMs?: number;
    holdingLinkValidationPolicy?: HoldingLinkValidationPolicy;
    requireNonEmptyRoster?: boolean;
  },
): Promise<StableBundleReadResult> {
  const holdingLinkValidationPolicy =
    options.holdingLinkValidationPolicy ?? DEFAULT_HOLDING_LINK_VALIDATION_POLICY;

  const baseStableLimits: ValidateClientsLimits = {
    holdingLinkValidationPolicy,
    employeeRosterExplicit: false,
  };
  const stableClientLimits = mergeHoldingV2StableReadLimits(baseStableLimits);

  const clientsStable = await readStableClientsFile(config, {
    reader: options.clientsReader,
    stabilityDelayMs: options.stabilityDelayMs,
    readDeadlineMs: options.readDeadlineMs,
    validationLimits: stableClientLimits,
  });

  if (!clientsStable.ok) {
    return {
      ok: false,
      code: clientsStable.code === "HASH_MISMATCH" ? "VALIDATION_FAILED" : clientsStable.code,
      message: clientsStable.message,
      clientsReadCount: clientsStable.readCount,
      rosterReadCount: 0,
      clientsSha256: clientsStable.firstSha256,
    };
  }

  const rosterStable = await readStableEmployeeRosterFile(config, {
    reader: options.rosterReader,
    stabilityDelayMs: options.stabilityDelayMs,
    readDeadlineMs: options.readDeadlineMs,
  });

  if (!rosterStable.ok) {
    return {
      ok: false,
      code: rosterStable.code,
      message: rosterStable.message,
      clientsReadCount: clientsStable.readCount,
      rosterReadCount: rosterStable.readCount,
      clientsSha256: clientsStable.payload.sha256,
      rosterSha256: rosterStable.firstSha256,
    };
  }

  if (options.requireNonEmptyRoster !== false && rosterStable.roster.isEmpty) {
    return {
      ok: false,
      code: "EMPLOYEE_ROSTER_EMPTY",
      message: "Employee roster is empty; regular update requires a non-empty wholesale roster.",
      clientsReadCount: clientsStable.readCount,
      rosterReadCount: rosterStable.readCount,
      clientsSha256: clientsStable.payload.sha256,
      rosterSha256: rosterStable.roster.sourceSha256,
    };
  }

  const clientsReader = options.clientsReader ?? defaultFtpReader;
  const clientsRecheck = await clientsReader(config, { readDeadlineMs: options.readDeadlineMs });

  if (!clientsRecheck.ok) {
    return {
      ok: false,
      code: clientsRecheck.code === "TIMEOUT" ? "TIMEOUT" : "FTP_ERROR",
      message: "Clients file became unreadable during bundle verification.",
      clientsReadCount: clientsStable.readCount + 1,
      rosterReadCount: rosterStable.readCount,
      clientsSha256: clientsStable.payload.sha256,
      rosterSha256: rosterStable.roster.sourceSha256,
    };
  }

  const recheckValidated = validateClientsFileBytes(clientsRecheck.bytes, stableClientLimits);
  if (!recheckValidated.ok || recheckValidated.payload.sha256 !== clientsStable.payload.sha256) {
    return {
      ok: false,
      code: "BUNDLE_READ_DRIFT",
      message:
        "Clients file changed while reading the employee roster; bundle verification aborted to avoid a mismatched pair.",
      clientsReadCount: clientsStable.readCount + 1,
      rosterReadCount: rosterStable.readCount,
      clientsSha256: clientsStable.payload.sha256,
      rosterSha256: rosterStable.roster.sourceSha256,
    };
  }

  const validated = validateClientsFileBytes(
    clientsRecheck.bytes,
    mergeHoldingV2StableReadLimits({
      holdingLinkValidationPolicy,
      employeeRoster: rosterStable.roster,
      employeeRosterExplicit: true,
    }),
  );

  if (!validated.ok) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "Bundle validation failed after stable reads.",
      clientsReadCount: clientsStable.readCount + 1,
      rosterReadCount: rosterStable.readCount,
      clientsSha256: clientsStable.payload.sha256,
      rosterSha256: rosterStable.roster.sourceSha256,
    };
  }

  const verificationFingerprint = verificationFingerprintFromPayload({ payload: validated.payload });

  return {
    ok: true,
    clientsPayload: validated.payload,
    roster: rosterStable.roster,
    verificationFingerprint,
    clientsReadCount: clientsStable.readCount + 1,
    rosterReadCount: rosterStable.readCount,
  };
}
