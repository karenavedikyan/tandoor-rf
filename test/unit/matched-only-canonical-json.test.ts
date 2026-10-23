import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256CanonicalJson } from "../../src/onec-sales/matched-only/canonical-json";
import { businessDigestFromScopedTables } from "../../src/onec-sales/matched-only/state-digest";
import type { MatchedOnlyScopedBackupV1 } from "../../src/onec-sales/matched-only/types";

describe("matched-only canonical json", () => {
  it("distinguishes different Date values (does not collapse to empty object)", () => {
    const september = new Date("2026-09-01T00:00:00.000Z");
    const october = new Date("2026-10-01T00:00:00.000Z");
    const hashSep = sha256CanonicalJson({ at: september });
    const hashOct = sha256CanonicalJson({ at: october });
    assert.notEqual(hashSep, hashOct);
    assert.notEqual(hashSep, sha256CanonicalJson({ at: {} }));
  });

  it("matches in-memory Date with JSON file round-trip string form", () => {
    const importedAt = new Date("2026-09-15T08:30:00.123Z");
    const inMemory = {
      rows: [{ imported_at: importedAt, source_sha256: "aa".repeat(32) }],
    };
    const fromFile = JSON.parse(
      JSON.stringify(inMemory),
    ) as { rows: { imported_at: string; source_sha256: string }[] };
    assert.equal(sha256CanonicalJson(inMemory), sha256CanonicalJson(fromFile));
  });

  it("detects timestamp drift in scoped business digest", () => {
    const baseTables: MatchedOnlyScopedBackupV1["tables"] = {
      saleAggregateLines: [],
      saleItemLines: [
        {
          source_sha256: "bb".repeat(32),
          source_row_index: 0,
          legal_guid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          sale_month: "2026-09-01",
          imported_at: new Date("2026-09-01T10:00:00.000Z"),
        },
      ],
      returnLines: [],
      returnItemLines: [],
      importStates: [],
      monthActivations: [],
      monthStats: [],
      quarantineRows: [],
      applyRuns: [],
    };
    const digestA = businessDigestFromScopedTables({
      saleMonthsIso: ["2026-09-01"],
      tables: baseTables,
    });
    const drifted = {
      ...baseTables,
      saleItemLines: [
        {
          ...baseTables.saleItemLines[0],
          imported_at: new Date("2026-09-01T11:00:00.000Z"),
        },
      ],
    };
    const digestB = businessDigestFromScopedTables({
      saleMonthsIso: ["2026-09-01"],
      tables: drifted,
    });
    assert.notEqual(digestA, digestB);
  });

  it("keeps backup file SHA stable after write and read", async () => {
    const backup: MatchedOnlyScopedBackupV1 = {
      v: 1,
      planHash: "cc".repeat(32),
      targetDbFingerprint: "dd".repeat(32),
      beforeStateSha256: "ee".repeat(32),
      capturedAt: new Date("2026-09-01T00:00:00.000Z").toISOString(),
      saleMonthsIso: ["2026-09-01"],
      sourceHashes: {
        saleAggregate: "11".repeat(32),
        saleItems: "22".repeat(32),
        returnsAggregate: "33".repeat(32),
        returnItems: "44".repeat(32),
      },
      tables: {
        saleAggregateLines: [],
        saleItemLines: [
          {
            imported_at: new Date("2026-09-02T12:00:00.000Z"),
            source_row_index: 1,
          },
        ],
        returnLines: [],
        returnItemLines: [],
        importStates: [],
        monthActivations: [],
        monthStats: [],
        quarantineRows: [],
        applyRuns: [],
      },
    };
    const hashInMemory = sha256CanonicalJson(backup);
    const path = join(tmpdir(), `matched-only-backup-${Date.now()}.json`);
    await writeFile(path, `${JSON.stringify(backup)}\n`, "utf8");
    const parsed = JSON.parse(await readFile(path, "utf8")) as MatchedOnlyScopedBackupV1;
    const hashAfterRead = sha256CanonicalJson(parsed);
    assert.equal(hashInMemory, hashAfterRead);
    await unlink(path);
  });
});
