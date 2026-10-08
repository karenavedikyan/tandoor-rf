import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import {
  resolveRosterFieldValues,
  rosterRecordValuesEqual,
} from "../../src/onec-clients/roster-field-values";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";

const MANAGER = "22222222-2222-4222-8222-222222222222";
const POST_A = "66666666-6666-4666-8666-666666666666";
const POST_B = "77777777-7777-4777-8777-777777777777";
const SCHEDULE_A = "88888888-8888-4888-8888-888888888888";
const SCHEDULE_B = "99999999-9999-4999-8999-999999999999";

describe("roster field values", () => {
  it("detects guid_post change using snake_case raw keys", () => {
    const initial = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, { guid_post: POST_A }),
      ]),
    );
    assert.equal(initial.ok, true);
    if (!initial.ok) return;

    const updated = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, { guid_post: POST_B }),
      ]),
    );
    assert.equal(updated.ok, true);
    if (!updated.ok) return;

    const existing = {
      guid_manager: MANAGER,
      name_manager: "Manager",
      guid_post: POST_A,
      post: "Менеджер ОПТ",
      guid_team: null,
      name_team: null,
      condition: "active",
      date_of_assumption: "2024-01-01T12:00:00.000Z",
      guid_work_schedule: SCHEDULE_A,
      work_schedule: "5/2",
      decree: "",
      email: "a@test.local",
      telephone: "+79990000001",
      raw_json: {},
    };

    assert.equal(rosterRecordValuesEqual(existing, updated.roster.records[0]!), false);
  });

  it("detects work_schedule and date_of_assumption changes with normalized dates", () => {
    const existing = {
      guid_manager: MANAGER,
      name_manager: "Manager",
      guid_post: POST_A,
      post: "Менеджер ОПТ",
      guid_team: null,
      name_team: null,
      condition: "active",
      date_of_assumption: "2024-01-01 12:00:00+00",
      guid_work_schedule: SCHEDULE_A,
      work_schedule: "5/2",
      decree: "",
      email: null,
      telephone: null,
      raw_json: {},
    };

    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, {
          guid_work_schedule: SCHEDULE_B,
          work_schedule: "2/2",
          date_of_assumption: "05.10.2026",
        }),
      ]),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.equal(rosterRecordValuesEqual(existing, parsed.roster.records[0]!), false);
    const values = resolveRosterFieldValues(parsed.roster.records[0]!, existing);
    assert.equal(values.workSchedule, "2/2");
    assert.equal(values.guidWorkSchedule, SCHEDULE_B);
    assert.equal(values.dateOfAssumption, "2026-10-05T12:00:00.000Z");
  });
});

describe("employee roster strict field validation", () => {
  it("rejects invalid calendar date instead of coercing to null", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, { date_of_assumption: "31.02.2026" }),
      ]),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.code, "INVALID_FIELD_FORMAT");
    assert.equal(parsed.fieldIssues?.[0]?.field, "date_of_assumption");
  });

  it("rejects invalid optional guid when field is present", () => {
    const parsed = parseWholesaleEmployeeRosterBytes(
      buildEmployeeRosterBytes([
        buildEmployeeRosterEntry(MANAGER, { guid_post: "not-a-uuid" }),
      ]),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.code, "INVALID_FIELD_FORMAT");
    assert.equal(parsed.fieldIssues?.[0]?.field, "guid_post");
  });
});
