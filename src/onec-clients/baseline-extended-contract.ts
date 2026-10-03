import type { PoolClient } from "pg";
import {
  buildExtendedContractConfirmation,
  extendedContractConfirmationSha256,
  resolveExtendedContractVerificationForBaseline,
} from "./extended-contract-gate";
import type { ValidatedClientsPayload } from "./types";

export async function loadStoredExtendedContractConfirmationSha256(
  client: PoolClient,
  clientsSourceSha256: string,
): Promise<string | null> {
  try {
    const row = await client.query<{ verification_fingerprint: string; operator_reference: string }>(
      `
        SELECT verification_fingerprint, operator_reference
        FROM onec_extended_contract_confirmations
        WHERE clients_source_sha256 = $1 AND superseded_at IS NULL
        ORDER BY confirmed_at DESC
        LIMIT 1
      `,
      [clientsSourceSha256],
    );
    const stored = row.rows[0];
    if (!stored) {
      return null;
    }
    return extendedContractConfirmationSha256({
      clientsSourceSha256: clientsSourceSha256.toLowerCase(),
      verificationFingerprint: stored.verification_fingerprint,
      operatorReference: stored.operator_reference,
    });
  } catch {
    return null;
  }
}

export async function resolveBaselineExtendedContractVerified(input: {
  client: PoolClient;
  payload: ValidatedClientsPayload;
  clientsSourceSha256: string;
}): Promise<boolean> {
  const storedSha = await loadStoredExtendedContractConfirmationSha256(
    input.client,
    input.clientsSourceSha256,
  );
  if (!storedSha) {
    return false;
  }
  const row = await input.client.query<{ operator_reference: string }>(
    `
      SELECT operator_reference
      FROM onec_extended_contract_confirmations
      WHERE clients_source_sha256 = $1 AND superseded_at IS NULL
      ORDER BY confirmed_at DESC
      LIMIT 1
    `,
    [input.clientsSourceSha256],
  );
  const operatorReference = row.rows[0]?.operator_reference;
  if (!operatorReference) {
    return false;
  }
  const confirmation = buildExtendedContractConfirmation({
    clientsSourceSha256: input.clientsSourceSha256,
    payload: input.payload,
    operatorReference,
  });
  return (
    resolveExtendedContractVerificationForBaseline({
      payload: input.payload,
      clientsSourceSha256: input.clientsSourceSha256,
      confirmation,
      storedConfirmationSha256: storedSha,
    }) === "operator_confirmed"
  );
}
