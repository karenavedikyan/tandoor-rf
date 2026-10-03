import { createHash } from "node:crypto";
import type { ValidatedClientsPayload } from "./types";
import { verificationFingerprintFromPayload } from "./import-verification-fingerprint";

export type ExtendedContractConfirmation = {
  clientsSourceSha256: string;
  verificationFingerprint: string;
  operatorReference: string;
};

export function buildExtendedContractConfirmation(input: {
  clientsSourceSha256: string;
  payload: ValidatedClientsPayload;
  operatorReference: string;
}): ExtendedContractConfirmation {
  return {
    clientsSourceSha256: input.clientsSourceSha256.toLowerCase(),
    verificationFingerprint: verificationFingerprintFromPayload({ payload: input.payload }),
    operatorReference: input.operatorReference.trim(),
  };
}

export function extendedContractConfirmationSha256(
  confirmation: ExtendedContractConfirmation,
): string {
  const canonical = JSON.stringify({
    v: 1,
    clientsSourceSha256: confirmation.clientsSourceSha256.toLowerCase(),
    verificationFingerprint: confirmation.verificationFingerprint.toLowerCase(),
    operatorReference: confirmation.operatorReference,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function isExtendedContractConfirmedForPayload(input: {
  payload: ValidatedClientsPayload;
  confirmationSha256: string | null | undefined;
  storedConfirmationSha256: string | null | undefined;
}): boolean {
  if (!input.confirmationSha256 || !input.storedConfirmationSha256) {
    return false;
  }
  return input.confirmationSha256.toLowerCase() === input.storedConfirmationSha256.toLowerCase();
}

/** Production apply gate: never synthetic_confirmed; requires operator confirmation record. */
export function resolveExtendedContractVerificationForBaseline(input: {
  payload: ValidatedClientsPayload;
  clientsSourceSha256: string;
  confirmation: ExtendedContractConfirmation | null;
  storedConfirmationSha256: string | null;
}): "unverified" | "operator_confirmed" {
  if (!input.confirmation) {
    return "unverified";
  }
  const expected = extendedContractConfirmationSha256(input.confirmation);
  const expectedFingerprint = verificationFingerprintFromPayload({ payload: input.payload });
  if (
    input.confirmation.clientsSourceSha256.toLowerCase() !==
      input.clientsSourceSha256.toLowerCase() ||
    input.confirmation.verificationFingerprint.toLowerCase() !==
      expectedFingerprint.toLowerCase()
  ) {
    return "unverified";
  }
  const stored = input.storedConfirmationSha256?.toLowerCase() ?? null;
  if (stored && stored !== expected) {
    return "unverified";
  }
  return "operator_confirmed";
}
