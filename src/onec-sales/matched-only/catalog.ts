import type { PoolClient } from "pg";
import { sha256CanonicalJson } from "./canonical-json";

export async function loadKnownLegalGuidSet(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ guid_client: string }>(
    `SELECT lower(guid_client::text) AS guid_client FROM onec_v3_legal_entities`,
  );
  return new Set(result.rows.map((row) => row.guid_client));
}

export function computeCatalogFingerprint(knownGuids: Iterable<string>): string {
  const sorted = [...knownGuids].map((g) => g.toLowerCase()).sort();
  return sha256CanonicalJson({ v: 1, legalEntityGuids: sorted });
}

export function computeUnknownUnionDigest(unknownGuids: Iterable<string>): string {
  const sorted = [...unknownGuids].map((g) => g.toLowerCase()).sort();
  return sha256CanonicalJson({ v: 1, unknownLegalGuids: sorted });
}

export function isKnownGuid(known: Set<string>, legalGuid: string): boolean {
  return known.has(legalGuid.toLowerCase());
}
