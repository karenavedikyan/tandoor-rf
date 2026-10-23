import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readLegalEntityGuidFromClientInfo } from "../../src/onec-sales/client-info-legal-guid";
import { LEGAL_A, LEGAL_B } from "../helpers/legal-sales-fixtures";

describe("client_info legal guid (sale/return contract)", () => {
  it("prefers guid when both guid and id match", () => {
    const result = readLegalEntityGuidFromClientInfo({ guid: LEGAL_A, id: LEGAL_A });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.legalGuid, LEGAL_A);
    assert.equal(result.source, "guid");
  });

  it("uses legacy id when guid key is absent", () => {
    const result = readLegalEntityGuidFromClientInfo({ id: LEGAL_A, name: "X" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.source, "legacy_id");
  });

  it("rejects guid/id conflict", () => {
    const result = readLegalEntityGuidFromClientInfo({ guid: LEGAL_A, id: LEGAL_B });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CLIENT_INFO_GUID_ID_CONFLICT");
  });
});
