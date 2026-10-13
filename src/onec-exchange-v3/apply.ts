import type { PoolClient } from "pg";
import { upsertWholesaleEmployeeRoster } from "../onec-clients/roster-upsert";
import { tryAcquireImportLock, releaseImportLock } from "../onec-clients/import-lock";
import { requirePool } from "../db/pool";
import type { V3ImportMode, V3ValidatedBundle } from "./types";

async function deleteV3Domain(client: PoolClient): Promise<void> {
  await client.query(`DELETE FROM onec_v3_holding_composition`);
  await client.query(`DELETE FROM onec_v3_retail_outlets`);
  await client.query(`DELETE FROM onec_v3_legal_entities`);
  await client.query(`DELETE FROM onec_v3_holdings`);
}

export async function applyExchangeV3Bundle(input: {
  bundle: V3ValidatedBundle;
  mode: V3ImportMode;
  expectedFingerprint?: string;
}): Promise<
  | { ok: true; counts: { holdings: number; legalEntities: number; retailOutlets: number; employees: number } }
  | { ok: false; errorCode: string; message: string }
> {
  if (input.expectedFingerprint && input.expectedFingerprint !== input.bundle.bundleFingerprint) {
    return { ok: false, errorCode: "FINGERPRINT_MISMATCH", message: "Fingerprint комплекта не совпадает" };
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
      const state = await client.query<{ last_bundle_fingerprint: string | null }>(
        `SELECT last_bundle_fingerprint FROM onec_v3_exchange_state WHERE id = 1 FOR UPDATE`,
      );
      const previous = state.rows[0]?.last_bundle_fingerprint ?? null;
      if (previous === input.bundle.bundleFingerprint && input.mode === "apply") {
        await client.query("ROLLBACK");
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

      if (input.mode === "dry_run") {
        await client.query("ROLLBACK");
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

      await deleteV3Domain(client);
      const sourceSha = input.bundle.fileSha256["all_clients.json"] ?? input.bundle.bundleFingerprint;

      for (const holding of input.bundle.holdings) {
        await client.query(
          `
            INSERT INTO onec_v3_holdings (
              guid_holding, name_holding, type_category, retail_chain, holding_group,
              managers, last_source_sha256, last_imported_at
            ) VALUES ($1::uuid, $2, $3::jsonb, $4, $5, $6::jsonb, $7, NOW())
          `,
          [
            holding.guidHolding,
            holding.nameHolding,
            JSON.stringify(holding.typeCategory),
            holding.retailChain,
            holding.holdingGroup,
            JSON.stringify(holding.managers),
            sourceSha,
          ],
        );
        for (const member of holding.legalEntities) {
          await client.query(
            `
              INSERT INTO onec_v3_holding_composition (
                guid_holding, member_kind, member_guid, name_retail, ref_missing, zero_guid
              ) VALUES ($1::uuid, 'legal', $2::uuid, $3, $4, $5)
              ON CONFLICT DO NOTHING
            `,
            [
              holding.guidHolding,
              member.guidRetail,
              member.nameRetail,
              !input.bundle.legalEntities.some((l) => l.guidClient === member.guidRetail),
              member.zeroGuid,
            ],
          );
        }
        for (const member of holding.retailOutlets) {
          await client.query(
            `
              INSERT INTO onec_v3_holding_composition (
                guid_holding, member_kind, member_guid, name_retail, ref_missing, zero_guid
              ) VALUES ($1::uuid, 'retail', $2::uuid, $3, $4, $5)
              ON CONFLICT DO NOTHING
            `,
            [
              holding.guidHolding,
              member.guidRetail,
              member.nameRetail,
              !input.bundle.retailOutlets.some((o) => o.guidStore === member.guidRetail),
              member.zeroGuid,
            ],
          );
        }
      }

      for (const legal of input.bundle.legalEntities) {
        await client.query(
          `
            INSERT INTO onec_v3_legal_entities (
              guid_client, name_client, guid_holding, name_holding, type_category, managers,
              address, telephone, discount, discount_amount, markups, other_fields,
              membership_conflict, diagnostics, last_source_sha256, last_imported_at
            ) VALUES (
              $1::uuid, $2, $3::uuid, $4, $5::jsonb, $6::jsonb,
              $7, $8::jsonb, $9, $10, $11::jsonb, $12::jsonb,
              $13, '[]'::jsonb, $14, NOW()
            )
          `,
          [
            legal.guidClient,
            legal.nameClient,
            legal.guidHolding,
            legal.nameHolding,
            JSON.stringify(legal.typeCategory),
            JSON.stringify(legal.managers),
            legal.address,
            JSON.stringify(legal.telephone),
            legal.discount,
            legal.discountAmount,
            JSON.stringify(legal.markups),
            JSON.stringify(legal.otherFields),
            legal.membershipConflict,
            sourceSha,
          ],
        );
      }

      for (const outlet of input.bundle.retailOutlets) {
        await client.query(
          `
            INSERT INTO onec_v3_retail_outlets (
              guid_store, guid_holding, warehouse, closed, type_category,
              address, information_loading, managers, contact_information,
              lpr_information, additional_information, membership_conflict,
              diagnostics, last_source_sha256, last_imported_at
            ) VALUES (
              $1::uuid, $2::uuid, $3, $4, $5::jsonb,
              $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb,
              $10::jsonb, $11::jsonb, $12,
              '[]'::jsonb, $13, NOW()
            )
          `,
          [
            outlet.guidStore,
            outlet.guidHolding,
            outlet.warehouse,
            outlet.closed,
            JSON.stringify(outlet.typeCategory),
            JSON.stringify(outlet.address),
            JSON.stringify(outlet.informationLoading),
            JSON.stringify(outlet.managers),
            JSON.stringify(outlet.contactInformation),
            JSON.stringify(outlet.lprInformation),
            JSON.stringify(outlet.additionalInformation),
            outlet.membershipConflict,
            sourceSha,
          ],
        );
      }

      await upsertWholesaleEmployeeRoster(client, input.bundle.employeeRoster);

      await client.query(
        `
          UPDATE onec_v3_exchange_state
          SET last_bundle_fingerprint = $1,
              file_sha256 = $2::jsonb,
              last_successful_apply_at = NOW(),
              last_attempt_at = NOW(),
              apply_blocked = FALSE,
              apply_blocked_reason = NULL,
              updated_at = NOW()
          WHERE id = 1
        `,
        [input.bundle.bundleFingerprint, JSON.stringify(input.bundle.fileSha256)],
      );

      await client.query(
        `
          INSERT INTO onec_v3_import_runs (
            mode, status, bundle_fingerprint, file_sha256, finished_at, counts, warnings
          ) VALUES ('apply', 'success', $1, $2::jsonb, NOW(), $3::jsonb, $4::jsonb)
        `,
        [
          input.bundle.bundleFingerprint,
          JSON.stringify(input.bundle.fileSha256),
          JSON.stringify({
            holdings: input.bundle.holdings.length,
            legalEntities: input.bundle.legalEntities.length,
            retailOutlets: input.bundle.retailOutlets.length,
            employees: input.bundle.employeeRoster.wholesaleCount,
          }),
          JSON.stringify(input.bundle.warnings),
        ],
      );

      await client.query("COMMIT");
      return {
        ok: true,
        counts: {
          holdings: input.bundle.holdings.length,
          legalEntities: input.bundle.legalEntities.length,
          retailOutlets: input.bundle.retailOutlets.length,
          employees: input.bundle.employeeRoster.wholesaleCount,
        },
      };
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
