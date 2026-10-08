import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import {
  incomingTeamEntriesForRecord,
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
