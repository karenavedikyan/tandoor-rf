import type { PoolClient } from "pg";
import type { ExpectedCleanReloadOutlet } from "./outlet-validation";

type OutletRegistryMismatch = {
  guid_store: string;
  field: "guid_client" | "closed";
  expected: string | boolean;
  actual: string | boolean | null;
};

export type OutletRegistryVerificationResult =
  | { ok: true; outletGuidsLoaded: readonly string[] }
  | {
      ok: false;
      code: "OUTLET_REGISTRY_MISMATCH";
      message: string;
      details: {
        missingGuids?: string[];
        extraGuids?: string[];
        mismatches?: OutletRegistryMismatch[];
      };
    };

export async function verifyCleanReloadOutletRegistry(
  client: PoolClient,
  expected: readonly ExpectedCleanReloadOutlet[],
): Promise<OutletRegistryVerificationResult> {
  const result = await client.query<{
    guid_store: string;
    guid_client: string;
    is_closed: boolean;
  }>(
    `
      SELECT guid_store::text, guid_client::text, is_closed
      FROM onec_retail_outlets
    `,
  );

  const actualByGuid = new Map(
    result.rows.map((row) => [row.guid_store.toLowerCase(), row]),
  );
  const expectedByGuid = new Map(
    expected.map((row) => [row.guid_store.toLowerCase(), row]),
  );

  const missingGuids: string[] = [];
  const mismatches: OutletRegistryMismatch[] = [];

  for (const outlet of expected) {
    const key = outlet.guid_store.toLowerCase();
    const actual = actualByGuid.get(key);
    if (!actual) {
      missingGuids.push(outlet.guid_store);
      continue;
    }
    if (actual.guid_client.toLowerCase() !== outlet.guid_client.toLowerCase()) {
      mismatches.push({
        guid_store: outlet.guid_store,
        field: "guid_client",
        expected: outlet.guid_client,
        actual: actual.guid_client,
      });
    }
    if (actual.is_closed !== outlet.closed) {
      mismatches.push({
        guid_store: outlet.guid_store,
        field: "closed",
        expected: outlet.closed,
        actual: actual.is_closed,
      });
    }
  }

  const extraGuids = [...actualByGuid.keys()]
    .filter((guid) => !expectedByGuid.has(guid))
    .map((guid) => actualByGuid.get(guid)!.guid_store);

  if (missingGuids.length > 0 || extraGuids.length > 0 || mismatches.length > 0) {
    return {
      ok: false,
      code: "OUTLET_REGISTRY_MISMATCH",
      message: "Retail outlet registry does not match the expected bundle composition.",
      details: {
        ...(missingGuids.length > 0 ? { missingGuids } : {}),
        ...(extraGuids.length > 0 ? { extraGuids } : {}),
        ...(mismatches.length > 0 ? { mismatches } : {}),
      },
    };
  }

  return {
    ok: true,
    outletGuidsLoaded: expected.map((outlet) => outlet.guid_store).sort(),
  };
}
