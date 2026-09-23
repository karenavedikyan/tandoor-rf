import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_SOURCE_BYTES, MAX_SOURCE_RECORDS } from "../../src/onec-clients/constants";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import {
  buildClientsFileBytes,
  sampleClient,
  sampleClientTwo,
} from "../helpers/onec-clients-fixtures";

describe("onec clients validate", () => {
  it("accepts a valid file and UTF-8 BOM", () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      buildClientsFileBytes([sampleClient(), sampleClientTwo()]),
    ]);
    const result = validateClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.recordCount, 2);
      assert.equal(result.payload.byteSize, bytes.length);
    }
  });

  it("rejects empty array and invalid JSON", () => {
    assert.equal(validateClientsFileBytes(buildClientsFileBytes([])).ok, false);
    assert.equal(validateClientsFileBytes(Buffer.from("{", "utf8")).ok, false);
    assert.equal(validateClientsFileBytes(Buffer.from("{}", "utf8")).ok, false);
  });

  it("rejects invalid UTF-8", () => {
    const invalid = Buffer.from([0xff, 0xfe, 0xfd]);
    assert.equal(validateClientsFileBytes(invalid).ok, false);
  });

  it("rejects invalid UUIDs and duplicate IDs with different case", () => {
    const duplicateCase = validateClientsFileBytes(
      buildClientsFileBytes([
        sampleClient({ guid_client: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
        sampleClient({ guid_client: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", name_client: "Other" }),
      ]),
    );
    assert.equal(duplicateCase.ok, false);

    const nullUuid = validateClientsFileBytes(
      buildClientsFileBytes([
        sampleClient({ guid_client: "00000000-0000-0000-0000-000000000000" }),
      ]),
    );
    assert.equal(nullUuid.ok, false);
  });

  it("rejects holding contract violations", () => {
    const idWithoutName = validateClientsFileBytes(
      buildClientsFileBytes([
        sampleClient({
          guid_holding: "44444444-4444-4444-8444-444444444444",
          name_holding: "",
        }),
      ]),
    );
    assert.equal(idWithoutName.ok, false);
  });

  it("warns on extra fields, empty address, and empty telephones", () => {
    const result = validateClientsFileBytes(
      buildClientsFileBytes([
        sampleClient({
          address: "",
          telephone: [],
          extra_field: "ignored",
        }),
      ]),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.payload.warnings.some((warning) => warning.code === "EXTRA_FIELDS"));
      assert.ok(result.payload.warnings.some((warning) => warning.code === "EMPTY_ADDRESS"));
      assert.ok(result.payload.warnings.some((warning) => warning.code === "EMPTY_TELEPHONE"));
    }
  });

  it("allows same names with different IDs", () => {
    const result = validateClientsFileBytes(
      buildClientsFileBytes([
        sampleClient({ name_client: "Shared Name" }),
        sampleClientTwo({ name_client: "Shared Name" }),
      ]),
    );
    assert.equal(result.ok, true);
  });

  it("rejects oversize files and record limits", () => {
    const tooLarge = Buffer.alloc(MAX_SOURCE_BYTES + 1, 0x7b);
    assert.equal(validateClientsFileBytes(tooLarge).ok, false);

    const tooMany = buildClientsFileBytes(
      Array.from({ length: MAX_SOURCE_RECORDS + 1 }, (_, index) =>
        sampleClient({
          guid_client: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
          name_client: `Client ${index}`,
        }),
      ),
    );
    assert.equal(validateClientsFileBytes(tooMany).ok, false);
  });

  it("includes index and field in validation issues without record content", () => {
    const result = validateClientsFileBytes(
      buildClientsFileBytes([sampleClient({ name_client: "   " })]),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.issues[0]?.field, "name_client");
      assert.equal(result.issues[0]?.index, 0);
      assert.equal(JSON.stringify(result.issues).includes("Client Alpha"), false);
    }
  });
});
