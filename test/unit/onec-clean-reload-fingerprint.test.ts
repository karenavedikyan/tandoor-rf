import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeBundleFingerprint } from "../../src/onec-clean-reload/bundle";
import { computeTargetDbFingerprint } from "../../src/onec-clean-reload/target-db";

describe("onec clean reload fingerprints", () => {
  it("computes stable target DB fingerprint without credentials", () => {
    const first = computeTargetDbFingerprint("postgresql://user:secret@db.example.com:5433/tandoor_rf");
    const second = computeTargetDbFingerprint("postgres://other:pass@db.example.com:5433/tandoor_rf");
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
  });

  it("computes bundle fingerprint over sorted file hashes", () => {
    const first = computeBundleFingerprint({
      holdingLinkPolicy: "tolerant",
      files: [
        { relativePath: "all_clients.json", sha256: "a".repeat(64) },
        { relativePath: "all_employees.json", sha256: "b".repeat(64) },
      ],
    });
    const second = computeBundleFingerprint({
      holdingLinkPolicy: "tolerant",
      files: [
        { relativePath: "all_employees.json", sha256: "b".repeat(64) },
        { relativePath: "all_clients.json", sha256: "a".repeat(64) },
      ],
    });
    assert.equal(first, second);
    assert.notEqual(
      first,
      computeBundleFingerprint({
        holdingLinkPolicy: "strict",
        files: [
          { relativePath: "all_clients.json", sha256: "a".repeat(64) },
          { relativePath: "all_employees.json", sha256: "b".repeat(64) },
        ],
      }),
    );
  });
});
