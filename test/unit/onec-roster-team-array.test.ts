import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import {
  detectIntraEmployeeTeamLeaderConflicts,
  incomingTeamEntriesForRecord,
  parseEmployeeTeamArray,
  resolveEmployeeTeamMemberships,
} from "../../src/onec-clients/roster-team-memberships";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";

const MANAGER = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "33333333-3333-4333-8333-333333333333";
const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEADER = "44444444-4444-4444-8444-444444444444";

describe("onec roster team[] parser", () => {
  it("supports multiple groups per employee", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, {
          team: [
            { guid_team: TEAM_A, name_team: "Alpha" },
            { guid_team: TEAM_B, name_team: "Beta" },
          ],
        }),
      ]),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const entries = incomingTeamEntriesForRecord(parsed.roster.records[0]!);
    assert.equal(entries.entries.length, 2);
  });

  it("clears memberships on explicit empty team array", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER, { team: [] })]),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const resolved = resolveEmployeeTeamMemberships(parsed.roster.records[0]!, [
      { guid_team: TEAM_A, name_team: "Alpha" },
    ]);
    assert.equal(resolved.length, 0);
  });

  it("rejects invalid team type before apply semantics", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, { team: null } as unknown as { team: [] }),
      ]),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.code, "INVALID_FIELD_FORMAT");
  });

  it("rejects intra-employee leader conflict before team[] dedupe", () => {
    const leaderB = "55555555-5555-4555-8555-555555555555";
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, {
          team: [
            { guid_team: TEAM_A, guid_team_leader: LEADER },
            { guid_team: TEAM_A, guid_team_leader: leaderB },
          ],
        }),
      ]),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.code, "TEAM_LEADER_CONFLICT");
  });

  it("detects intra-employee leader conflict independent of team[] order", () => {
    const leaderB = "55555555-5555-4555-8555-555555555555";
    const forward = [
      { guidTeam: TEAM_A, nameTeam: null, guidTeamLeader: LEADER, nameTeamLeader: null },
      { guidTeam: TEAM_A, nameTeam: null, guidTeamLeader: leaderB, nameTeamLeader: null },
    ];
    const reverse = [...forward].reverse();
    assert.equal(detectIntraEmployeeTeamLeaderConflicts(forward).length, 1);
    assert.equal(detectIntraEmployeeTeamLeaderConflicts(reverse).length, 1);
  });

  it("dedupes identical team[] entries and treats zero leader uuid as absent", () => {
    const issues: Array<{ field: string; code: string }> = [];
    const parsed = parseEmployeeTeamArray(
      {
        team: [
          { guid_team: TEAM_A, name_team: "Alpha", guid_team_leader: LEADER },
          { guid_team: TEAM_A, name_team: "Alpha", guid_team_leader: LEADER },
        ],
      },
      issues,
    );
    assert.equal(issues.length, 0);
    assert.ok(Array.isArray(parsed));
    if (!Array.isArray(parsed)) return;
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.guidTeamLeader, LEADER);

    const zeroIssues: Array<{ field: string; code: string }> = [];
    const zeroLeader = parseEmployeeTeamArray(
      {
        team: [{ guid_team: TEAM_A, guid_team_leader: "00000000-0000-0000-0000-000000000000" }],
      },
      zeroIssues,
    );
    assert.equal(zeroIssues.length, 0);
    assert.ok(Array.isArray(zeroLeader));
    if (!Array.isArray(zeroLeader)) return;
    assert.equal(zeroLeader[0]?.guidTeamLeader, null);

    const invalidIssues: Array<{ field: string; code: string }> = [];
    const invalid = parseEmployeeTeamArray(
      { team: [{ guid_team: TEAM_A, guid_team_leader: "not-a-uuid" }] },
      invalidIssues,
    );
    assert.equal(invalidIssues.some((issue) => issue.code === "INVALID_UUID"), true);
    assert.ok(Array.isArray(invalid));
    if (!Array.isArray(invalid)) return;
    assert.equal(invalid[0]?.guidTeamLeader, null);
  });

  it("clears legacy memberships on explicit guid_team null without team[] key", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER, { guid_team: null, name_team: null })]),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const resolved = resolveEmployeeTeamMemberships(parsed.roster.records[0]!, [
      { guid_team: TEAM_A, name_team: "Alpha" },
    ]);
    assert.equal(resolved.length, 0);
  });

  it("preserves memberships on legacy name_team rename without guid_team", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER, { name_team: "Renamed Team" })]),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const resolved = resolveEmployeeTeamMemberships(parsed.roster.records[0]!, [
      { guid_team: TEAM_A, name_team: "Alpha" },
    ]);
    assert.deepEqual(resolved, [{ guidTeam: TEAM_A, nameTeam: "Renamed Team" }]);
  });

  it("preserves memberships when legacy team fields are omitted", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER, {})]),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const resolved = resolveEmployeeTeamMemberships(parsed.roster.records[0]!, [
      { guid_team: TEAM_A, name_team: "Alpha" },
    ]);
    assert.deepEqual(resolved.map((item) => item.guidTeam), [TEAM_A]);
  });

  it("rejects conflicting leader guids for one team", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, {
          team: [{ guid_team: TEAM_A, guid_team_leader: LEADER }],
        }),
        buildEmployeeRosterEntry(MANAGER_B, {
          team: [{ guid_team: TEAM_A, guid_team_leader: "55555555-5555-4555-8555-555555555555" }],
        }),
      ]),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.code, "TEAM_LEADER_CONFLICT");
  });

  it("prefers explicit team[] over legacy guid_team", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, {
          guid_team: TEAM_B,
          name_team: "Legacy",
          team: [{ guid_team: TEAM_A, name_team: "Alpha" }],
        }),
      ]),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const resolved = resolveEmployeeTeamMemberships(parsed.roster.records[0]!, undefined);
    assert.deepEqual(resolved.map((item) => item.guidTeam), [TEAM_A]);
  });
});
