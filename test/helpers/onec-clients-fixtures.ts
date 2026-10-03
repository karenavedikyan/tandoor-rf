import { DEFAULT_HOLDING_LINK_VALIDATION_POLICY } from "../../src/onec-clients/holding-link-policy";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { computeImportVerificationFingerprint } from "../../src/onec-clients/import-verification-fingerprint";
import { sha256Hex } from "../../src/onec-clients/sha256";
import type { HoldingLinkValidationPolicy } from "../../src/onec-clients/holding-link-policy";

export function sampleClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    guid_client: "11111111-1111-4111-8111-111111111111",
    name_client: "Client Alpha",
    guid_holding: "",
    name_holding: "",
    guid_manager: "22222222-2222-4222-8222-222222222222",
    name_manager: "Manager One",
    address: "Address 1",
    telephone: ["+79990001122"],
    ...overrides,
  };
}

export function sampleClientTwo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    guid_client: "33333333-3333-4333-8333-333333333333",
    name_client: "Client Beta",
    guid_holding: "44444444-4444-4444-8444-444444444444",
    name_holding: "Holding East",
    guid_manager: "55555555-5555-4555-8555-555555555555",
    name_manager: "Manager Two",
    address: "",
    telephone: [],
    ...overrides,
  };
}

export function buildClientsFileBytes(clients: Record<string, unknown>[]): Buffer {
  return Buffer.from(JSON.stringify(clients), "utf8");
}

export function buildClientsFileSha256(clients: Record<string, unknown>[]): string {
  return sha256Hex(buildClientsFileBytes(clients));
}

export function buildImportVerificationFingerprint(
  clients: Record<string, unknown>[],
  options?: {
    holdingLinkValidationPolicy?: HoldingLinkValidationPolicy;
    employeeRosterBytes?: Buffer;
    wholesaleCompositionPrep?: boolean;
  },
): string {
  let employeeRosterSourceSha256: string | null = null;
  if (options?.employeeRosterBytes) {
    const parsed = parseWholesaleEmployeeRosterBytes(options.employeeRosterBytes);
    if (parsed.ok) {
      employeeRosterSourceSha256 = parsed.roster.sourceSha256;
    }
  }
  return computeImportVerificationFingerprint({
    clientsSha256: buildClientsFileSha256(clients),
    holdingLinkValidationPolicy:
      options?.holdingLinkValidationPolicy ?? DEFAULT_HOLDING_LINK_VALIDATION_POLICY,
    employeeRosterSourceSha256,
    wholesaleCompositionMode: options?.wholesaleCompositionPrep ? "replacement_prep" : "standard",
  });
}
