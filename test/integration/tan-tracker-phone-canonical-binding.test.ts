import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { getIntegrationDatabaseUrl, prepareDatabase, setIntegrationEnv } from "../helpers/test-db";
import { validateAdminPhoneCanonicalAssignment } from "../../src/tan-tracker/phone-canonical-validation";
import { resolveKnownGlobalExternalPartyByPhone } from "../../src/tan-tracker/phone-party-resolver";
import { upsertVerifiedPerson } from "../../src/tan-tracker/external-person/person-service";

const databaseUrl = getIntegrationDatabaseUrl();
const PHONE_A = "+79991116601";
const PHONE_B = "+79991116602";

describe("phone canonical binding (PostgreSQL)", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("invalid canonical mapping cannot authenticate another phone", async () => {
    await resetPoolForTests();
    const pool = getPool();
    assert.ok(pool);
    const client = await pool.connect();
    try {
      const partyA = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Canon A', $1) RETURNING id::text`,
          [PHONE_A],
        )
      ).rows[0]!.id;
      const partyB = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Canon B', $1) RETURNING id::text`,
          [PHONE_B],
        )
      ).rows[0]!.id;

      await assert.rejects(
        () => validateAdminPhoneCanonicalAssignment(client, { phoneE164Raw: PHONE_A, partyId: partyB }),
        (err: Error & { http?: number }) => {
          assert.equal(err.http, 409);
          return true;
        },
      );

      await client.query(
        `INSERT INTO tt_phone_canonical_parties (phone_e164, party_id) VALUES ($1, $2::uuid)`,
        [PHONE_A, partyB],
      );

      await assert.rejects(
        () => resolveKnownGlobalExternalPartyByPhone(client, PHONE_A),
        (err: Error & { http?: number }) => {
          assert.equal(err.http, 409);
          return true;
        },
      );

      await assert.rejects(
        () =>
          upsertVerifiedPerson(client, {
            channel: "telegram",
            messengerUserId: 88116601n,
            messengerChatId: 88116601n,
            phoneRaw: PHONE_A,
            displayName: "Wrong canon",
          }),
        (err: Error & { http?: number }) => {
          assert.equal(err.http, 409);
          return true;
        },
      );

      await client.query(`DELETE FROM tt_phone_canonical_parties WHERE phone_e164 = $1`, [PHONE_A]);
      await client.query(
        `INSERT INTO tt_phone_canonical_parties (phone_e164, party_id) VALUES ($1, $2::uuid)`,
        [PHONE_A, partyA],
      );
      const known = await resolveKnownGlobalExternalPartyByPhone(client, PHONE_A);
      assert.equal(known?.partyId, partyA);
    } finally {
      client.release();
    }
  });
});
