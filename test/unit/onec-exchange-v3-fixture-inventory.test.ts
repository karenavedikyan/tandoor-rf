import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const FIXTURE_DIR = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");

/** Expected import surface for PR #76 synthetic bundle (must match onec-exchange-v3-import.test.ts). */
describe("onec exchange v3 fixture inventory", () => {
  it("matches import test expectations: 1 holding, 3 legal, 2 retail, 6 label objects", () => {
    const holdings = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "all_holding.json"), "utf8"));
    const clients = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "all_clients.json"), "utf8"));
    const retail = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "all_retail.json"), "utf8"));

    assert.equal(holdings.length, 1);
    assert.equal(clients.length, 3);
    assert.equal(retail.length, 2);

    const orphanRetail = retail.filter((r: { guid_holding?: string }) => !r.guid_holding);
    assert.equal(orphanRetail.length, 1);

    const unassignedLegal = clients.filter(
      (c: { guid_manager?: string; name_client?: string }) =>
        c.name_client === "Legal Unassigned" && !String(c.guid_manager || "").trim(),
    );
    assert.equal(unassignedLegal.length, 1);

    const labelObjectCount = holdings.length + clients.length + retail.length;
    assert.equal(labelObjectCount, 6);
  });
});
