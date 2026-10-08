import type { PoolClient } from "pg";
import type { WholesaleEmployeeRoster } from "../onec-clients/employee-roster";
import type { HoldingLinkValidationPolicy } from "../onec-clients/holding-link-policy";
import {
  verificationFingerprintFromPayload,
  verifyApplyVerification,
} from "../onec-clients/import-verification-fingerprint";
import { rosterIncomingDiffersFromStored } from "../onec-clients/roster-field-values";
import { loadExistingRoster } from "../onec-clients/roster-upsert";
import type { ValidatedClientsPayload } from "../onec-clients/types";
import { clientContractExchangeIncomingDiffersFromStored } from "../onec-clients/client-contract-persisted-diff";
import { counterpartyExchangeIncomingDiffersFromStored } from "../onec-clients/counterparty-persisted-diff";
import { wholesaleExchangeIncomingDiffersFromStored } from "../onec-clients/wholesale-exchange-persisted-diff";
import { detectAmbiguousRosterShrink } from "./roster-shrink-guard";

export type RegularUpdateApplyGateResult =
  | { ok: true; unchangedBundle: true }
  | { ok: true; unchangedBundle: false }
  | {
      ok: false;
      code:
        | "VERIFICATION_FINGERPRINT_REQUIRED"
        | "VERIFICATION_FINGERPRINT_MISMATCH"
        | "VERIFICATION_PARAMETERS_MISMATCH"
        | "ROSTER_SHRINK_AMBIGUOUS";
      message: string;
      actualFingerprint?: string;
      affectedManagerGuids?: string[];
    };

async function loadLastCommittedVerificationFingerprint(client: PoolClient): Promise<string | null> {
  const row = await client.query<{ verification_fingerprint: string | null }>(
    `
      SELECT verification_fingerprint
      FROM onec_client_import_runs
      WHERE status = 'success'
        AND mode = 'apply'
        AND verification_fingerprint IS NOT NULL
      ORDER BY finished_at DESC NULLS LAST, id DESC
      LIMIT 1
    `,
  );
  return row.rows[0]?.verification_fingerprint?.toLowerCase() ?? null;
}

/** Authoritative regular-update checks under the import advisory lock, before any writes. */
export async function runRegularUpdateApplyGate(
  client: PoolClient,
  input: {
    payload: ValidatedClientsPayload;
    roster: WholesaleEmployeeRoster;
    expectedVerificationFingerprint: string;
    holdingLinkValidationPolicy?: HoldingLinkValidationPolicy;
    employeeRosterSourceSha256?: string | null;
  },
): Promise<RegularUpdateApplyGateResult> {
  const verificationFailure = verifyApplyVerification({
    expectedVerificationFingerprint: input.expectedVerificationFingerprint,
    payload: input.payload,
    holdingLinkValidationPolicy: input.holdingLinkValidationPolicy,
    employeeRosterSourceSha256: input.employeeRosterSourceSha256,
  });
  if (verificationFailure) {
    return {
      ok: false,
      code: verificationFailure.code,
      message: verificationFailure.message,
      actualFingerprint:
        verificationFailure.code === "VERIFICATION_FINGERPRINT_MISMATCH"
          ? verificationFailure.actualFingerprint
          : undefined,
    };
  }

  const actualFingerprint = verificationFingerprintFromPayload({ payload: input.payload }).toLowerCase();
  const lastFingerprint = await loadLastCommittedVerificationFingerprint(client);
  if (lastFingerprint && lastFingerprint === actualFingerprint) {
    const existingRoster = await loadExistingRoster(client);
    const rosterUnchanged = !rosterIncomingDiffersFromStored(existingRoster, input.roster);
    const wholesaleUnchanged = !(await wholesaleExchangeIncomingDiffersFromStored(client, input.payload));
    const counterpartyUnchanged = !(await counterpartyExchangeIncomingDiffersFromStored(client, input.payload));
    const clientContractUnchanged = !(await clientContractExchangeIncomingDiffersFromStored(client, input.payload));
    if (rosterUnchanged && wholesaleUnchanged && counterpartyUnchanged && clientContractUnchanged) {
      return { ok: true, unchangedBundle: true };
    }
  }

  const shrinkGuard = await detectAmbiguousRosterShrink(client, {
    roster: input.roster,
  });
  if (!shrinkGuard.ok) {
    return {
      ok: false,
      code: shrinkGuard.code,
      message: shrinkGuard.message,
      affectedManagerGuids: shrinkGuard.removedGuids,
    };
  }

  return { ok: true, unchangedBundle: false };
}
