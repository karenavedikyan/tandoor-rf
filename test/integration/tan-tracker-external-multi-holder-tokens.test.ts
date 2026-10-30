import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { getPool, closePool, resetPoolForTests } from "../../src/db/pool";
import { buildExternalPersonBootstrapPayload } from "../../src/tan-tracker/external-person/bootstrap-build";
import { verifyHolderAccess } from "../../src/tan-tracker/holder-access";
import {
  createTestUser,
  getIntegrationDatabaseUrl,
  prepareDatabase,
  setIntegrationEnv,
} from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";

const ORIGIN = "http://127.0.0.1:3000";
const databaseUrl = getIntegrationDatabaseUrl();

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { Origin: ORIGIN, "Content-Type": "application/json", ...extra };
}

async function loadApp() {
  await resetPoolForTests();
  const { createApp } = await import("../../src/server");
  return createApp();
}

describe("external person multi-holder tokens", { concurrency: false }, () => {
  before(async () => {
    setIntegrationEnv(databaseUrl, "http://127.0.0.1:3000");
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    await prepareDatabase(databaseUrl);
  });

  after(async () => {
    await closePool();
  });

  it("issues distinct holder tokens per held order; actions bind to one transfer", async () => {
    const staff = await createTestUser({
      databaseUrl,
      email: "ext-multi-hat@test.local",
      password: "StrongPass123!",
      fullName: "Multi Hat Staff",
      role: "manager",
    });
    const pool = getPool()!;
    const client = await pool.connect();
    const personId = randomUUID();
    const transferA = `tt-ext-hold-a-${randomUUID().slice(0, 8)}`;
    const transferB = `tt-ext-hold-b-${randomUUID().slice(0, 8)}`;
    const codeA = "EXT-MH-A";
    const codeB = "EXT-MH-B";
    let externalPartyId = "";
    let staffPartyId = "";
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE users SET accepts_external_tt_intake = TRUE WHERE id = $1::uuid`, [staff.id]);
      const staffParty = await ensurePartyForUserOnWrite(client, staff.id, "Multi Hat Staff", "+79991112201");
      staffPartyId = staffParty.id;
      externalPartyId = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Multi Ext', '+79991112202') RETURNING id::text`,
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO tt_external_persons (id, phone_e164, display_name, party_id, access_epoch)
         VALUES ($1::uuid, '+79991112202', 'Multi Ext', $2::uuid, 1)`,
        [personId, externalPartyId],
      );
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, from_external, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version)
         VALUES ($1,$2,'Hold A','active',TRUE,$3,$3,NULL,$4,1)`,
        [transferA, codeA, externalPartyId, staffParty.id],
      );
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, from_external, creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id, handoff_version)
         VALUES ($1,$2,'Hold B','active',TRUE,$3,$3,NULL,$4,1)`,
        [transferB, codeB, externalPartyId, staffParty.id],
      );
      const otherParty = (
        await client.query<{ id: string }>(
          `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Other MH', '+79991112203') RETURNING id::text`,
        )
      ).rows[0]!.id;
      const histId = `tt-ext-hist-${randomUUID().slice(0, 8)}`;
      await client.query(
        `INSERT INTO tt_transfers (id, public_code, item_title, status, creator_party_id, holder_party_id, handoff_version)
         VALUES ($1,'EXT-MH-HIST','Hist','active',$2,$2,1)`,
        [histId, otherParty],
      );
      await client.query(
        `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note)
         VALUES ($1,$2,$3,'timeline only')`,
        [histId, externalPartyId, otherParty],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const bootstrap = await buildExternalPersonBootstrapPayload(pool, {
      personId,
      partyId: externalPartyId,
      displayName: "Multi Ext",
      phone: "+79991112202",
      accessEpoch: 1,
    });
    assert.equal(bootstrap.holderAccessToken, null);
    assert.equal(Object.keys(bootstrap.holderAccessTokensByOrderId).length, 2);
    const tokA = bootstrap.holderAccessTokensByOrderId[codeA];
    const tokB = bootstrap.holderAccessTokensByOrderId[codeB];
    assert.ok(tokA);
    assert.ok(tokB);
    assert.notEqual(tokA, tokB);

    const accessA = verifyHolderAccess(tokA!);
    const accessB = verifyHolderAccess(tokB!);
    assert.ok(accessA);
    assert.ok(accessB);
    assert.equal(accessA!.transferId, transferA);
    assert.equal(accessB!.transferId, transferB);

    const app = await loadApp();
    const ctxA = await request(app)
      .get("/api/tan-tracker/public/holder/context")
      .query({ holderAccessToken: tokA });
    assert.equal(ctxA.status, 200, ctxA.text);
    assert.equal(ctxA.body.orders[0].id, codeA);

    const changeB = await request(app)
      .post("/api/tan-tracker/public/holder/pending/change")
      .set(headers())
      .send({ holderAccessToken: tokB, pendingPartyId: staffPartyId });
    assert.equal(changeB.status, 200, changeB.text);
    assert.equal(changeB.body.orders[0].id, codeB);
    assert.equal(changeB.body.orders[0].status, "waiting");

    const poolAfterApp = getPool()!;
    const rowB = await poolAfterApp.query(`SELECT pending_party_id, status FROM tt_transfers WHERE id = $1`, [transferB]);
    assert.equal(rowB.rows[0].pending_party_id, staffPartyId);
    assert.equal(rowB.rows[0].status, "waiting");

    assert.equal(bootstrap.holderAccessTokensByOrderId["EXT-MH-HIST"], undefined);
  });
});
