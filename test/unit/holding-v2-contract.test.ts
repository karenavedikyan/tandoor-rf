import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyClientsImport } from "../../src/onec-clients/apply";
import { classifyHoldingCompositionSiteType } from "../../src/onec-clients/holding-v2-composition";
import {
  validateClientsFileBytes,
  validateHoldingV2ClientsFileBytes,
} from "../../src/onec-clients/validate";
import { verificationFingerprintFromPayload } from "../../src/onec-clients/import-verification-fingerprint";
import {
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

describe("holding v2 exchange contract", () => {
  it("1) self-ref head without holding flag passes v2 validation", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        retail_outlets: [minimalOutlet(S1)],
      }),
    ]);
    const legacy = validateClientsFileBytes(bytes);
    assert.equal(legacy.ok, false);
    const v2 = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(v2.ok, true);
  });

  it("2) classifies four composition types and no_active_outlets", () => {
    assert.equal(
      classifyHoldingCompositionSiteType({
        legalEntityCount: 1,
        activeOutletCount: 1,
        membershipComplete: true,
      }),
      "mono",
    );
    assert.equal(
      classifyHoldingCompositionSiteType({
        legalEntityCount: 1,
        activeOutletCount: 2,
        membershipComplete: true,
      }),
      "mono_network",
    );
    assert.equal(
      classifyHoldingCompositionSiteType({
        legalEntityCount: 2,
        activeOutletCount: 1,
        membershipComplete: true,
      }),
      "group",
    );
    assert.equal(
      classifyHoldingCompositionSiteType({
        legalEntityCount: 2,
        activeOutletCount: 2,
        membershipComplete: true,
      }),
      "group_network",
    );
    assert.equal(
      classifyHoldingCompositionSiteType({
        legalEntityCount: 1,
        activeOutletCount: 0,
        membershipComplete: true,
      }),
      "no_active_outlets",
    );
  });

  it("3) closed outlets excluded from active count classification", () => {
    assert.equal(
      classifyHoldingCompositionSiteType({
        legalEntityCount: 1,
        activeOutletCount: 0,
        membershipComplete: true,
      }),
      "no_active_outlets",
    );
    assert.equal(
      classifyHoldingCompositionSiteType({
        legalEntityCount: 1,
        activeOutletCount: 1,
        membershipComplete: true,
      }),
      "mono",
    );
  });

  it("4) non-head empty outlets ok, non-head with outlets rejected", () => {
    const okBytes = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      memberRow(M2, H1),
    ]);
    assert.equal(validateHoldingV2ClientsFileBytes(okBytes).ok, true);

    const bad = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      memberRow(M2, H1, { retail_outlets: [minimalOutlet(S2)] }),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bad);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "HOLDING_V2_NON_HEAD_OUTLETS"));
  });

  it("5) duplicate guid_store across holdings rejected", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      headRow(H2, {
        guid_client: H2,
        guid_holding: H2,
        retail_outlets: [minimalOutlet(S1)],
      }),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.code === "OUTLET_GUID_CONFLICT"));
  });

  it("6) missing head and empty guid_holding rejected", () => {
    const missingHead = buildHoldingV2FileBytes([memberRow(M2, H1)]);
    const r1 = validateHoldingV2ClientsFileBytes(missingHead);
    assert.equal(r1.ok, false);
    if (r1.ok) return;
    assert.ok(r1.issues.some((i) => i.code === "HOLDING_V2_MISSING_HEAD"));

    const noGuid = buildHoldingV2FileBytes([
      headRow(H1, { guid_holding: "", retail_outlets: [minimalOutlet(S1)] }),
    ]);
    const r2 = validateHoldingV2ClientsFileBytes(noGuid);
    assert.equal(r2.ok, false);
  });

  it("7) two snapshots: outlet stays on head only (no TT→legal entity link)", () => {
    const snap1 = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      memberRow(M2, H1),
    ]);
    assert.equal(validateHoldingV2ClientsFileBytes(snap1).ok, true);
    const snap2 = buildHoldingV2FileBytes([
      headRow(H1, {
        retail_outlets: [minimalOutlet(S1), minimalOutlet(S2)],
      }),
      memberRow(M2, H1),
    ]);
    assert.equal(validateHoldingV2ClientsFileBytes(snap2).ok, true);
  });

  it("8) legacy validator still rejects self-ref (production path unchanged)", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
    ]);
    const legacy = validateClientsFileBytes(bytes);
    assert.equal(legacy.ok, false);
    assert.ok(legacy.issues.some((i) => i.code === "HOLDING_SELF_REFERENCE"));
  });

  it("9) type_category stored separately on head, member, outlet without inheritance", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        type_category: typeCategory({ guid_type: "t-head", name_type: "HeadType" }),
        retail_outlets: [
          minimalOutlet(S1, {
            type_category: typeCategory({ guid_type: "t-out", name_type: "OutletType" }),
          }),
        ],
      }),
      memberRow(M2, H1, {
        type_category: typeCategory({ guid_type: "t-mem", name_type: "MemberType" }),
      }),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ext = result.payload.extendedRecords!;
    const head = ext.find((r) => r.guid_client === H1)!;
    const mem = ext.find((r) => r.guid_client === M2)!;
    assert.equal(head.typeCategory.guidType, "t-head");
    assert.equal(mem.typeCategory.guidType, "t-mem");
    assert.equal(head.retailOutlets[0]!.typeCategory.guidType, "t-out");
  });

  it("10) empty type_category strings preserved; F2 wholesale fields untouched", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        type_category: typeCategory(),
        "Оптовик_Топ150": "Да",
        retail_outlets: [minimalOutlet(S1)],
      }),
    ]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const head = result.payload.extendedRecords![0]!;
    assert.equal(head.typeCategory.nameType, "");
    assert.equal(head.wholesaleExchange.top150, "Да");
  });

  it("11) F5 client code still validates under v2", () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, {
        Код: "SYNTH-OK",
        retail_outlets: [minimalOutlet(S1)],
      }),
    ]);
    assert.equal(validateHoldingV2ClientsFileBytes(bytes).ok, true);
  });

  it("12) v2 validated payload blocked from apply", async () => {
    const bytes = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
    ]);
    const validated = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    assert.equal(validated.payload.holdingExchangeSchema, "v2");
    const fp = verificationFingerprintFromPayload({ payload: validated.payload });
    const applyResult = await applyClientsImport({
      payload: validated.payload,
      expectedVerificationFingerprint: fp,
    });
    assert.equal(applyResult.ok, false);
    if (applyResult.ok) return;
    assert.equal(applyResult.code, "APPLY_BLOCKED");
  });

  it("13) validation issues expose codes and indexes only (no value fields)", () => {
    const bytes = buildHoldingV2FileBytes([memberRow(M2, H1)]);
    const result = validateHoldingV2ClientsFileBytes(bytes);
    assert.equal(result.ok, false);
    if (result.ok) return;
    for (const issue of result.issues) {
      assert.ok("code" in issue);
      assert.equal("value" in (issue as Record<string, unknown>), false);
      assert.equal("name_client" in (issue as Record<string, unknown>), false);
    }
  });
});
