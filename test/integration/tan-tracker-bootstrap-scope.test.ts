import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { buildTanTrackerBootstrap } from "../../src/tan-tracker/service";
import type { AccessContext } from "../../src/access/types";
import type { UserDto } from "../../src/shared/user";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { getPool } from "../../src/db/pool";

const databaseUrl = getIntegrationDatabaseUrl();

function accessFor(userId: string, role: string, employeeId: string | null): AccessContext {
  return {
    userId,
    role: role as AccessContext["role"],
    status: "active",
    employeeId,
    employeeLinkConflict: false,
    hasEmployeeLink: !!employeeId,
    hasScopedClientAccess: true,
    fullClientBase: false,
    explicitlyDeniedAll: false,
  };
}

function userDto(id: string, role: string, name: string): UserDto {
  return {
    id,
    email: `${role}-${id.slice(0, 8)}@test.local`,
    fullName: name,
    role: role as UserDto["role"],
    phone: "+79990001122",
    mustChangePassword: false,
  };
}

describe("tan-tracker bootstrap contact scope", () => {
  before(async () => {
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    const pool = getPool();
    await pool?.end();
  });

  it("does not leak another manager's external contact", async () => {
    const pool = getPool();
    assert.ok(pool);
    const m1 = await createTestUser({
      databaseUrl,
      email: "m1@test.local",
      password: "x",
      fullName: "Manager One",
      role: "manager",
    });
    const m2 = await createTestUser({
      databaseUrl,
      email: "m2@test.local",
      password: "x",
      fullName: "Manager Two",
      role: "manager",
    });
    const client = await pool.connect();
    try {
      await ensurePartyForUserOnWrite(client, m1.id, "Manager One", "+79991111111");
      await ensurePartyForUserOnWrite(client, m2.id, "Manager Two", "+79992222222");
      await client.query(
        `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
         VALUES ('external', 'Secret Client', '+79993333333', $1::uuid)`,
        [m2.id],
      );
    } finally {
      client.release();
    }

    const bootstrap = await buildTanTrackerBootstrap(
      userDto(m1.id, "manager", "Manager One"),
      accessFor(m1.id, "manager", null),
    );
    const leaked = bootstrap.contacts.find((c) => c.phone === "+79993333333");
    assert.equal(leaked, undefined, "manager1 must not see manager2-only external contact");
  });
});
