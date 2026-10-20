import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyAuthoritativeTeamDeclaration,
  isAuthoritativeFlatEmptyTeam,
} from "../../src/onec-clients/roster-flat-org";
import { validateAuthoritativeOrgRoster } from "../../src/onec-clients/roster-authoritative-org";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { resolveEmployeeTeamMemberships } from "../../src/onec-clients/roster-team-memberships";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";
import {
  buildFlatOrgHierarchyRosterBytes,
  buildFullFlatOrgHierarchyRosterBytes,
  FLAT_ORG,
  FLAT_ORG_APEX_TEAM_LEADER_GUIDS,
  FLAT_ORG_GUSLEVA_MEMBER_GUIDS,
  FULL_FLAT_ORG_EXPECTED,
} from "../helpers/flat-org-hierarchy-fixtures";

const MANAGER = "22222222-2222-4222-8222-222222222222";
const TEAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEADER = "44444444-4444-4444-8444-444444444444";

function parseRoster(bytes: Buffer) {
  const parsed = parseWholesaleEmployeeRosterBytes(bytes);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    throw new Error("parse failed");
  }
  return parsed.roster;
}

function expectFlatValidationFails(bytes: Buffer, code: string) {
  const roster = parseRoster(bytes);
  const validation = validateAuthoritativeOrgRoster(roster);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(validation.code, code);
}

describe("flat org team declaration classifier", () => {
  it("classifies explicit flat empty team as apex-style membership clear", () => {
    const roster = parseRoster(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(FLAT_ORG.APEX, {
          guid_team: null,
          name_team: null,
          guid_team_leader: null,
          name_team_leader: null,
        }),
      ]),
    );
    const record = roster.records[0]!;
    assert.equal(classifyAuthoritativeTeamDeclaration(record), "flat_empty");
    assert.equal(isAuthoritativeFlatEmptyTeam(record), true);
    assert.deepEqual(resolveEmployeeTeamMemberships(record, []), []);
  });

  it("accepts apex with explicit empty strings on all four flat keys", () => {
    const roster = parseRoster(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(FLAT_ORG.APEX, {
          guid_team: "",
          name_team: "",
          guid_team_leader: "",
          name_team_leader: "",
        }),
      ]),
    );
    const validation = validateAuthoritativeOrgRoster(roster);
    assert.equal(validation.ok, true);
  });

  it("treats missing flat keys as undeclared, not empty apex", () => {
    const roster = parseRoster(buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER)]));
    const record = roster.records[0]!;
    assert.equal(classifyAuthoritativeTeamDeclaration(record), "flat_undeclared");
    const validation = validateAuthoritativeOrgRoster(roster);
    assert.equal(validation.ok, false);
    if (validation.ok) return;
    assert.equal(validation.code, "FLAT_MEMBERSHIP_UNDECLARED");
  });

  it("classifies flat member when all four keys are present", () => {
    const roster = parseRoster(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, {
          guid_team: TEAM,
          name_team: "Alpha",
          guid_team_leader: LEADER,
          name_team_leader: "Leader",
        }),
        buildEmployeeRosterEntry(LEADER, {
          guid_team: null,
          name_team: null,
          guid_team_leader: null,
          name_team_leader: null,
        }),
      ]),
    );
    assert.equal(classifyAuthoritativeTeamDeclaration(roster.records[0]!), "flat_member");
    const validation = validateAuthoritativeOrgRoster(roster);
    assert.equal(validation.ok, true);
  });

  it("prefers team[] when both team[] and flat fields are present", () => {
    const roster = parseRoster(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, {
          guid_team: TEAM,
          name_team: "Flat Name",
          guid_team_leader: LEADER,
          name_team_leader: "Leader",
          team: [],
        }),
      ]),
    );
    assert.equal(classifyAuthoritativeTeamDeclaration(roster.records[0]!), "team_array");
    assert.deepEqual(resolveEmployeeTeamMemberships(roster.records[0]!, []), []);
  });
});

describe("strict authoritative flat field validation", () => {
  const baseMember = {
    guid_team: TEAM,
    name_team: "Synthetic team",
  };

  it("rejects non-uuid guid_team_leader", () => {
    expectFlatValidationFails(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, {
          ...baseMember,
          guid_team_leader: "not-a-guid",
          name_team_leader: "Invalid leader",
        }),
        buildEmployeeRosterEntry(LEADER, {
          guid_team: null,
          name_team: null,
          guid_team_leader: null,
          name_team_leader: null,
        }),
      ]),
      "FLAT_TEAM_FIELD_INVALID_UUID",
    );
  });

  it("rejects empty guid_team_leader with valid guid_team", () => {
    expectFlatValidationFails(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, {
          ...baseMember,
          guid_team_leader: "",
          name_team_leader: "",
        }),
      ]),
      "FLAT_TEAM_FIELDS_INCONSISTENT",
    );
  });

  it("rejects residual team metadata on apex-style empty guid_team", () => {
    expectFlatValidationFails(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, {
          guid_team: "",
          name_team: "Residual team",
          guid_team_leader: FLAT_ORG.APEX,
          name_team_leader: "Synthetic apex",
        }),
      ]),
      "FLAT_TEAM_FIELDS_INCONSISTENT",
    );
  });

  it("rejects invalid types for flat leader fields", () => {
    expectFlatValidationFails(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, {
          ...baseMember,
          guid_team_leader: 123 as unknown as string,
          name_team_leader: { bad: true } as unknown as string,
        }),
      ]),
      "FLAT_TEAM_FIELD_INVALID_TYPE",
    );
  });
});

describe("flat authoritative org snapshot validation", () => {
  it("accepts mini hierarchy with Gusleva team independent of post", () => {
    const roster = parseRoster(buildFlatOrgHierarchyRosterBytes());
    assert.equal(roster.records.length, FULL_FLAT_ORG_EXPECTED.miniEmployeeCount);
    const validation = validateAuthoritativeOrgRoster(roster);
    assert.equal(validation.ok, true);
    if (!validation.ok) return;
    assert.equal(validation.teamGroupCount, FULL_FLAT_ORG_EXPECTED.miniTeamGroupCount);
    assert.equal(validation.membershipCount, FULL_FLAT_ORG_EXPECTED.miniMembershipCount);
    const guslevaTeamMembers = roster.records.filter(
      (r) => r.guidTeam?.toLowerCase() === FLAT_ORG.TEAM_GUSLEVA.toLowerCase(),
    );
    assert.equal(guslevaTeamMembers.length, FLAT_ORG_GUSLEVA_MEMBER_GUIDS.length);
    assert.ok(
      !guslevaTeamMembers.some((r) => r.guidManager.toLowerCase() === FLAT_ORG.GUSLEVA.toLowerCase()),
    );
  });

  it("accepts full 40-employee flat hierarchy counts", () => {
    const roster = parseRoster(buildFullFlatOrgHierarchyRosterBytes());
    assert.equal(roster.wholesaleCount, FULL_FLAT_ORG_EXPECTED.employeeCount);
    const validation = validateAuthoritativeOrgRoster(roster);
    assert.equal(validation.ok, true);
    if (!validation.ok) return;
    assert.equal(validation.teamGroupCount, FULL_FLAT_ORG_EXPECTED.teamGroupCount);
    assert.equal(validation.membershipCount, FULL_FLAT_ORG_EXPECTED.membershipCount);
    const apex = roster.records.find((r) => r.guidManager.toLowerCase() === FLAT_ORG.APEX.toLowerCase());
    assert.ok(apex);
    assert.deepEqual(resolveEmployeeTeamMemberships(apex!, []), []);
    const apexTeamMembers = roster.records.filter(
      (r) => r.guidTeam?.toLowerCase() === FLAT_ORG.TEAM_APEX.toLowerCase(),
    );
    assert.equal(apexTeamMembers.length, FLAT_ORG_APEX_TEAM_LEADER_GUIDS.length);
    for (const leaderGuid of FLAT_ORG_APEX_TEAM_LEADER_GUIDS) {
      assert.ok(
        !roster.records.some(
          (r) =>
            r.guidManager.toLowerCase() === leaderGuid.toLowerCase() &&
            r.guidTeam?.toLowerCase() === r.guidManager.toLowerCase(),
        ),
        `leader ${leaderGuid} must not self-member own team`,
      );
    }
  });
});
