import assert from "node:assert/strict";
import { describe, it } from "node:test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("../../public/clients-teams-compact.js");

const merge = (
  globalThis as typeof globalThis & {
    ClientsTeamsCompact: { mergeResponsiblesByEmployee: (items: unknown[]) => unknown[] };
  }
).ClientsTeamsCompact.mergeResponsiblesByEmployee;

describe("clients teams compact merge", () => {
  it("merges multiple assignment kinds for one employee", () => {
    const merged = merge([
      {
        kind: "manager",
        employeeGuid: "55555555-5555-4555-8555-555555555555",
        name: "Regional One",
        clientCount: 1,
        outletCount: 0,
      },
      {
        kind: "regional",
        employeeGuid: "55555555-5555-4555-8555-555555555555",
        name: "Regional One",
        clientCount: 1,
        outletCount: 0,
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].assignments.length, 2);
  });
});
