import assert from "node:assert/strict";
import { it } from "node:test";
import { v3CompositionTerritorySql } from "../../src/clients/v3/detail";

it("composition territory is an additional bound employee and ROP intersection", () => {
  const params: unknown[] = ["existing-session-scope", "holding"];
  const sql = v3CompositionTerritorySql("ro", {
    responsibleGuid: "employee-A",
    responsibleKind: "regional",
    ropBranchGuid: "ROP-A",
  }, params);
  assert.match(sql, /^ AND /);
  assert.match(sql, /ro\.managers->>'guidRegionalManager'/);
  assert.match(sql, /\$3::uuid/);
  assert.match(sql, /ro\.managers->>'guidHeadOfSales'/);
  assert.match(sql, /\$4::uuid/);
  assert.deepEqual(params, ["existing-session-scope", "holding", "employee-A", "ROP-A"]);
  assert.doesNotMatch(sql, /employee-A|ROP-A| OR /);
});

it("no selected territory leaves existing session scope untouched", () => {
  const params: unknown[] = ["session", "holding"];
  assert.equal(v3CompositionTerritorySql("le", {}, params), "");
  assert.deepEqual(params, ["session", "holding"]);
});
