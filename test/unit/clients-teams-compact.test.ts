import assert from "node:assert/strict";
import { describe, it } from "node:test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("../../public/clients-teams-compact.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const logic = require("../../public/clients-logic.js");

type TeamUi = { query: string; kind: string; expanded: string[] };
type Summary = { name: string; shortId?: string; employeeGuid: string };
type Item = {
  kind: string;
  employeeGuid: string;
  name: string;
  clientCount: number;
  outletCount: number;
};

const compact = (
  globalThis as typeof globalThis & {
    ClientsTeamsCompact: {
      mergeResponsiblesByEmployee: (items: unknown[]) => Array<{ assignments: unknown[] }>;
      visibleEmployees: (items: Item[], summary: Summary, teamUi: TeamUi) => Array<{ name: string }>;
      shouldShowRopWithItems: (summary: Summary, teamUi: TeamUi, items: Item[]) => boolean;
      isRopNameMatch: (summary: Summary, teamUi: TeamUi) => boolean;
    };
  }
).ClientsTeamsCompact;

const ROP_A: Summary = { employeeGuid: "rop-a", name: "ROP Alpha", shortId: "rop-a" };
const ROP_B: Summary = { employeeGuid: "rop-b", name: "ROP Beta", shortId: "rop-b" };

const ROP_A_TEAM: Item[] = [
  {
    kind: "manager",
    employeeGuid: "m1",
    name: "Manager One",
    clientCount: 1,
    outletCount: 1,
  },
];

const ROP_B_TEAM: Item[] = [
  {
    kind: "manager",
    employeeGuid: "r1",
    name: "Regional One",
    clientCount: 0,
    outletCount: 0,
  },
  {
    kind: "regional",
    employeeGuid: "r1",
    name: "Regional One",
    clientCount: 1,
    outletCount: 0,
  },
];

describe("clients teams compact merge", () => {
  it("merges multiple assignment kinds for one employee", () => {
    const merged = compact.mergeResponsiblesByEmployee([
      {
        kind: "manager",
        employeeGuid: "55555555-5555-4555-8555-555555555555",
        name: "Regional One",
        clientCount: 1,
        outletCount: 0,
      },
      {
        kind: "regional",
        employeeGuid: "55555555-5555-4555-8555-555555555555",
        name: "Regional One",
        clientCount: 1,
        outletCount: 0,
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].assignments.length, 2);
  });
});

describe("clients teams compact filter semantics", () => {
  it("rop name match shows employees filtered only by assignment kind", () => {
    const teamUi: TeamUi = { query: "rop alpha", kind: "", expanded: [] };
    assert.equal(compact.isRopNameMatch(ROP_A, teamUi), true);
    const visible = compact.visibleEmployees(ROP_A_TEAM, ROP_A, teamUi);
    assert.deepEqual(
      visible.map((employee) => employee.name),
      ["Manager One"],
    );
  });

  it("regional kind hides teams without regional assignments", () => {
    const teamUi: TeamUi = { query: "", kind: "regional", expanded: [] };
    assert.equal(compact.shouldShowRopWithItems(ROP_A, teamUi, ROP_A_TEAM), false);
    assert.equal(compact.shouldShowRopWithItems(ROP_B, teamUi, ROP_B_TEAM), true);
    const visible = compact.visibleEmployees(ROP_B_TEAM, ROP_B, teamUi);
    assert.deepEqual(
      visible.map((employee) => employee.name),
      ["Regional One"],
    );
  });

  it("employee query and kind combine with AND and hide non-matching teams", () => {
    const teamUi: TeamUi = { query: "manager one", kind: "regional", expanded: [] };
    assert.equal(compact.shouldShowRopWithItems(ROP_A, teamUi, ROP_A_TEAM), false);
    assert.equal(compact.shouldShowRopWithItems(ROP_B, teamUi, ROP_B_TEAM), false);
    assert.equal(compact.visibleEmployees(ROP_A_TEAM, ROP_A, teamUi).length, 0);
    assert.equal(compact.visibleEmployees(ROP_B_TEAM, ROP_B, teamUi).length, 0);
  });
});

describe("clients teams dept url state", () => {
  it("normalizes teamDept and persists in query string", () => {
    assert.equal(logic.normalizeTeamDept("sales"), "sales");
    assert.equal(logic.normalizeTeamDept("assistants"), "assistants");
    assert.equal(logic.normalizeTeamDept("other"), "");
    const state = logic.readStateFromSearch("?view=teams&teamDept=assistants&teamQ=ROA");
    assert.equal(state.teamDept, "assistants");
    assert.equal(state.teamQ, "ROA");
    const query = logic.buildListQueryString({
      view: "teams",
      entity: "clients",
      teamDept: "assistants",
      teamExpand: [logic.ASSISTANTS_DEPT_EXPAND_TOKEN],
      page: 1,
    });
    assert.match(query, /teamDept=assistants/);
    assert.match(query, /teamExpand=__assistants_dept__/);
  });
});
