import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import {
  resolveRosterFieldValues,
  resolveTeamFieldValues,
  rosterIncomingDiffersFromStored,
  rosterRecordValuesEqual,
} from "../../src/onec-clients/roster-field-values";
import type { WholesaleEmployeeRoster } from "../../src/onec-clients/employee-roster";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";

const MANAGER = "22222222-2222-4222-8222-222222222222";
const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const baseExisting = {
  guid_manager: MANAGER,
  name_manager: "Manager",
  guid_post: null,
  post: null,
  guid_team: TEAM_A,
  name_team: "Team Alpha",
  condition: null,
  date_of_assumption: null,
  guid_work_schedule: null,
  work_schedule: null,
  decree: null,
  email: null,
  telephone: null,
  raw_json: {},
};

describe("roster team field values", () => {
  it("assigns team A then replaces with team B without carrying old name", () => {
    const toB = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER, { guid_team: TEAM_B })]),
    );
    assert.equal(toB.ok, true);
    if (!toB.ok) return;

    const resolved = resolveRosterFieldValues(toB.roster.records[0]!, baseExisting);
    assert.equal(resolved.guidTeam, TEAM_B);
    assert.equal(resolved.nameTeam, null);
  });

  it("renames team when guid unchanged and only name_team provided", () => {
    const rename = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER, { name_team: "Team Alpha Renamed" })]),
    );
    assert.equal(rename.ok, true);
    if (!rename.ok) return;

    const resolved = resolveRosterFieldValues(rename.roster.records[0]!, baseExisting);
    assert.equal(resolved.guidTeam, TEAM_A);
    assert.equal(resolved.nameTeam, "Team Alpha Renamed");
  });

  it("preserves team when both fields omitted", () => {
    const partial = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER, { email: "new@test.local" })]),
    );
    assert.equal(partial.ok, true);
    if (!partial.ok) return;

    const resolved = resolveRosterFieldValues(partial.roster.records[0]!, baseExisting);
    assert.equal(resolved.guidTeam, TEAM_A);
    assert.equal(resolved.nameTeam, "Team Alpha");
  });

  it("clears team and name on explicit empty guid_team", () => {
    const cleared = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER, { guid_team: "" })]),
    );
    assert.equal(cleared.ok, true);
    if (!cleared.ok) return;

    const resolved = resolveRosterFieldValues(cleared.roster.records[0]!, baseExisting);
    assert.equal(resolved.guidTeam, null);
    assert.equal(resolved.nameTeam, null);
  });

  it("ignores name_team without existing guid_team membership", () => {
    const noTeam = { ...baseExisting, guid_team: null, name_team: null };
    const nameOnly = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER, { name_team: "Orphan Name" })]),
    );
    assert.equal(nameOnly.ok, true);
    if (!nameOnly.ok) return;

    const resolved = resolveTeamFieldValues(
      nameOnly.roster.records[0]!.raw,
      { guidTeam: nameOnly.roster.records[0]!.guidTeam, nameTeam: nameOnly.roster.records[0]!.nameTeam },
      noTeam,
    );
    assert.equal(resolved.guidTeam, null);
    assert.equal(resolved.nameTeam, null);
  });

  it("detects team change in rosterRecordValuesEqual", () => {
    const changed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER, { guid_team: TEAM_B, name_team: "Team Beta" })]),
    );
    assert.equal(changed.ok, true);
    if (!changed.ok) return;
    assert.equal(rosterRecordValuesEqual(baseExisting, changed.roster.records[0]!), false);
  });
});

describe("roster storage drift", () => {
  it("detects team backfill when columns are null but raw carries team fields", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([buildEmployeeRosterEntry(MANAGER, { guid_team: TEAM_A, name_team: "Team Alpha" })]),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const existing = new Map([
      [
        MANAGER,
        {
          ...baseExisting,
          guid_team: null,
          name_team: null,
        },
      ],
    ]);
    assert.equal(
      rosterIncomingDiffersFromStored(existing, new Map(), [], parsed.roster as WholesaleEmployeeRoster),
      true,
    );
  });

  it("does not drift when stored values already match effective team semantics", () => {
    const entry = buildEmployeeRosterEntry(MANAGER, { guid_team: TEAM_A, name_team: "Team Alpha" });
    const parsed = parseWholesaleEmployeeRosterBytes(buildEmployeeRosterBytes([entry]));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const record = parsed.roster.records[0]!;
    const resolved = resolveRosterFieldValues(record, undefined);
    const existing = new Map([
      [
        MANAGER,
        {
          guid_manager: MANAGER,
          name_manager: resolved.nameManager,
          guid_post: resolved.guidPost,
          post: resolved.post,
          guid_team: resolved.guidTeam,
          name_team: resolved.nameTeam,
          condition: resolved.condition,
          date_of_assumption: resolved.dateOfAssumption,
          guid_work_schedule: resolved.guidWorkSchedule,
          work_schedule: resolved.workSchedule,
          decree: resolved.decree,
          email: resolved.email,
          telephone: resolved.telephone,
          raw_json: record.raw,
        },
      ],
    ]);
    const memberships = new Map([
      [
        MANAGER,
        [{ guid_team: TEAM_A, name_team: "Team Alpha" }],
      ],
    ]);
    const groups = [
      {
        guid_team: TEAM_A,
        name_team: "Team Alpha",
        guid_team_leader: null,
        name_team_leader: null,
      },
    ];
    assert.equal(
      rosterIncomingDiffersFromStored(existing, memberships, groups, parsed.roster as WholesaleEmployeeRoster),
      false,
    );
  });
});

describe("employee roster team validation", () => {
  it("rejects zero uuid guid_team", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, { guid_team: "00000000-0000-0000-0000-000000000000" }),
      ]),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.code, "INVALID_FIELD_FORMAT");
    assert.equal(parsed.fieldIssues?.[0]?.field, "guid_team");
  });

  it("rejects invalid guid_team type", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, { guid_team: 123 } as Partial<import("../helpers/onec-clients-employee-roster-fixtures").SyntheticEmployeeRosterEntry>),
      ]),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.fieldIssues?.[0]?.field, "guid_team");
  });

  it("rejects invalid name_team type", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, { name_team: 42 } as Partial<import("../helpers/onec-clients-employee-roster-fixtures").SyntheticEmployeeRosterEntry>),
      ]),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.fieldIssues?.[0]?.field, "name_team");
  });
});
