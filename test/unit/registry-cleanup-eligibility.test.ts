import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAdminForceDeleteTransfer,
  canShowDeleteBeforeReceipt,
  computeCanAdminDeleteTransferDto,
  computeCanDeleteBeforeReceiptDto,
} from "../../src/tan-tracker/registry-cleanup/eligibility";
import type { TanTrackerOrderDto } from "../../src/tan-tracker/types";

describe("registry cleanup eligibility", () => {
  it("canAdminForceDeleteTransfer allows technical admin", () => {
    const ok = canAdminForceDeleteTransfer({
      userId: "u1",
      role: "admin",
      partyId: "admin-party",
      previewReadOnly: false,
      isAdmin: true,
    });
    assert.equal(ok, true);
    assert.equal(
      computeCanAdminDeleteTransferDto({
        userId: "u1",
        role: "admin",
        partyId: "admin-party",
        previewReadOnly: false,
        isAdmin: true,
      }),
      true,
    );
  });

  it("canShowDeleteBeforeReceipt allows creator on waiting pending transfer", () => {
    const o = {
      id: "P1",
      createdById: "creator-party",
      status: "waiting",
      pendingId: "pending-party",
    } as TanTrackerOrderDto;
    const ok = canShowDeleteBeforeReceipt(
      o,
      { status: "waiting", first_custody_at: null },
      {
        userId: "u1",
        role: "manager",
        partyId: "creator-party",
        previewReadOnly: false,
        isAdmin: false,
      },
    );
    assert.equal(ok, true);
  });

  it("canShowDeleteBeforeReceipt denies after first_custody_at", () => {
    const o = { id: "P2", createdById: "c", status: "active" } as TanTrackerOrderDto;
    const ok = canShowDeleteBeforeReceipt(
      o,
      { status: "active", first_custody_at: new Date(), creator_party_id: "c" },
      {
        userId: "u1",
        role: "admin",
        partyId: "a",
        previewReadOnly: false,
        isAdmin: true,
      },
    );
    assert.equal(ok, false);
  });

  it("computeCanDeleteBeforeReceiptDto is false when legacy audit confirms custody", () => {
    const o = { id: "LEG1", createdById: "c", status: "active" } as TanTrackerOrderDto;
    const actor = {
      userId: "u1",
      role: "admin",
      partyId: "a",
      previewReadOnly: false,
      isAdmin: true,
    };
    const ok = computeCanDeleteBeforeReceiptDto(
      o,
      { id: "tt-leg-1", status: "active", first_custody_at: null },
      actor,
      new Set(["tt-leg-1"]),
    );
    assert.equal(ok, false);
  });
});
