import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_SOURCE_BYTES } from "../../src/onec-clients/constants";
import { validateExtendedClientsFileBytes } from "../../src/onec-clients/extended-validate";
import { NULL_UUID } from "../../src/onec-clients/uuid";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "../helpers/onec-clients-extended-fixtures";
import { buildLiveFormatClientsBytes, liveFormatOutlet } from "../helpers/onec-clients-live-fixtures";

describe("live 1C clients format validation", () => {
  it("accepts files larger than legacy 10 MiB but below 32 MiB limit", () => {
    const paddingSize = 11 * 1024 * 1024;
    const holding = sampleExtendedHolding();
    const bytes = buildExtendedClientsFileBytes([holding]);
    const padded = Buffer.concat([bytes, Buffer.alloc(paddingSize, 0x20)]);
    const result = validateExtendedClientsFileBytes(padded);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.payload.byteSize > 10 * 1024 * 1024);
    }
  });

  it("rejects files above 32 MiB on byte length check", () => {
    const tooLarge = Buffer.alloc(MAX_SOURCE_BYTES + 1, 0x7b);
    const result = validateExtendedClientsFileBytes(tooLarge);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.issues[0]?.code, "FILE_TOO_LARGE");
    }
  });

  it("accepts live loading_time and numeric bonus with diagnostics", () => {
    const result = validateExtendedClientsFileBytes(buildLiveFormatClientsBytes());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const outlet = result.payload.records[0]?.retailOutlets[0];
    assert.equal(outlet?.loading.loadingTime, "09:30");
    assert.equal(outlet?.loading.loadingTimeSourceRaw, "0001-01-01T09:30:00");
    assert.equal(outlet?.lpr.bonus, "12.5");
    assert.equal(outlet?.lpr.dateOfBirth, null);
    assert.equal(outlet?.lpr.dateOfBirthAmbiguous, true);
    assert.equal(result.payload.diagnostics.ambiguousDateOfBirthCount, 1);
    assert.ok(result.payload.warnings.some((w) => w.code === "LOAD_TIME_FORMAT_ADAPTED"));
    assert.ok(result.payload.warnings.some((w) => w.code === "AMBIGUOUS_DATE_OF_BIRTH"));
  });

  it("treats null UUID with empty name as unassigned on outlet managers", () => {
    const result = validateExtendedClientsFileBytes(
      buildLiveFormatClientsBytes({
        managers: {
          guid_regional_manager: NULL_UUID,
          name_regional_manager: "",
        },
      }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.payload.records[0]?.retailOutlets[0]?.managers.regionalManager.state,
      "unassigned",
    );
  });

  it("rejects null UUID with non-empty name as manager pair conflict", () => {
    const result = validateExtendedClientsFileBytes(
      buildLiveFormatClientsBytes({
        managers: {
          guid_regional_manager: NULL_UUID,
          name_regional_manager: "Should Not Guess",
        },
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.code === "INVALID_MANAGER_PAIR"));
    }
  });

  it("keeps client guid_manager strict non-zero UUID", () => {
    const result = validateExtendedClientsFileBytes(
      buildExtendedClientsFileBytes([
        sampleExtendedHolding({ guid_manager: NULL_UUID, name_manager: "Mgr" }),
      ]),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.field === "guid_manager"));
    }
  });

  it("distinguishes missing holding card from rejected holding card", () => {
    const holdingGuid = EXTENDED_FIXTURE_GUIDS.HOLDING_GUID;
    const childGuid = EXTENDED_FIXTURE_GUIDS.CHILD_GUID;
    const unknownBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ guid_client: holdingGuid, holding: true }),
      sampleExtendedChild({
        guid_client: childGuid,
        guid_holding: "99999999-9999-4999-8999-999999999999",
      }),
    ]);
    const unknown = validateExtendedClientsFileBytes(unknownBytes);
    assert.equal(unknown.ok, false);
    if (!unknown.ok) {
      assert.ok(unknown.issues.some((issue) => issue.code === "HOLDING_GUID_UNKNOWN"));
    }

    const rejectedBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({
        guid_client: holdingGuid,
        holding: true,
        name_client: "",
      }),
      sampleExtendedChild({ guid_client: childGuid, guid_holding: holdingGuid }),
    ]);
    const rejected = validateExtendedClientsFileBytes(rejectedBytes);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.ok(rejected.issues.some((issue) => issue.code === "HOLDING_GUID_REJECTED"));
      assert.ok(!rejected.issues.some((issue) => issue.code === "HOLDING_GUID_UNKNOWN"));
    }
  });

  it("accepts calendar date_of_birth with midnight timestamp", () => {
    const result = validateExtendedClientsFileBytes(
      buildLiveFormatClientsBytes({
        LPR_information: { date_of_birth: "1988-06-15T00:00:00", bonus: 5 },
      }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.records[0]?.retailOutlets[0]?.lpr.dateOfBirth, "1988-06-15");
    assert.ok(result.payload.warnings.some((w) => w.code === "DATE_OF_BIRTH_FORMAT_ADAPTED"));
  });

  it("dry-run validates without implying apply when holding links fail", () => {
    const result = validateExtendedClientsFileBytes(
      buildExtendedClientsFileBytes([
        sampleExtendedHolding({ holding: true }),
        sampleExtendedChild({
          guid_holding: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      ]),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issueCount >= 1);
      assert.ok(result.issues.length <= 50);
    }
  });
});
