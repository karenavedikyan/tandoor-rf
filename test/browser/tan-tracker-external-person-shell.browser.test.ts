import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import {
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";
import { createPersonBrowserSession } from "../../src/tan-tracker/external-person/person-service";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { createTestUser } from "../helpers/test-db";

describe("external person tan-tracker shell (browser)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;

  before(async () => {
    process.env.TT_OTP_PEPPER = "test-otp-pepper-min-16-chars";
    process.env.TT_EXTERNAL_MESSENGER_ENABLED = "true";
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/tt-ext-person-browser",
      extraEnv: {
        TT_OTP_PEPPER: "test-otp-pepper-min-16-chars",
        TT_EXTERNAL_MESSENGER_ENABLED: "true",
      },
    });
    const pool = new Pool({ connectionString: fixture.databaseUrl, max: 2 });
    const staff = await createTestUser({
      databaseUrl: fixture.databaseUrl,
      email: "ext-shell-staff@test.local",
      password: fixture.password,
      fullName: "Shell Staff",
      role: "manager",
    });
    await pool.query(`UPDATE users SET accepts_external_tt_intake = TRUE WHERE id = $1::uuid`, [staff.id]);
    await ensurePartyForUserOnWrite(pool, staff.id, "Shell Staff", "+79991234001");
    const extParty = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_parties (kind, display_name, phone_e164) VALUES ('external', 'Shell Ext', '+79991234002') RETURNING id::text`,
      )
    ).rows[0]!.id;
    const person = (
      await pool.query<{ id: string }>(
        `INSERT INTO tt_external_persons (phone_e164, display_name, party_id) VALUES ('+79991234002', 'Shell Ext', $1::uuid) RETURNING id::text`,
        [extParty],
      )
    ).rows[0]!.id;
    const client = await pool.connect();
    let est = "";
    try {
      est = await createPersonBrowserSession(client, person, "web");
    } finally {
      client.release();
      await pool.end();
    }
    (fixture as BrowserHttpFixture & { estToken?: string }).estToken = est;
  });

  after(async () => {
    await stopBrowserHttpFixture(fixture);
  });

  it("loads registry, opens ext-request wizard step, calls draft API", async () => {
    const est = (fixture as BrowserHttpFixture & { estToken?: string }).estToken;
    assert.ok(est);
    const page = await fixture.browser.newPage();
    await page.goto(`${fixture.baseUrl}/tan-tracker?est=${encodeURIComponent(est)}`);
    await page.waitForSelector('[data-testid="tan-tracker"]', { timeout: 30000 });
    await page.waitForSelector('[data-tt="ext-request-open"]', { timeout: 15000 });
    const draftReq = page.waitForResponse(
      (r) => r.url().includes("/api/tan-tracker/public/external/request/draft") && r.request().method() === "POST",
      { timeout: 30000 },
    );
    await page.click('[data-tt="ext-request-open"]');
    await page.waitForSelector('[data-tt-field="extItem"]', { timeout: 10000 });
    await page.fill('[data-tt-field="extItem"]', "Browser test item");
    await page.click('[data-tt="ext-request-next"]');
    const draftResp = await draftReq;
    assert.equal(draftResp.status(), 200);
    await page.close();
  });
});
