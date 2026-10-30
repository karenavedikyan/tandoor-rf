import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import {
  PhonePartyConflictError,
  resolveOrCreateGlobalExternalPartyByPhone,
} from "../../src/tan-tracker/phone-party-resolver";
import { resolveExternalRecipientPartyId } from "../../src/tan-tracker/party-eligibility";

const databaseUrl = getIntegrationDatabaseUrl();
const PHONE = "+79993334499";

describe("tan-tracker global phone party resolver (PostgreSQL)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("concurrent creators reuse one external party", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const a = await createTestUser({
      databaseUrl,
      email: "phone-res-a@test.local",
      password: "StrongPass123!",
      fullName: "Creator A",
      role: "manager",
    });
    const b = await createTestUser({
      databaseUrl,
      email: "phone-res-b@test.local",
      password: "StrongPass123!",
      fullName: "Creator B",
      role: "manager",
    });

    const run = async (userId: string, name: string) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const id = await resolveOrCreateGlobalExternalPartyByPhone(client, {
          phoneE164: PHONE,
          displayName: name,
          createdByUserId: userId,
        });
        await client.query("COMMIT");
        return id;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    };

    const [idA, idB] = await Promise.all([run(a.id, "Client A"), run(b.id, "Client B")]);
    assert.equal(idA, idB);
    const count = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tt_parties WHERE kind = 'external' AND phone_e164 = $1`,
      [PHONE],
    );
    assert.equal(count.rows[0]!.c, 1);
  });

  it("employee phone collision rejects external create", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const emp = await createTestUser({
      databaseUrl,
      email: "phone-res-emp@test.local",
      password: "StrongPass123!",
      fullName: "Employee Phone",
      role: "manager",
    });
    await ensurePartyForUserOnWrite(pool, emp.id, "Employee Phone", PHONE);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assert.rejects(
        () =>
          resolveOrCreateGlobalExternalPartyByPhone(client, {
            phoneE164: PHONE,
            displayName: "Should Fail",
            createdByUserId: emp.id,
          }),
        (err: Error & { http?: number }) => {
          assert.equal(err.http, 403);
          return true;
        },
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("duplicate externals without canonical report conflict", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const user = await createTestUser({
      databaseUrl,
      email: "phone-res-dup@test.local",
      password: "StrongPass123!",
      fullName: "Dup Admin",
      role: "manager",
    });
    const dupPhone = "+79993335599";
    await pool.query(
      `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Dup1', $1), ('external', 'Dup2', $1)`,
      [dupPhone],
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assert.rejects(
        () =>
          resolveExternalRecipientPartyId(client, user.id, { name: "New", phone: dupPhone.replace("+7", "8") }),
        (err: unknown) => err instanceof PhonePartyConflictError,
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
