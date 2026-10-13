import type { PoolClient } from "pg";
import { upsertWholesaleEmployeeRoster } from "../onec-clients/roster-upsert";
import type { V3ValidatedBundle } from "./types";
import { bootstrapBitrixLabelsForV3Domain } from "./bitrix-bootstrap";

export async function deleteV3DomainOnClient(client: PoolClient): Promise<void> {
  await client.query(`DELETE FROM onec_v3_holding_composition`);
  await client.query(`DELETE FROM onec_v3_retail_outlets`);
  await client.query(`DELETE FROM onec_v3_legal_entities`);
  await client.query(`DELETE FROM onec_v3_holdings`);
}

export async function writeV3BundleToClient(
  client: PoolClient,
  bundle: V3ValidatedBundle,
): Promise<{ holdings: number; legalEntities: number; retailOutlets: number; employees: number }> {
  const sourceSha = bundle.fileSha256["all_clients.json"] ?? bundle.bundleFingerprint;

  for (const holding of bundle.holdings) {
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
          !bundle.legalEntities.some((l) => l.guidClient === member.guidRetail),
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
          !bundle.retailOutlets.some((o) => o.guidStore === member.guidRetail),
          member.zeroGuid,
        ],
      );
    }
  }

  for (const legal of bundle.legalEntities) {
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

  for (const outlet of bundle.retailOutlets) {
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

  await upsertWholesaleEmployeeRoster(client, bundle.employeeRoster);

  await bootstrapBitrixLabelsForV3Domain(client, null);

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
    [bundle.bundleFingerprint, JSON.stringify(bundle.fileSha256)],
  );

  await client.query(
    `
      INSERT INTO onec_v3_import_runs (
        mode, status, bundle_fingerprint, file_sha256, finished_at, counts, warnings
      ) VALUES ('apply', 'success', $1, $2::jsonb, NOW(), $3::jsonb, $4::jsonb)
    `,
    [
      bundle.bundleFingerprint,
      JSON.stringify(bundle.fileSha256),
      JSON.stringify({
        holdings: bundle.holdings.length,
        legalEntities: bundle.legalEntities.length,
        retailOutlets: bundle.retailOutlets.length,
        employees: bundle.employeeRoster.wholesaleCount,
      }),
      JSON.stringify(bundle.warnings),
    ],
  );

  return {
    holdings: bundle.holdings.length,
    legalEntities: bundle.legalEntities.length,
    retailOutlets: bundle.retailOutlets.length,
    employees: bundle.employeeRoster.wholesaleCount,
  };
}
