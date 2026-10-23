import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { EXPECTED_CATALOG_GUID_SET_SHA256, EXPECTED_CATALOG_LEGAL_ENTITY_COUNT } from "./scope-pins";

/** Operator pin: SHA256(JSON.stringify(sorted lower(guid_client))). */
export function catalogGuidSetSha256FromRows(guids: string[]): string {
  const sorted = guids.map((g) => g.toLowerCase()).sort();
  return createHash("sha256").update(JSON.stringify(sorted), "utf8").digest("hex");
}

export async function verifyCatalogPin(client: PoolClient): Promise<
  | { ok: true; count: number; sha256: string }
  | { ok: false; code: string; message: string }
> {
  const rows = await client.query<{ guid_client: string }>(
    `SELECT lower(guid_client::text) AS guid_client FROM onec_v3_legal_entities ORDER BY guid_client`,
  );
  const guids = rows.rows.map((r) => r.guid_client);
  if (guids.length !== EXPECTED_CATALOG_LEGAL_ENTITY_COUNT) {
    return {
      ok: false,
      code: "CATALOG_COUNT_MISMATCH",
      message: `Expected ${EXPECTED_CATALOG_LEGAL_ENTITY_COUNT} legal entities, found ${guids.length}.`,
    };
  }
  const sha256 = catalogGuidSetSha256FromRows(guids);
  if (sha256 !== EXPECTED_CATALOG_GUID_SET_SHA256) {
    return {
      ok: false,
      code: "CATALOG_SHA_MISMATCH",
      message: "Catalog GUID set SHA256 does not match frozen operator pin.",
    };
  }
  return { ok: true, count: guids.length, sha256 };
}
