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
