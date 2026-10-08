import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import {
  buildEmployeeRosterBytes,
  buildEmployeeRosterEntry,
} from "../helpers/onec-clients-employee-roster-fixtures";
import { EXTENDED_FIXTURE_GUIDS } from "../helpers/onec-clients-extended-fixtures";

/** Documents accepted roster contract for G3 — leader linkage is not implemented yet. */
describe("onec employee roster G3 contract guard", () => {
  it("parses guid_team membership fields only (no team leader field in model)", () => {
    const teamGuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const bytes = buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.MANAGER_A, {
        guid_team: teamGuid,
        name_team: "Group A",
      }),
    ]);
    const parsed = parseWholesaleEmployeeRosterBytes(bytes);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const record = parsed.roster.records[0];
    assert.equal(record.guidTeam, teamGuid);
    assert.equal(record.nameTeam, "Group A");
    assert.equal("guidTeamLeader" in record, false);
    assert.equal("isTeamLeader" in record, false);
  });

  it("preserves unknown roster keys in raw_json without promoting team leader to typed fields", () => {
    const bytes = buildEmployeeRosterBytes([
      {
        ...buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.MANAGER_A, {
          guid_team: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
        guid_team_leader: EXTENDED_FIXTURE_GUIDS.MANAGER_B,
        is_team_leader: true,
      } as ReturnType<typeof buildEmployeeRosterEntry> & {
        guid_team_leader: string;
        is_team_leader: boolean;
      },
    ]);
    const parsed = parseWholesaleEmployeeRosterBytes(bytes);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const raw = parsed.roster.records[0].raw;
    assert.equal(raw.guid_team_leader, EXTENDED_FIXTURE_GUIDS.MANAGER_B);
    assert.equal(raw.is_team_leader, true);
    assert.equal(parsed.roster.records[0].guidTeam, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});
