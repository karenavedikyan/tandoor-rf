import { createHash } from "node:crypto";

export type ClientReviewFingerprintInput = {
  guidManager: string;
  nameClient: string;
  guidHolding: string | null;
  guidHoldingPending?: string | null;
  address: string;
  nameManager: string;
};

const FINGERPRINT_FIELD_SEPARATOR = "\x1e";

export function computeClientReviewFingerprint(input: ClientReviewFingerprintInput): string {
  const payload = [
    input.guidManager.trim().toLowerCase(),
    input.nameClient.trim(),
    (input.guidHolding ?? input.guidHoldingPending ?? "").trim().toLowerCase(),
    input.address.trim(),
    input.nameManager.trim(),
  ].join(FINGERPRINT_FIELD_SEPARATOR);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** SQL expression for the same fingerprint against onec_clients row alias `oc`. */
export const CLIENT_REVIEW_FINGERPRINT_SQL = `
  encode(
    digest(
      concat_ws(
        E'\\x1e',
        lower(oc.guid_manager::text),
        btrim(oc.name_client),
        lower(COALESCE(oc.guid_holding::text, oc.guid_holding_pending::text, '')),
        btrim(oc.address),
        btrim(oc.name_manager)
      ),
      'sha256'
    ),
    'hex'
  )
`;
