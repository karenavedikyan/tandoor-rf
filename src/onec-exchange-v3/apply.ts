import type { PoolClient } from "pg";
import { tryAcquireImportLock, releaseImportLock } from "../onec-clients/import-lock";
import { requirePool } from "../db/pool";
import type { V3ImportMode, V3ValidatedBundle } from "./types";
import { deleteV3DomainOnClient, writeV3BundleToClient } from "./apply-internals";

export type ApplyExchangeV3Options = {
  expectedFingerprint?: string;
  skipDomainDelete?: boolean;
  markCleanStart?: boolean;
  cleanStartBundleFingerprint?: string;
};

export async function applyExchangeV3BundleOnClient(
  client: PoolClient,
  bundle: V3ValidatedBundle,
  options: ApplyExchangeV3Options = {},
): Promise<
  | { ok: true; unchanged: boolean; counts: { holdings: number; legalEntities: number; retailOutlets: number; employees: number } }
  | { ok: false; errorCode: string; message: string }
> {
  if (options.expectedFingerprint && options.expectedFingerprint !== bundle.bundleFingerprint) {
    return { ok: false, errorCode: "FINGERPRINT_MISMATCH", message: "Fingerprint комплекта не совпадает" };
  }

  const state = await client.query<{
    last_bundle_fingerprint: string | null;
    legacy_clean_start_completed_at: string | null;
  }>(
    `SELECT last_bundle_fingerprint, legacy_clean_start_completed_at FROM onec_v3_exchange_state WHERE id = 1 FOR UPDATE`,
  );
  const previous = state.rows[0]?.last_bundle_fingerprint ?? null;
  if (previous === bundle.bundleFingerprint && !options.markCleanStart) {
    return {
      ok: true,
      unchanged: true,
      counts: {
        holdings: bundle.holdings.length,
        legalEntities: bundle.legalEntities.length,
        retailOutlets: bundle.retailOutlets.length,
        employees: bundle.employeeRoster.wholesaleCount,
      },
    };
  }

  if (!options.skipDomainDelete) {
    await deleteV3DomainOnClient(client);
  }
  const counts = await writeV3BundleToClient(client, bundle);

  if (options.markCleanStart) {
    await client.query(
      `
        UPDATE onec_v3_exchange_state
        SET legacy_clean_start_completed_at = NOW(),
            legacy_clean_start_bundle_fingerprint = $1
        WHERE id = 1
      `,
      [options.cleanStartBundleFingerprint ?? bundle.bundleFingerprint],
    );
  }

  return { ok: true, unchanged: false, counts };
}

export async function applyExchangeV3Bundle(input: {
  bundle: V3ValidatedBundle;
  mode: V3ImportMode;
  expectedFingerprint?: string;
}): Promise<
  | { ok: true; unchanged?: boolean; counts: { holdings: number; legalEntities: number; retailOutlets: number; employees: number } }
  | { ok: false; errorCode: string; message: string }
> {
  if (input.mode === "dry_run") {
    return {
      ok: true,
      counts: {
        holdings: input.bundle.holdings.length,
        legalEntities: input.bundle.legalEntities.length,
        retailOutlets: input.bundle.retailOutlets.length,
        employees: input.bundle.employeeRoster.wholesaleCount,
      },
    };
  }

  const pool = requirePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await tryAcquireImportLock(client);
    if (!locked) {
      await client.query("ROLLBACK");
      return { ok: false, errorCode: "IMPORT_LOCKED", message: "Импорт уже выполняется" };
    }
    try {
      const applied = await applyExchangeV3BundleOnClient(client, input.bundle, {
        expectedFingerprint: input.expectedFingerprint,
      });
      if (!applied.ok) {
        await client.query("ROLLBACK");
        return applied;
      }
      if (applied.unchanged) {
        await client.query("ROLLBACK");
        return { ok: true, unchanged: true, counts: applied.counts };
      }
      await client.query("COMMIT");
      return { ok: true, counts: applied.counts };
    } finally {
      await releaseImportLock(client);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    return {
      ok: false,
      errorCode: "APPLY_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    client.release();
  }
}
