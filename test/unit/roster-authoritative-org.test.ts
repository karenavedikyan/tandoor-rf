import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateAuthoritativeOrgRoster,
  authoritativeOrgSnapshotEnabled,
} from "../../src/onec-clients/roster-authoritative-org";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";
import { parseAuthoritativeOrgCliArgs } from "../../src/onec-clients/authoritative-org-cli-args";

const MANAGER = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "33333333-3333-4333-8333-333333333333";
const LEADER = "44444444-4444-4444-8444-444444444444";
const LEADER_B = "55555555-5555-4555-8555-555555555555";
const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEAM_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function parseRoster(entries: Parameters<typeof buildEmployeeRosterBytes>[0]) {
  const parsed = parseWholesaleEmployeeRosterBytes(buildEmployeeRosterBytes(entries));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    throw new Error("fixture parse failed");
  }
  return parsed.roster;
}

describe("authoritative org roster validation", () => {
  it("rejects empty snapshot", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(buildEmployeeRosterBytes([]));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const result = validateAuthoritativeOrgRoster(parsed.roster);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "EMPTY_SNAPSHOT");
  });

  it("requires explicit team[] on every employee", () => {
    const roster = parseRoster([buildEmployeeRosterEntry(MANAGER)]);
    const result = validateAuthoritativeOrgRoster(roster);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "MISSING_TEAM_KEY");
  });

  it("accepts team: [] as full membership clear", () => {
    const roster = parseRoster([buildEmployeeRosterEntry(MANAGER, { team: [] })]);
    const result = validateAuthoritativeOrgRoster(roster);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.membershipCount, 0);
  });

  it("supports multi-team membership for one employee", () => {
    const roster = parseRoster([
      buildEmployeeRosterEntry(MANAGER, {
        team: [
          { guid_team: TEAM_A, name_team: "Alpha" },
          { guid_team: TEAM_B, name_team: "Beta" },
        ],
      }),
    ]);
    const result = validateAuthoritativeOrgRoster(roster);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.membershipCount, 2);
    assert.equal(result.teamGroupCount, 2);
  });

  it("does not merge groups with same name_team but different guid_team", () => {
    const roster = parseRoster([
      buildEmployeeRosterEntry(MANAGER, {
        team: [
          { guid_team: TEAM_A, name_team: "Sales" },
          { guid_team: TEAM_B, name_team: "Sales" },
        ],
      }),
    ]);
    const result = validateAuthoritativeOrgRoster(roster);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.teamGroupCount, 2);
  });

  it("rejects conflicting name_team for the same guid_team", () => {
    const roster = parseRoster([
      buildEmployeeRosterEntry(MANAGER, {
        team: [{ guid_team: TEAM_A, name_team: "Alpha", guid_team_leader: LEADER }],
      }),
      buildEmployeeRosterEntry(MANAGER_B, {
        team: [{ guid_team: TEAM_A, name_team: "Beta", guid_team_leader: LEADER }],
      }),
    ]);
    const result = validateAuthoritativeOrgRoster(roster);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "TEAM_NAME_CONFLICT");
  });

  it("rejects team leader absent from employee snapshot", () => {
    const roster = parseRoster([
      buildEmployeeRosterEntry(MANAGER, {
        team: [{ guid_team: TEAM_A, name_team: "Alpha", guid_team_leader: LEADER }],
      }),
    ]);
    const result = validateAuthoritativeOrgRoster(roster);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "MISSING_TEAM_LEADER_EMPLOYEE");
  });

  it("accepts leader defined later in file", () => {
    const roster = parseRoster([
      buildEmployeeRosterEntry(MANAGER, {
        team: [{ guid_team: TEAM_A, name_team: "Alpha", guid_team_leader: LEADER }],
      }),
      buildEmployeeRosterEntry(LEADER, {
        name_manager: "Team Leader",
        team: [],
      }),
    ]);
    const result = validateAuthoritativeOrgRoster(roster);
    assert.equal(result.ok, true);
  });

  it("rejects cross-employee leader conflict for one team", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, {
          team: [{ guid_team: TEAM_A, guid_team_leader: LEADER }],
        }),
        buildEmployeeRosterEntry(MANAGER_B, {
          team: [{ guid_team: TEAM_A, guid_team_leader: LEADER_B }],
        }),
        buildEmployeeRosterEntry(LEADER, { team: [] }),
        buildEmployeeRosterEntry(LEADER_B, { team: [] }),
      ]),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.code, "TEAM_LEADER_CONFLICT");
  });

  it("env flag gate is explicit", () => {
    assert.equal(authoritativeOrgSnapshotEnabled({ TANDOOR_WHOLESALE_ORG_AUTHORITATIVE_SNAPSHOT: "1" }), true);
    assert.equal(authoritativeOrgSnapshotEnabled({}), false);
  });
});

describe("authoritative org CLI args", () => {
  it("apply requires roster sha256 and target db fingerprint", () => {
    const parsed = parseAuthoritativeOrgCliArgs([
      "--apply",
      "--employee-roster",
      "/tmp/all_employees.json",
    ]);
    assert.equal(parsed.ok, false);
  });
});
