import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const logic = createRequire(import.meta.url)("../../public/clients-logic.js") as {
  clearedTeamTerritoryFields: () => Record<string, string>;
  hasResponsibleSelection: (state: Record<string, unknown>) => boolean;
  isBranchPortfolioList: (state: Record<string, unknown>) => boolean;
  isTeamsRosterView: (state: Record<string, unknown>) => boolean;
};

describe("clients team territory state helpers", () => {
  it("clears legacy assignment fields so territory back opens roster not branch list", () => {
    const cleared = logic.clearedTeamTerritoryFields();
    const afterBack = Object.assign(
      {
        view: "teams",
        ropEmployee: "55555555-5555-4555-8555-555555555555",
        teamKind: "hardware",
        hardwareManager: "77777777-7777-4777-8777-777777777777",
        portfolio: "clients",
      },
      cleared,
    );
    assert.equal(logic.hasResponsibleSelection(afterBack), false);
    assert.equal(logic.isBranchPortfolioList(afterBack), false);
    assert.equal(logic.isTeamsRosterView(afterBack), true);
  });
});
