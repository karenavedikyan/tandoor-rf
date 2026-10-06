import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyExportBundleManifestBytes } from "../../src/onec-regular-update/export-manifest";
import { buildExportManifestBytes } from "../helpers/onec-export-manifest-fixtures";

describe("export bundle manifest", () => {
  it("accepts manifest when file hashes match the verified bundle", () => {
    const clientsSha = "a".repeat(64);
    const rosterSha = "b".repeat(64);
    const result = verifyExportBundleManifestBytes(
      buildExportManifestBytes({ clientsSha256: clientsSha, rosterSha256: rosterSha }),
      { clientsSha256: clientsSha, employeeRosterSha256: rosterSha },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.manifest.clientsSha256, clientsSha);
      assert.equal(result.manifest.employeeRosterSha256, rosterSha);
    }
  });

  it("rejects manifest when hashes do not match verified files", () => {
    const result = verifyExportBundleManifestBytes(
      buildExportManifestBytes({ clientsSha256: "c".repeat(64), rosterSha256: "d".repeat(64) }),
      { clientsSha256: "a".repeat(64), employeeRosterSha256: "b".repeat(64) },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "MANIFEST_HASH_MISMATCH");
    }
  });
});
