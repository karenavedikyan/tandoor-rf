import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_SOURCE_BYTES } from "../../src/onec-clients/constants";
import { readBoundedBundleFile } from "../../src/onec-clean-reload/read-bounded-file";
import { validateCleanReloadOutletIdentityBytes } from "../../src/onec-clean-reload/outlet-validation";
import { validateCleanReloadRosterSqlFields } from "../../src/onec-clean-reload/roster-validation";
import { buildCleanReloadBundleClientsBytes } from "../helpers/onec-clean-reload-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { EXTENDED_FIXTURE_GUIDS } from "../helpers/onec-clients-extended-fixtures";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("onec clean reload boundary validation", () => {
  it("rejects outlets without guid_store or closed", () => {
    const bytes = Buffer.from(
      JSON.stringify([
        {
          guid_client: EXTENDED_FIXTURE_GUIDS.HOLDING_GUID,
          retail_outlets: [{ guid_store: EXTENDED_FIXTURE_GUIDS.STORE_ONE, closed: false }],
        },
        {
          guid_client: EXTENDED_FIXTURE_GUIDS.CHILD_GUID,
          retail_outlets: [{ holding: "Holding Alpha", warehouse: false, address: { store_address: "Anonymous" } }],
        },
      ]),
      "utf8",
    );
    const result = validateCleanReloadOutletIdentityBytes(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "OUTLET_IDENTITY_REQUIRED");
      assert.ok(result.issues.some((issue) => issue.field === "guid_store"));
      assert.ok(result.issues.some((issue) => issue.field === "closed"));
    }
  });

  it("accepts identified outlets with open and closed flags", () => {
    const bytes = buildCleanReloadBundleClientsBytes();
    const result = validateCleanReloadOutletIdentityBytes(bytes);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.outletGuids.sort(), [
        EXTENDED_FIXTURE_GUIDS.STORE_ONE,
        EXTENDED_FIXTURE_GUIDS.STORE_TWO,
      ].sort());
    }
  });

  it("rejects roster date_of_assumption that cannot be cast to timestamptz", () => {
    const bytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.MANAGER_A, {
        date_of_assumption: "not-a-date",
      }),
    ]);
    const result = validateCleanReloadRosterSqlFields(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "ROSTER_FIELD_INVALID");
      assert.equal(result.issues[0]?.field, "date_of_assumption");
      assert.equal(result.issues[0]?.recordIndex, 0);
    }
  });

  it("rejects invalid guid_post without silent null coercion", () => {
    const bytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.MANAGER_A, {
        guid_post: "not-a-uuid",
      }),
    ]);
    const result = validateCleanReloadRosterSqlFields(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.issues[0]?.field, "guid_post");
      assert.equal(result.issues[0]?.code, "INVALID_UUID");
    }
  });

  it("reads bundle files with a byte ceiling", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "clean-reload-read-"));
    try {
      const filePath = path.join(dir, "all_clients.json");
      await writeFile(filePath, Buffer.alloc(MAX_SOURCE_BYTES + 1, 0x61));
      await assert.rejects(
        () => readBoundedBundleFile(dir, "all_clients.json"),
        (error: Error & { code?: string }) => error.code === "FILE_TOO_LARGE",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
