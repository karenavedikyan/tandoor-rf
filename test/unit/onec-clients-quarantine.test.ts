import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalQuarantineManifest,
  parseQuarantineManifestBytes,
  quarantineManifestSha256,
} from "../../src/onec-clients/quarantine-manifest";
import { validateQuarantineAgainstIssues } from "../../src/onec-clients/quarantine-validation";
import { projectAcceptedClientsWithQuarantine } from "../../src/onec-clients/quarantine-projection";
import { validateExtendedClientsFileBytes } from "../../src/onec-clients/extended-validate";
import {
  buildExtendedClientsFileBytes,
  EXTENDED_FIXTURE_GUIDS,
  sampleExtendedChild,
  sampleExtendedHolding,
} from "../helpers/onec-clients-extended-fixtures";
import { sha256Hex } from "../../src/onec-clients/sha256";

describe("onec clients quarantine", () => {
  it("parses and canonicalizes manifest bound to source sha", () => {
    const manifest = {
      v: 1,
      sourceSha256: "a".repeat(64),
      entries: [
        {
          guidClient: EXTENDED_FIXTURE_GUIDS.CHILD_GUID,
          reason: "HOLDING_TARGET_NOT_HOLDING_CARD",
          relatedGuid: EXTENDED_FIXTURE_GUIDS.HOLDING_GUID,
        },
      ],
    };
    const bytes = Buffer.from(JSON.stringify(manifest), "utf8");
    const parsed = parseQuarantineManifestBytes(bytes);
    assert.equal("v" in parsed && parsed.v, 1);
    if (!("v" in parsed)) return;
    const canonical = canonicalQuarantineManifest(parsed);
    assert.match(canonical, /holding_target_not_holding_card/i);
    assert.equal(quarantineManifestSha256(parsed).length, 64);
  });

  it("isolates exactly one HOLDING_TARGET_NOT_HOLDING_CARD via manifest", () => {
    const holdingGuid = EXTENDED_FIXTURE_GUIDS.HOLDING_GUID;
    const childGuid = EXTENDED_FIXTURE_GUIDS.CHILD_GUID;
    const clientsBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ guid_client: holdingGuid, holding: false }),
      sampleExtendedChild({ guid_client: childGuid, guid_holding: holdingGuid }),
    ]);
    const sourceSha256 = sha256Hex(clientsBytes);
    const manifestBytes = Buffer.from(
      JSON.stringify({
        v: 1,
        sourceSha256,
        entries: [
          {
            guidClient: childGuid,
            reason: "HOLDING_TARGET_NOT_HOLDING_CARD",
            relatedGuid: holdingGuid,
          },
        ],
      }),
      "utf8",
    );
    const manifest = parseQuarantineManifestBytes(manifestBytes);
    assert.ok("v" in manifest);

    const failed = validateExtendedClientsFileBytes(clientsBytes, {
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(failed.ok, false);
    if (failed.ok || !failed.parsedRecords) return;

    const quarantine = validateQuarantineAgainstIssues({
      sourceSha256,
      manifest: manifest as import("../../src/onec-clients/quarantine-manifest").QuarantineManifest,
      records: failed.parsedRecords,
      issues: failed.issues,
    });
    assert.ok("acceptedGuids" in quarantine);
    if (!("acceptedGuids" in quarantine)) return;
    assert.equal(quarantine.quarantinedGuids.size, 1);
    assert.ok(quarantine.acceptedGuids.has(holdingGuid.toLowerCase()));
    assert.ok(!quarantine.acceptedGuids.has(childGuid.toLowerCase()));
  });

  it("blocks when quarantined card issue set no longer matches manifest reason", () => {
    const holdingGuid = EXTENDED_FIXTURE_GUIDS.HOLDING_GUID;
    const childGuid = EXTENDED_FIXTURE_GUIDS.CHILD_GUID;
    const clientsBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ guid_client: holdingGuid, holding: false, name_client: "" }),
      sampleExtendedChild({ guid_client: childGuid, guid_holding: holdingGuid }),
    ]);
    const sourceSha256 = sha256Hex(clientsBytes);
    const failed = validateExtendedClientsFileBytes(clientsBytes, {
      holdingLinkValidationPolicy: "tolerant",
    });
    assert.equal(failed.ok, false);
    if (failed.ok || !failed.parsedRecords) return;

    const manifest = {
      v: 1 as const,
      sourceSha256,
      entries: [
        {
          guidClient: childGuid,
          reason: "HOLDING_TARGET_NOT_HOLDING_CARD" as const,
          relatedGuid: holdingGuid,
        },
      ],
    };
    const result = validateQuarantineAgainstIssues({
      sourceSha256,
      manifest,
      records: failed.parsedRecords,
      issues: failed.issues,
    });
    assert.equal("code" in result && result.code, "QUARANTINE_UNEXPECTED_ISSUE");
  });

  it("projects accepted payload that re-validates cleanly", () => {
    const holdingGuid = EXTENDED_FIXTURE_GUIDS.HOLDING_GUID;
    const childGuid = EXTENDED_FIXTURE_GUIDS.CHILD_GUID;
    const clientsBytes = buildExtendedClientsFileBytes([
      sampleExtendedHolding({ guid_client: holdingGuid, holding: false }),
      sampleExtendedChild({ guid_client: childGuid, guid_holding: holdingGuid }),
    ]);
    const sourceSha256 = sha256Hex(clientsBytes);
    const manifestBytes = Buffer.from(
      JSON.stringify({
        v: 1,
        sourceSha256,
        entries: [
          {
            guidClient: childGuid,
            reason: "HOLDING_TARGET_NOT_HOLDING_CARD",
            relatedGuid: holdingGuid,
          },
        ],
      }),
      "utf8",
    );
    const projection = projectAcceptedClientsWithQuarantine({
      clientsBytes,
      manifest: parseQuarantineManifestBytes(manifestBytes) as import("../../src/onec-clients/quarantine-manifest").QuarantineManifest,
      limits: { holdingLinkValidationPolicy: "tolerant" },
    });
    assert.ok("payload" in projection);
    if (!("payload" in projection)) return;
    assert.equal(projection.payload.recordCount, 1);
    assert.equal(sha256Hex(clientsBytes), sourceSha256);
    assert.notEqual(projection.payload.sha256, sourceSha256);
  });
});
