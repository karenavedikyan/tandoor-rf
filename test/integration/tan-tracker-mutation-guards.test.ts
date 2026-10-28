import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getPool } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createTransferHandler } from "../../src/tan-tracker/mutations";
import type { AccessRequest } from "../../src/access/middleware";
import type { Response } from "express";

const databaseUrl = getIntegrationDatabaseUrl();

function mockRes(): { res: Response; out: { status: number; body: unknown } } {
  const out = { status: 200, body: null as unknown };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(payload: unknown) {
      out.body = payload;
      return res;
    },
  } as unknown as Response;
  return { res, out };
}

describe("tan-tracker mutation guards", () => {
  before(async () => {
    setIntegrationEnv(databaseUrl);
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await getPool()?.end();
  });

  it("rejects create with another manager's external contact", async () => {
    const pool = getPool();
    assert.ok(pool);
    const m1 = await createTestUser({
      databaseUrl,
      email: "guard-m1@test.local",
      password: "x",
      fullName: "Guard M1",
      role: "manager",
    });
    const m2 = await createTestUser({
      databaseUrl,
      email: "guard-m2@test.local",
      password: "x",
      fullName: "Guard M2",
      role: "manager",
    });
    const client = await pool.connect();
    let secretPartyId = "";
    try {
      await ensurePartyForUserOnWrite(client, m1.id, "Guard M1", "+79994444444");
      await ensurePartyForUserOnWrite(client, m2.id, "Guard M2", "+79995555555");
      const ins = await client.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164, created_by_user_id)
         VALUES ('external', 'Secret', '+79996666666', $1::uuid) RETURNING id::text`,
        [m2.id],
      );
      secretPartyId = ins.rows[0].id;
    } finally {
      client.release();
    }

    const req = {
      authUser: {
        id: m1.id,
        email: "guard-m1@test.local",
        fullName: "Guard M1",
        role: "manager",
        phone: "+79994444444",
        mustChangePassword: false,
      },
      accessContext: {
        userId: m1.id,
        role: "manager",
        status: "active",
        employeeId: null,
        employeeLinkConflict: false,
        hasEmployeeLink: false,
        hasScopedClientAccess: true,
        fullClientBase: false,
        explicitlyDeniedAll: false,
      },
      body: { item: "Box", finalRecipientPartyId: secretPartyId },
    } as unknown as AccessRequest;

    const captured = mockRes();
    await createTransferHandler(req, captured.res);
    assert.equal(captured.out.status, 403);
  });

  it("rejects marketer create even when party exists", async () => {
    const pool = getPool();
    assert.ok(pool);
    const mk = await createTestUser({
      databaseUrl,
      email: "marketer@test.local",
      password: "x",
      fullName: "Marketer",
      role: "marketer",
    });
    const client = await pool.connect();
    try {
      await ensurePartyForUserOnWrite(client, mk.id, "Marketer", "+79997777777");
    } finally {
      client.release();
    }

    const req = {
      authUser: {
        id: mk.id,
        email: "marketer@test.local",
        fullName: "Marketer",
        role: "marketer",
        phone: "+79997777777",
        mustChangePassword: false,
      },
      accessContext: {
        userId: mk.id,
        role: "marketer",
        status: "active",
        employeeId: null,
        employeeLinkConflict: false,
        hasEmployeeLink: false,
        hasScopedClientAccess: false,
        fullClientBase: false,
        explicitlyDeniedAll: false,
      },
      body: { item: "Box", finalRecipientPartyId: "00000000-0000-4000-8000-000000000099" },
    } as unknown as AccessRequest;

    const captured = mockRes();
    await createTransferHandler(req, captured.res);
    assert.equal(captured.out.status, 403);
  });
});
