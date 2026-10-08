import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOnecTeamGroups,
  filterOnecTeamGroups,
  ONEC_TEAM_UNDEFINED_KEY,
} from "../../src/clients/org/onec-teams-repository";

const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";

describe("onec team groups", () => {
  it("keeps same display names as separate groups by guid_team", () => {
    const groups = buildOnecTeamGroups(
      [
        {
          employee_guid: M1,
          name: "Alpha",
          post: "Менеджер",
          team_guid: TEAM_A,
          name_team: "Sales Team",
        },
        {
          employee_guid: M2,
          name: "Beta",
          post: "Менеджер",
          team_guid: TEAM_B,
          name_team: "Sales Team",
        },
      ],
      new Set(),
    );
    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.displayName, "Sales Team");
    assert.equal(groups[1]?.displayName, "Sales Team");
    assert.notEqual(groups[0]?.teamGuid, groups[1]?.teamGuid);
  });

  it("marks conflicting names for one guid_team", () => {
    const groups = buildOnecTeamGroups(
      [
        {
          employee_guid: M1,
          name: "One",
          post: "Менеджер",
          team_guid: TEAM_A,
          name_team: "Alpha",
        },
        {
          employee_guid: M2,
          name: "Two",
          post: "Менеджер",
          team_guid: TEAM_A,
          name_team: "Beta",
        },
      ],
      new Set(),
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.nameStatus, "needs_clarification");
    assert.equal(groups[0]?.displayName, "Название требует уточнения в 1С");
  });

  it("filters by selected group and search as AND", () => {
    const groups = buildOnecTeamGroups(
      [
        {
          employee_guid: M1,
          name: "Ivan Alpha",
          post: "Менеджер",
          team_guid: TEAM_A,
          name_team: "Team Alpha",
        },
        {
          employee_guid: M2,
          name: "Petr Beta",
          post: "Менеджер",
          team_guid: TEAM_A,
          name_team: "Team Alpha",
        },
        {
          employee_guid: M3,
          name: "Sidor Gamma",
          post: "Менеджер",
          team_guid: TEAM_B,
          name_team: "Team Beta",
        },
      ],
      new Set(),
    );
    const filtered = filterOnecTeamGroups(groups, { q: "ivan", onecTeam: TEAM_A });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.members.length, 1);
    assert.equal(filtered[0]?.members[0]?.name, "Ivan Alpha");
  });

  it("returns full group when group name matches search", () => {
    const groups = buildOnecTeamGroups(
      [
        {
          employee_guid: M1,
          name: "Ivan Alpha",
          post: "Менеджер",
          team_guid: TEAM_A,
          name_team: "Team Alpha",
        },
        {
          employee_guid: M2,
          name: "Petr Beta",
          post: "Менеджер",
          team_guid: TEAM_A,
          name_team: "Team Alpha",
        },
      ],
      new Set(),
    );
    const filtered = filterOnecTeamGroups(groups, { q: "team alpha" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.members.length, 2);
  });

  it("places employees without guid_team into undefined bucket", () => {
    const groups = buildOnecTeamGroups(
      [
        {
          employee_guid: M3,
          name: "No Team",
          post: "Менеджер",
          team_guid: null,
          name_team: null,
        },
      ],
      new Set(),
    );
    const undefinedGroup = groups.find((group) => group.teamGuid === null);
    assert.ok(undefinedGroup);
    assert.equal(undefinedGroup.displayName, "Группа не определена");
    assert.equal(undefinedGroup.members[0]?.employeeGuid, M3);
  });

  it("supports undefined bucket filter token", () => {
    const groups = buildOnecTeamGroups(
      [
        {
          employee_guid: M1,
          name: "In Team",
          post: "Менеджер",
          team_guid: TEAM_A,
          name_team: "Team Alpha",
        },
        {
          employee_guid: M3,
          name: "No Team",
          post: "Менеджер",
          team_guid: null,
          name_team: null,
        },
      ],
      new Set(),
    );
    const filtered = filterOnecTeamGroups(groups, { onecTeam: ONEC_TEAM_UNDEFINED_KEY });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.teamGuid, null);
  });
});
