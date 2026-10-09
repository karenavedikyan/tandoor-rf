import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildHoldingV2DesiredSnapshot,
  computeDesiredNormalizedStateSha256,
} from "../../src/onec-clients/holding-v2-reconcile";
import { validateHoldingV2ClientsFileBytes } from "../../src/onec-clients/validate";
import {
  buildHoldingV2FileBytes,
  headRow,
  memberRow,
  minimalOutlet,
} from "../helpers/holding-v2-fixtures";

const H1 = "a1000000-0000-4000-8000-000000000001";
const H2 = "a2000000-0000-4000-8000-000000000002";
const M2 = "a1000000-0000-4000-8000-000000000011";
const S1 = "b1000000-0000-4000-8000-000000000001";

describe("holding v2 reconcile desired state", () => {
  it("produces identical normalized hash regardless of row order", () => {
    const a = buildHoldingV2FileBytes([
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
      memberRow(M2, H1),
      headRow(H2, { retail_outlets: [] }),
    ]);
    const b = buildHoldingV2FileBytes([
      headRow(H2, { retail_outlets: [] }),
      memberRow(M2, H1),
      headRow(H1, { retail_outlets: [minimalOutlet(S1)] }),
    ]);
    const va = validateHoldingV2ClientsFileBytes(a);
    const vb = validateHoldingV2ClientsFileBytes(b);
    assert.equal(va.ok, true);
    assert.equal(vb.ok, true);
    if (!va.ok || !vb.ok) return;
    const da = buildHoldingV2DesiredSnapshot(va.payload);
    const db = buildHoldingV2DesiredSnapshot(vb.payload);
    assert.equal(da.ok, true);
    assert.equal(db.ok, true);
    if (!da.ok || !db.ok) return;
    assert.equal(
      computeDesiredNormalizedStateSha256(da.desired),
      computeDesiredNormalizedStateSha256(db.desired),
    );
  });
});
