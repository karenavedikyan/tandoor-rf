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

describe("flat authoritative org snapshot validation", () => {
  it("accepts mini hierarchy with Gusleva team independent of post", () => {
    const roster = parseRoster(buildFlatOrgHierarchyRosterBytes());
    assert.equal(roster.records.length, 8);
    const validation = validateAuthoritativeOrgRoster(roster);
    assert.equal(validation.ok, true);
    if (!validation.ok) return;
    assert.equal(validation.teamGroupCount, 2);
    assert.equal(validation.membershipCount, 7);
    const guslevaMembers = roster.records.filter(
      (r) => r.guidTeam?.toLowerCase() === FLAT_ORG.TEAM_GUSLEVA.toLowerCase(),
    );
    assert.equal(guslevaMembers.length, 5);
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
  });
});
