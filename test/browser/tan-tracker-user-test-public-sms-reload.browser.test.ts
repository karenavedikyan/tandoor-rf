/**
 * Public QR → SMS verify → reload retains proof (tt_pts in URL).
 * TT56_USER_TEST_PUBLIC_SMS_RELOAD=1
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import request from "supertest";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { peekTestPhoneVerificationCode } from "../../src/tan-tracker/phone-verification";
import { FIXTURE } from "../../scripts/tan-tracker-user-test/seed-tt-fixtures.mjs";

const RUN = process.env.TT56_USER_TEST_PUBLIC_SMS_RELOAD === "1";
const PASSWORD = process.env.TT_USER_TEST_DEFAULT_PASSWORD?.trim() || "Tt56UserTest!Local2026";

describe("tt56 public SMS proof reload", { concurrency: false, skip: !RUN }, () => {
  let browser: Browser;
  let baseUrl = "";
  let server: http.Server;

  before(async () => {
    process.env.TT_USER_TEST_ENV = "true";
    process.env.NODE_ENV = "development";
    process.env.TT_PHONE_VERIFICATION_PROVIDER = "test";
    process.env.TT_OTP_PEPPER = process.env.TT_OTP_PEPPER || "tt56-local-otp-pepper-20261029";
    process.env.PGSSLMODE = "disable";
    process.env.ONEC_NIGHTLY_EXCHANGE_ENABLED = "false";
    process.env.TT_ATTACHMENTS_DIR = path.join(process.cwd(), "var/tt56-user-test/attachments");
    process.env.TT_USER_TEST_OTP_DIR = path.join(process.cwd(), "var/tt56-user-test/otp");

    browser = await chromium.launch({ headless: true });
    await resetPoolForTests();
    const { createApp } = await import("../../src/server");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.APP_ORIGIN = baseUrl;
  });

  after(async () => {
    await browser?.close();
    await closePool();
    await new Promise<void>((resolve, reject) => {
      server?.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("keeps verified state after reload before code generate", async () => {
    const { createApp } = await import("../../src/server");
    const app = createApp();
    const loginRes = await request(app)
      .post("/api/auth/login")
      .set({ Origin: baseUrl, "Content-Type": "application/json" })
      .send({ email: "tt56-employee-b@tt56-user-test.local", password: PASSWORD });
    assert.equal(loginRes.status, 200);
    const cookie = loginRes.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

    const boot = await request(app).get("/api/tan-tracker/bootstrap").set({ Origin: baseUrl, Cookie: cookie });
    const order = boot.body.orders.find((o: { id: string }) => o.id === FIXTURE.TRANSFER_WAIT_AB);
    assert.ok(order?.activeInvitation?.invitationToken);

    const inv = order.activeInvitation;
    const hash = `#tan-tracker?tt_view=recipient&tt_order=${encodeURIComponent(order.id)}&tt_hv=${inv.hv}&tt_rcv=${encodeURIComponent(inv.pendingId)}&tt_tok=${encodeURIComponent(inv.invitationToken)}&tt_via=qr`;

    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();
    await page.goto(`/tan-tracker/recipient${hash}`);
    await page.waitForSelector('[data-tt="recipient-phone-send"]', { timeout: 20000 });
    await page.click('[data-tt="recipient-phone-send"]');
    await page.waitForTimeout(500);

    const otp = peekTestPhoneVerificationCode(order.id, inv.pendingId);
    assert.ok(otp, "test SMS file/memory must expose OTP");

    await page.fill('[data-tt="recipient-phone-code"]', otp!);
    await page.click('[data-tt="recipient-phone-verify"]');
    await page.waitForSelector(".tt-recipient-verified", { timeout: 15000 });

    await page.waitForFunction(() => location.hash.includes("tt_pts="), { timeout: 5000 });
    const hashBefore = await page.evaluate(() => location.hash);
    assert.match(hashBefore, /tt_pts=/);

    await page.reload();
    await page.waitForSelector(".tt-recipient-verified", { timeout: 15000 });
    assert.match(await page.evaluate(() => location.hash), /tt_pts=/);

    await context.close();
  });
});
