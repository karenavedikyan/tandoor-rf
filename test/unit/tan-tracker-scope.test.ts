import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canViewOrder } from "../../src/tan-tracker/scope";
import type { TanTrackerContactDto, TanTrackerOrderDto, TanTrackerScopeContext } from "../../src/tan-tracker/types";

const baseOrder: TanTrackerOrderDto = {
  id: "TT-2026-001",
  item: "Test",
  holderId: "h1",
  pendingId: "p1",
  status: "waiting",
  dueAt: null,
  comment: "",
  holderSince: Date.now(),
  timeline: [],
  finalRecipientId: "p1",
};

describe("tan-tracker scope", () => {
  it("admin does not see orders by default", () => {
    const ctx: TanTrackerScopeContext = {
      userId: "u0",
      role: "admin",
      employeeId: null,
      actorPartyId: "x",
      previewReadOnly: false,
    };
    assert.equal(canViewOrder(baseOrder, ctx, [], null, false), false);
  });

  it("director sees any order", () => {
    const ctx: TanTrackerScopeContext = {
      userId: "u1",
      role: "director",
      employeeId: "e1",
      actorPartyId: "x",
      previewReadOnly: false,
    };
    assert.equal(canViewOrder(baseOrder, ctx, [], null, false), true);
  });

  it("holder sees own order", () => {
    const ctx: TanTrackerScopeContext = {
      userId: "u2",
      role: "manager",
      employeeId: "e2",
      actorPartyId: "h1",
      previewReadOnly: false,
    };
    const contacts: TanTrackerContactDto[] = [];
    assert.equal(canViewOrder(baseOrder, ctx, contacts, null, false), true);
  });

  it("unrelated manager cannot see order", () => {
    const ctx: TanTrackerScopeContext = {
      userId: "u3",
      role: "manager",
      employeeId: "e3",
      actorPartyId: "other",
      previewReadOnly: false,
    };
    assert.equal(canViewOrder(baseOrder, ctx, [], null, false), false);
  });
});
