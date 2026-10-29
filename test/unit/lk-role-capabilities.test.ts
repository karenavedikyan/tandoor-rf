import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLkAdminRole,
  isTanTrackerParticipantRole,
  lkAdminIncludesBusinessRole,
} from "../../src/shared/lk-role-capabilities";
import type { AccessContext } from "../../src/access/types";
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
  it("admin role is distinct from business roles", () => {
    assert.equal(isLkAdminRole("admin"), true);
    assert.equal(isLkAdminRole("director"), false);
    assert.equal(lkAdminIncludesBusinessRole("manager"), true);
  });

  it("admin may write Tan-tracker outside preview mode", () => {
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

  it("preview read-only blocks admin writes", () => {
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
