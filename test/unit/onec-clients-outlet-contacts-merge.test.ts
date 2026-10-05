import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExtendedSnapshotJson } from "../../src/onec-clients/extended-apply";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import {
  buildExtendedClientsFileBytes,
  sampleExtendedHolding,
  validateClientsForApplyTest,
} from "../helpers/onec-clients-extended-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { EXTENDED_FIXTURE_GUIDS } from "../helpers/onec-clients-extended-fixtures";

describe("extended outlet contacts partial update", () => {
  it("preserves accountant email when field is absent in partial export", () => {
    const validatedA = validateClientsForApplyTest(buildExtendedClientsFileBytes([sampleExtendedHolding()]));
    assert.equal(validatedA.ok, true);
    if (!validatedA.ok) return;

    const recordA = validatedA.payload.extendedRecords![0]!;
    const snapshotA = buildExtendedSnapshotJson(
      recordA,
      null,
      validatedA.payload.sourceSha256,
      "2026-01-01T10:00:00.000Z",
      { contractVerified: true },
    );
    assert.equal(snapshotA.currentRetailOutlets[0]?.contacts.accountantEmail, "acc@example.test");

    const holdingCopy = JSON.parse(JSON.stringify(sampleExtendedHolding())) as Record<string, unknown>;
    const outlets = holdingCopy.retail_outlets as Array<Record<string, unknown>>;
    const contactInfo = outlets[0]!.contact_information as Record<string, unknown>;
    delete contactInfo.accountant_email;

    const validatedB = validateClientsForApplyTest(buildExtendedClientsFileBytes([holdingCopy]));
    assert.equal(validatedB.ok, true);
    if (!validatedB.ok) return;

    const snapshotB = buildExtendedSnapshotJson(
      validatedB.payload.extendedRecords![0]!,
      snapshotA,
      validatedB.payload.sourceSha256,
      "2026-01-02T10:00:00.000Z",
      { contractVerified: true },
    );
    assert.equal(snapshotB.currentRetailOutlets[0]?.contacts.accountantEmail, "acc@example.test");
  });

  it("clears accountant email when field is explicitly empty in export", () => {
    const validatedA = validateClientsForApplyTest(buildExtendedClientsFileBytes([sampleExtendedHolding()]));
    assert.equal(validatedA.ok, true);
    if (!validatedA.ok) return;
    const snapshotA = buildExtendedSnapshotJson(
      validatedA.payload.extendedRecords![0]!,
      null,
      validatedA.payload.sourceSha256,
      "2026-01-01T10:00:00.000Z",
      { contractVerified: true },
    );

    const holdingCopy = JSON.parse(JSON.stringify(sampleExtendedHolding())) as Record<string, unknown>;
    const outlets = holdingCopy.retail_outlets as Array<Record<string, unknown>>;
    (outlets[0]!.contact_information as Record<string, unknown>).accountant_email = "";

    const validatedB = validateClientsForApplyTest(buildExtendedClientsFileBytes([holdingCopy]));
    assert.equal(validatedB.ok, true);
    if (!validatedB.ok) return;

    const snapshotB = buildExtendedSnapshotJson(
      validatedB.payload.extendedRecords![0]!,
      snapshotA,
      validatedB.payload.sourceSha256,
      "2026-01-02T10:00:00.000Z",
      { contractVerified: true },
    );
    assert.equal(snapshotB.currentRetailOutlets[0]?.contacts.accountantEmail, "");
  });
});

describe("extended outlet nested partial update", () => {
  function buildSnapshotChain(holdingOverrides?: Record<string, unknown>) {
    const validatedA = validateClientsForApplyTest(buildExtendedClientsFileBytes([sampleExtendedHolding(holdingOverrides)]));
    assert.equal(validatedA.ok, true);
    if (!validatedA.ok) return null;
    const snapshotA = buildExtendedSnapshotJson(
      validatedA.payload.extendedRecords![0]!,
      null,
      validatedA.payload.sourceSha256,
      "2026-01-01T10:00:00.000Z",
      { contractVerified: true },
    );
    return { validatedA, snapshotA };
  }

  it("preserves store address, regional manager and club status when absent in partial export", () => {
    const chain = buildSnapshotChain();
    assert.ok(chain);
    if (!chain) return;
    const outletA = chain.snapshotA.currentRetailOutlets[0]!;
    assert.equal(outletA.address.storeAddress, "Store 1 street");
    assert.equal(outletA.managers.regionalManager.guid, EXTENDED_FIXTURE_GUIDS.REGIONAL);
    assert.equal(outletA.additional.statusTandoorClub, "active");

    const holdingCopy = JSON.parse(JSON.stringify(sampleExtendedHolding())) as Record<string, unknown>;
    const outlets = holdingCopy.retail_outlets as Array<Record<string, unknown>>;
    delete (outlets[0]!.address as Record<string, unknown>).store_address;
    delete (outlets[0]!.managers as Record<string, unknown>).guid_regional_manager;
    delete (outlets[0]!.managers as Record<string, unknown>).name_regional_manager;
    delete (outlets[0]!.additional_information as Record<string, unknown>).status_tandoor_club;

    const validatedB = validateClientsForApplyTest(buildExtendedClientsFileBytes([holdingCopy]));
    assert.equal(validatedB.ok, true);
    if (!validatedB.ok) return;

    const snapshotB = buildExtendedSnapshotJson(
      validatedB.payload.extendedRecords![0]!,
      chain.snapshotA,
      validatedB.payload.sourceSha256,
      "2026-01-02T10:00:00.000Z",
      { contractVerified: true },
    );
    const outletB = snapshotB.currentRetailOutlets[0]!;
    assert.equal(outletB.address.storeAddress, "Store 1 street");
    assert.equal(outletB.managers.regionalManager.guid, EXTENDED_FIXTURE_GUIDS.REGIONAL);
    assert.equal(outletB.additional.statusTandoorClub, "active");
  });

  it("clears club status on explicit empty and preserves other fields on third export", () => {
    const chain = buildSnapshotChain();
    assert.ok(chain);
    if (!chain) return;

    const holdingEmptyClub = JSON.parse(JSON.stringify(sampleExtendedHolding())) as Record<string, unknown>;
    const outletsB = holdingEmptyClub.retail_outlets as Array<Record<string, unknown>>;
    (outletsB[0]!.additional_information as Record<string, unknown>).status_tandoor_club = "";

    const validatedB = validateClientsForApplyTest(buildExtendedClientsFileBytes([holdingEmptyClub]));
    assert.equal(validatedB.ok, true);
    if (!validatedB.ok) return;
    const snapshotB = buildExtendedSnapshotJson(
      validatedB.payload.extendedRecords![0]!,
      chain.snapshotA,
      validatedB.payload.sourceSha256,
      "2026-01-02T10:00:00.000Z",
      { contractVerified: true },
    );
    assert.equal(snapshotB.currentRetailOutlets[0]?.additional.statusTandoorClub, "");

    const holdingPartialC = JSON.parse(JSON.stringify(sampleExtendedHolding())) as Record<string, unknown>;
    const outletsC = holdingPartialC.retail_outlets as Array<Record<string, unknown>>;
    delete (outletsC[0]!.additional_information as Record<string, unknown>).status_tandoor_club;

    const validatedC = validateClientsForApplyTest(buildExtendedClientsFileBytes([holdingPartialC]));
    assert.equal(validatedC.ok, true);
    if (!validatedC.ok) return;
    const snapshotC = buildExtendedSnapshotJson(
      validatedC.payload.extendedRecords![0]!,
      snapshotB,
      validatedC.payload.sourceSha256,
      "2026-01-03T10:00:00.000Z",
      { contractVerified: true },
    );
    assert.equal(snapshotC.currentRetailOutlets[0]?.additional.statusTandoorClub, "");
    assert.equal(snapshotC.currentRetailOutlets[0]?.address.storeAddress, "Store 1 street");
  });
});

describe("employee roster calendar dates", () => {
  it("normalizes DD.MM.YYYY to UTC-noon timestamptz for SQL storage", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.MANAGER_A, {
          date_of_assumption: "05.10.2026",
        }),
      ]),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.roster.records[0]?.dateOfAssumption, "2026-10-05T12:00:00.000Z");
  });
});
