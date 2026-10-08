import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterOnecTeamGroups,
  ONEC_TEAM_UNDEFINED_KEY,
  type OrgOnecTeamGroup,
} from "../../src/clients/org/onec-teams-repository";

const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEADER = "44444444-4444-4444-8444-444444444444";

function sampleGroup(overrides: Partial<OrgOnecTeamGroup>): OrgOnecTeamGroup {
  return {
    teamGuid: TEAM_A,
    displayName: "Team Alpha",
    nameStatus: "ok",
    memberCount: 1,
    uniqueClientCount: 0,
    uniqueOutletCount: 0,
    leader: null,
    members: [],
    ...overrides,
  };
}

describe("onec team groups filters", () => {
  it("filters by selected group and search as AND", () => {
    const groups: OrgOnecTeamGroup[] = [
      sampleGroup({
        members: [
          {
            employeeGuid: "11111111-1111-4111-8111-111111111111",
            name: "Ivan Alpha",
            shortId: "1111",
            rosterPost: "Менеджер",
            hasLinkedAccount: true,
            clientCount: 1,
            outletCount: 0,
          },
          {
            employeeGuid: "22222222-2222-4222-8222-222222222222",
            name: "Petr Beta",
            shortId: "2222",
            rosterPost: "Менеджер",
            hasLinkedAccount: false,
            clientCount: 0,
            outletCount: 0,
          },
        ],
        memberCount: 2,
      }),
      sampleGroup({
        teamGuid: TEAM_B,
        displayName: "Team Beta",
        members: [
          {
            employeeGuid: "33333333-3333-4333-8333-333333333333",
            name: "Sidor Gamma",
            shortId: "3333",
            rosterPost: "Менеджер",
            hasLinkedAccount: false,
            clientCount: 0,
            outletCount: 0,
          },
        ],
        memberCount: 1,
      }),
    ];
    const filtered = filterOnecTeamGroups(groups, { q: "ivan", onecTeam: TEAM_A });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.members.length, 1);
  });

  it("does not add external leader to memberCount on member-only search", () => {
    const groups = [
      sampleGroup({
        leader: {
          employeeGuid: LEADER,
          name: "External Leader",
          shortId: "4444",
          hasLinkedAccount: true,
          status: "ok",
        },
        members: [
          {
            employeeGuid: "11111111-1111-4111-8111-111111111111",
            name: "Member One",
            shortId: "1111",
            rosterPost: "Менеджер",
            hasLinkedAccount: true,
            clientCount: 0,
            outletCount: 0,
          },
        ],
        memberCount: 2,
      }),
    ];
    const filtered = filterOnecTeamGroups(groups, { q: "member" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.memberCount, 1);
  });

  it("matches leader in search without duplicating in members", () => {
    const groups = [
      sampleGroup({
        leader: {
          employeeGuid: LEADER,
          name: "Team Leader",
          shortId: "4444",
          hasLinkedAccount: true,
          status: "ok",
        },
        members: [
          {
            employeeGuid: "11111111-1111-4111-8111-111111111111",
            name: "Member",
            shortId: "1111",
            rosterPost: "Менеджер",
            hasLinkedAccount: true,
            clientCount: 0,
            outletCount: 0,
          },
        ],
        memberCount: 2,
      }),
    ];
    const filtered = filterOnecTeamGroups(groups, { q: "leader" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.members.length, 1);
  });

  it("supports undefined bucket filter token", () => {
    const groups = [
      sampleGroup({ teamGuid: null, displayName: "Без группы", nameStatus: "undefined" }),
      sampleGroup({ teamGuid: TEAM_B, displayName: "Team Beta" }),
    ];
    const filtered = filterOnecTeamGroups(groups, { onecTeam: ONEC_TEAM_UNDEFINED_KEY });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.teamGuid, null);
  });
});
