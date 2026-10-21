import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLegalOtherFieldsBackfillCliArgs } from "../../src/onec-exchange-v3/legal-other-fields-backfill/cli-args";
import { parseRegularUpdateCliArgs } from "../../src/onec-regular-update/cli-args";

describe("legal other_fields backfill CLI", () => {
  it("rejects unknown regular-update style args (narrow tool is separate)", () => {
    assert.equal(parseRegularUpdateCliArgs(["--clients-file", "/tmp/x.json"]).ok, false);
    assert.equal(parseRegularUpdateCliArgs(["--apply", "--expected-fingerprint=SYNTH"]).ok, false);
  });

  it("parses dry-run with clients file", () => {
    const parsed = parseLegalOtherFieldsBackfillCliArgs([
      "--dry-run",
      "--clients-file",
      "/tmp/synthetic-all_clients.json",
    ]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.options.mode, "dry_run");
      assert.match(parsed.options.clientsFilePath ?? "", /synthetic-all_clients.json$/);
    }
  });

  it("requires plan hash and target db on apply", () => {
    const missing = parseLegalOtherFieldsBackfillCliArgs(["--apply"]);
    assert.equal(missing.ok, false);
    const partial = parseLegalOtherFieldsBackfillCliArgs([
      "--apply",
      "--expected-source-sha256",
      "a".repeat(64),
    ]);
    assert.equal(partial.ok, false);
  });
});
