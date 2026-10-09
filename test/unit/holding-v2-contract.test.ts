import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildHoldingV2DiagnoseReport } from "../../scripts/holding-v2-diagnose-clients-file.ts";
import { applyClientsImport } from "../../src/onec-clients/apply";
import {
  analyzeOutletsForHoldingComposition,
  classifyHoldingCompositionSiteType,
} from "../../src/onec-clients/holding-v2-composition";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import {
  validateClientsFileBytes,
  validateHoldingV2ClientsFileBytes,
} from "../../src/onec-clients/validate";
import { buildClientsFileBytes, sampleClient } from "../helpers/onec-clients-fixtures";
import {
  buildCompositionPatternBundle,
  buildHoldingV2FileBytes,
  headRow,
  memberRow,
  minimalOutlet,
  typeCategory,
} from "../helpers/holding-v2-fixtures";

const H1 = "a1000000-0000-4000-8000-000000000001";
const H2 = "a2000000-0000-4000-8000-000000000002";
const M2 = "a1000000-0000-4000-8000-000000000011";
const S1 = "b1000000-0000-4000-8000-000000000001";
const S2 = "b1000000-0000-4000-8000-000000000002";
const S3 = "b1000000-0000-4000-8000-000000000003";

function sumCompositionTallies(
  dist: NonNullable<
    import("../../src/onec-clients/holding-v2-diagnostics").HoldingV2DiagnosticsSummary["compositionTypeDistribution"]
  >,
): number {
  return (
    dist.mono +
    dist.mono_network +
    dist.group +
    dist.group_network +
    dist.no_active_outlets +
    dist.unknown
  );
}

function assertSuccessfulV2BundleInvariants(
  result: Extract<
    ReturnType<typeof validateHoldingV2ClientsFileBytes>,
    { ok: true }
  >,
): void {
  const d = result.payload.holdingV2Diagnostics!;
  const dist = d.compositionTypeDistribution;
  assert.equal(sumCompositionTallies(dist), d.holdingRootCount);
  assert.ok(
    d.legalEntityRowCount >=
      d.holdingRootCount + dist.group + dist.group_network,
  );
}

describe("holding v2 exchange contract", () => {
  it("1) self-ref head without holding flag passes v2; legacy-shaped empty guid_holding fails v2", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
    ]);
    assert.equal(validateHoldingV2ClientsFileBytes(bytes).ok, true);

    const legacyEmptyHolding = buildClientsFileBytes([
      sampleClient({ guid_holding: "", name_holding: "" }),
    ]);
    const v2Legacy = validateHoldingV2ClientsFileBytes(legacyEmptyHolding);
    assert.equal(v2Legacy.ok, false);
    if (v2Legacy.ok) return;
    assert.ok(v2Legacy.issues.some((i) => i.code === "HOLDING_V2_MISSING_HOLDING_GUID"));
  });

  it("2a) duplicate guid_store across two holdings is error under v2", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      headRow(H2, { retail_outlets: [minimalOutlet(S1)] }),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.issues.some(
        (i) => i.code === "DUPLICATE_OUTLET_GUID" || i.code === "OUTLET_GUID_CONFLICT",
      ),
    );
  });

  it("2) duplicate guid_store within head array is error under v2", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        retail_outlets: [minimalOutlet(S1), minimalOutlet(S1)],
      }),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "DUPLICATE_OUTLET_GUID"));
  });

  it("3) legacy path ignores invalid client type_category null", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        type_category: null,
        retail_outlets: [minimalOutlet(S1, { type_category: null })],
      }),
    ]);
    assert.equal(validateClientsFileBytes(bytes).ok, false);
    assert.equal(validateHoldingV2ClientsFileBytes(bytes).ok, false);
    if (!validateHoldingV2ClientsFileBytes(bytes).ok) {
      assert.ok(
        validateHoldingV2ClientsFileBytes(bytes).issues.some(
          (i) => i.code === "INVALID_TYPE_CATEGORY",
        ),
      );
    }
    const legacyOnly = buildClientsFileBytes([
      {
        ...sampleClient({ guid_client: H1, guid_holding: H1, name_holding: "H" }),
        type_category: null,
      },
    ]);
    const legacyResult = validateClientsFileBytes(legacyOnly);
    assert.equal(legacyResult.ok, true);
    if (!legacyResult.ok) return;
    assert.ok(
      !legacyResult.payload.extendedRecords &&
        legacyResult.payload.sourceFormat === "legacy",
    );
    const v2Legacy = validateHoldingV2ClientsFileBytes(legacyOnly);
    assert.equal(v2Legacy.ok, false);
    if (v2Legacy.ok) return;
    assert.ok(v2Legacy.issues.some((i) => i.code === "INVALID_TYPE_CATEGORY"));
  });

  it("4) preserves source index after rejected row for outlet holding mismatch", () => {
    const bytes = buildHoldingV2FileBytes([
      { ...sampleClient(), guid_client: "not-a-uuid" },
      headRow(H1, {
        retail_outlets: [
          minimalOutlet(S1, { guid_holding: H2 }),
        ],
      }),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const mismatch = result.issues.find((i) => i.code === "HOLDING_V2_OUTLET_HOLDING_MISMATCH");
    assert.ok(mismatch);
    assert.equal(mismatch!.index, 1);
    assert.equal(mismatch!.outletIndex, 0);
  });

  it("5) unknown closure → unknown composition, not no_active_outlets (parsed chain)", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        retail_outlets: [{ guid_store: S1 }],
      }),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.holdingV2Diagnostics?.compositionTypeDistribution.unknown, 1);
    assert.equal(
      result.payload.holdingV2Diagnostics?.compositionTypeDistribution.no_active_outlets,
      0,
    );
  });

  it("5b) 1 open + 2 closed → mono via diagnostics", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        retail_outlets: [
          minimalOutlet(S1, { closed: false }),
          minimalOutlet(S2, { closed: true }),
          minimalOutlet(S3, { closed: true }),
        ],
      }),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.holdingV2Diagnostics?.compositionTypeDistribution.mono, 1);
    assert.equal(result.payload.holdingV2Diagnostics?.activeOutletGuidCount, 1);
    assert.equal(result.payload.holdingV2Diagnostics?.closedOutletGuidCount, 2);
  });

  it("6) diagnostics aggregates on successful v2 validation", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      memberRow(M2, H1),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const d = result.payload.holdingV2Diagnostics!;
    assert.equal(d.legalEntityRowCount, 2);
    assert.equal(d.holdingRootCount, 1);
    assert.equal(d.uniqueOutletGuidCount, 1);
  });

  it("head legal entity counted once in composition (mono)", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.holdingV2Diagnostics?.compositionTypeDistribution.mono, 1);
  });

  it("re-open closed outlet changes composition type", () => {
    const closedOnly = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1, { closed: true })] }),
    ]);
    const r1 = validateHoldingV2ClientsFileBytes(closedOnly);
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    assert.equal(r1.payload.holdingV2Diagnostics?.compositionTypeDistribution.no_active_outlets, 1);

    const reopened = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1, { closed: false })] }),
    ]);
    const r2 = validateHoldingV2ClientsFileBytes(reopened);
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    assert.equal(r2.payload.holdingV2Diagnostics?.compositionTypeDistribution.mono, 1);
  });

  it("transfer outlet between heads across snapshots", () => {
    const snapA = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
    ]);
    const snapB = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [] }),
      headRow(H2, {
        guid_client: H2,
        guid_holding: H2,
        retail_outlets: [minimalOutlet(S1)],
      }),
    ]);
    assert.equal(validateHoldingV2ClientsFileBytes(snapA).ok, true);
    assert.equal(validateHoldingV2ClientsFileBytes(snapB).ok, true);
  });

  it("7) holding guid cycle is rejected under v2", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, { guid_holding: M2, retail_outlets: [] }),
      memberRow(M2, H1, { guid_client: M2 }),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "HOLDING_V2_CYCLE"));
  });

  it("8) legacy validator still rejects self-ref", () => {
    const bytes = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [minimalOutlet(S1)] })]);
    const legacy = validateClientsFileBytes(bytes);
    assert.equal(legacy.ok, false);
    assert.ok(legacy.issues.some((i) => i.code === "HOLDING_SELF_REFERENCE"));
  });

  it("legacy-shaped v2 head keeps extendedRecords and type_category without extended markers", async () => {
    const bytes = buildClientsFileBytes([
      {
        ...sampleClient({ guid_client: H1, guid_holding: H1, name_holding: "H" }),
        type_category: typeCategory({ guid_type: "legacy-v2-type" }),
      },
    ]);
    const legacyDefault = validateClientsFileBytes(bytes);
    assert.equal(legacyDefault.ok, true);
    if (!legacyDefault.ok) return;
    assert.equal(legacyDefault.payload.extendedRecords, undefined);

    const v2 = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(v2.ok, true);
    if (!v2.ok) return;
    assert.equal(v2.payload.sourceFormat, "legacy");
    const ext = v2.payload.extendedRecords!;
    assert.equal(ext.length, 1);
    assert.equal(ext[0]!.typeCategory.guidType, "legacy-v2-type");
    assert.equal(ext[0]!.fieldPresence.retailOutlets, "missing");
    assert.equal(ext[0]!.typeCategory.objectPresentInSource, true);

    const report = buildHoldingV2DiagnoseReport(v2, { origin: "synthetic" });
    const stats = report.typeCategoryStats as {
      rowsWithTypeCategoryObject: number;
      rowsWithTypeCategoryFieldKeys: number;
    };
    assert.equal(stats.rowsWithTypeCategoryObject, 1);
    assert.equal(stats.rowsWithTypeCategoryFieldKeys, 1);

    const emptyObjectBytes = buildClientsFileBytes([
      {
        ...sampleClient({ guid_client: H1, guid_holding: H1, name_holding: "H" }),
        type_category: {},
      },
    ]);
    const emptyObj = validateHoldingV2ClientsFileBytes(emptyObjectBytes);
    assert.equal(emptyObj.ok, true);
    if (!emptyObj.ok) return;
    const row = emptyObj.payload.extendedRecords![0]!;
    assert.equal(row.typeCategory.objectPresentInSource, true);
    assert.equal(row.typeCategory.fieldPresence.guidType, false);
    const emptyReport = buildHoldingV2DiagnoseReport(emptyObj, { origin: "synthetic" });
    const emptyStats = emptyReport.typeCategoryStats as {
      rowsWithTypeCategoryObject: number;
      rowsWithTypeCategoryFieldKeys: number;
    };
    assert.equal(emptyStats.rowsWithTypeCategoryObject, 1);
    assert.equal(emptyStats.rowsWithTypeCategoryFieldKeys, 0);

    const fp = verificationFingerprintFromPayload({ payload: v2.payload });
    const applyResult = await applyClientsImport({
      payload: v2.payload,
      expectedVerificationFingerprint: fp,
    });
    assert.equal(applyResult.ok, false);
    if (applyResult.ok) return;
    assert.equal(applyResult.code, "APPLY_BLOCKED");
  });

  it("9) independent type_category values", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        type_category: typeCategory({ guid_type: "t-head" }),
        retail_outlets: [minimalOutlet(S1, { type_category: typeCategory({ guid_type: "t-out" }) })],
      }),
      memberRow(M2, H1, { type_category: typeCategory({ guid_type: "t-mem" }) }),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ext = result.payload.extendedRecords!;
    assert.equal(ext.find((r) => r.guid_client === H1)!.typeCategory.guidType, "t-head");
    assert.equal(ext.find((r) => r.guid_client === M2)!.typeCategory.guidType, "t-mem");
    const outlet = ext.find((r) => r.guid_client === H1)!.retailOutlets[0]!;
    assert.equal(outlet.typeCategory.guidType, "t-out");
    assert.equal(outlet.typeCategory.objectPresentInSource, true);
  });

  it("outlet without type_category does not inherit head type_category", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        type_category: typeCategory({ guid_type: "t-head" }),
        retail_outlets: [minimalOutlet(S1)],
      }),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const head = result.payload.extendedRecords!.find((r) => r.guid_client === H1)!;
    assert.equal(head.typeCategory.guidType, "t-head");
    const outlet = head.retailOutlets[0]!;
    assert.equal(outlet.typeCategory.objectPresentInSource, false);
    assert.equal(outlet.typeCategory.guidType, null);
  });

  it("transfer member legal entity between holdings across snapshots", () => {
    const snapA = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      memberRow(M2, H1),
    ]);
    const snapB = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      headRow(H2, { retail_outlets: [minimalOutlet(S2)] }),
      memberRow(M2, H2),
    ]);
    assert.equal(validateHoldingV2ClientsFileBytes(snapA).ok, true);
    const b = validateHoldingV2ClientsFileBytes(snapB);
    assert.equal(b.ok, true);
    if (!b.ok) return;
    assert.equal(b.payload.extendedRecords!.find((r) => r.guid_client === M2)!.guid_holding, H2);
  });

  it("12) v2 payload APPLY_BLOCKED before DB", async () => {
    const bytes = buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [minimalOutlet(S1)] })]);
    const validated = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const fp = verificationFingerprintFromPayload({ payload: validated.payload });
    const applyResult = await applyClientsImport({
      payload: validated.payload,
      expectedVerificationFingerprint: fp,
    });
    assert.equal(applyResult.ok, false);
    if (applyResult.ok) return;
    assert.equal(applyResult.code, "APPLY_BLOCKED");
  });

  it("regression: synthetic bundle matches audit composition pattern (422 mono + 2320 group_network)", () => {
    const bytes = buildCompositionPatternBundle({
      monoCount: 422,
      groupNetworkCount: 2320,
    });
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const dist = result.payload.holdingV2Diagnostics!.compositionTypeDistribution;
    assert.equal(dist.mono, 422);
    assert.equal(dist.mono_network, 0);
    assert.equal(dist.group, 0);
    assert.equal(dist.group_network, 2320);
    assert.equal(result.payload.recordCount, 5062);
    assert.equal(result.payload.holdingV2Diagnostics!.holdingRootCount, 2742);
    assert.equal(result.payload.holdingV2Diagnostics!.legalEntityRowCount, 5062);
    assertSuccessfulV2BundleInvariants(result);
    assert.equal(
      result.payload.extendedRecords!.filter(
        (r) => r.guid_holding && r.guid_client === r.guid_holding,
      ).length,
      2742,
    );
    const diagReport = buildHoldingV2DiagnoseReport(result, { origin: "synthetic" });
    const tc = diagReport.typeCategoryStats as { rowsWithTypeCategoryObject: number };
    assert.equal(tc.rowsWithTypeCategoryObject, 5062);
  });

  it("diagnose CLI stdout/stderr do not leak audit path tokens", () => {
    const secret = "syn-secret-audit-token-do-not-print";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holding-v2-audit-"));
    const nested = path.join(dir, secret);
    fs.mkdirSync(nested);
    const filePath = path.join(nested, "clients.json");
    fs.writeFileSync(
      filePath,
      buildHoldingV2FileBytes([headRow(H1, { retail_outlets: [minimalOutlet(S1)] })]),
    );
    try {
      const env = { ...process.env, AUDIT_CLIENTS_PATH: filePath };
      const okRun = spawnSync(
        "node",
        ["--import", "tsx", "scripts/holding-v2-diagnose-clients-file.ts"],
        { cwd: process.cwd(), env, encoding: "utf8" },
      );
      assert.equal(okRun.status, 0);
      assert.ok(!okRun.stdout.includes(secret));
      assert.ok(!okRun.stderr.includes(secret));
      assert.ok(!okRun.stdout.includes(filePath));

      const missingRun = spawnSync(
        "node",
        ["--import", "tsx", "scripts/holding-v2-diagnose-clients-file.ts"],
        {
          cwd: process.cwd(),
          env: { ...process.env, AUDIT_CLIENTS_PATH: path.join(nested, "missing.json") },
          encoding: "utf8",
        },
      );
      assert.ok(!missingRun.stdout.includes(secret));
      assert.ok(!missingRun.stderr.includes(secret));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("analyzeOutletsForHoldingComposition unit edge cases", () => {
    const analysis = analyzeOutletsForHoldingComposition([
      { closureStatus: "open", guidStore: S1, outletGuidStatus: "confirmed" },
      { closureStatus: "not_provided", guidStore: S2, outletGuidStatus: "confirmed" },
    ]);
    assert.equal(analysis.compositionDataComplete, false);
    assert.equal(
      classifyHoldingCompositionSiteType({
        legalEntityCount: 1,
        activeOutletCount: analysis.activeUniqueGuidCount,
        membershipComplete: true,
        compositionDataComplete: analysis.compositionDataComplete,
      }),
      "unknown",
    );
  });
});
