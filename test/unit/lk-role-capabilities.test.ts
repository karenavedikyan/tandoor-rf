import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccessContext } from "../../src/access/types";
import {
  isLkAdminRole,
  isTanTrackerParticipantRole,
  lkCanAuthorAssignment,
  lkCanCoordinatorAssignmentDecisions,
  lkCanReadAssignmentActivity,
  lkCanReadAssignmentReviewsOverview,
  lkCanSubmitAssignmentReview,
  lkCanWriteTanTracker,
} from "../../src/shared/lk-role-capabilities";
import { tanTrackerCanWrite } from "../../src/tan-tracker/guards";

const baseAccess = (preview: AccessContext["preview"]): AccessContext => ({
  userId: "a",
  role: "admin",
  status: "active",
  employeeId: null,
  hasEmployeeLink: false,
  hasScopedClientAccess: true,
  fullClientBase: true,
  employeeLinkConflict: false,
  explicitlyDeniedAll: false,
  preview,
});

describe("LK admin capability policy", () => {
  it("admin is distinct from business roles", () => {
    assert.equal(isLkAdminRole("admin"), true);
    assert.equal(isLkAdminRole("director"), false);
  });

  it("admin assignment author/coordinator/read surfaces", () => {
    assert.equal(lkCanAuthorAssignment("admin", "a1", "m1"), true);
    assert.equal(lkCanAuthorAssignment("manager", "m1", "m1"), true);
    assert.equal(lkCanAuthorAssignment("manager", "m2", "m1"), false);
    assert.equal(lkCanCoordinatorAssignmentDecisions("admin"), true);
    assert.equal(lkCanCoordinatorAssignmentDecisions("director"), false);
    assert.equal(lkCanReadAssignmentActivity("admin"), true);
    assert.equal(lkCanReadAssignmentReviewsOverview("admin"), true);
    assert.equal(lkCanSubmitAssignmentReview("admin"), false);
    assert.equal(lkCanSubmitAssignmentReview("manager"), true);
  });

  it("admin may write Tan-tracker outside preview mode", () => {
    assert.equal(lkCanWriteTanTracker("admin"), true);
    assert.equal(
      tanTrackerCanWrite(
        {
          id: "a",
          role: "admin",
          email: "a@t",
          fullName: "A",
          phone: null,
          status: "active",
          lastLoginAt: null,
        },
        baseAccess(undefined),
      ),
      true,
    );
  });

  it("preview read-only blocks admin Tan-tracker writes", () => {
    assert.equal(
      tanTrackerCanWrite(
        {
          id: "a",
          role: "admin",
          email: "a@t",
          fullName: "A",
          phone: null,
          status: "active",
          lastLoginAt: null,
        },
        baseAccess({
          active: true,
          readOnly: true,
          actorUserId: "a",
          targetUserId: "x",
          targetUser: {
            id: "x",
            role: "manager",
            email: "x@t",
            fullName: "X",
            phone: null,
            status: "active",
            lastLoginAt: null,
          },
        }),
      ),
      false,
    );
  });

  it("marketer remains excluded from Tan-tracker participant roles", () => {
    assert.equal(isTanTrackerParticipantRole("marketer"), false);
    assert.equal(isTanTrackerParticipantRole("manager"), true);
  });
});
