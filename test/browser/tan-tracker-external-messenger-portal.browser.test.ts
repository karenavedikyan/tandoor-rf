import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";

describe("external recipient messenger portal (browser)", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;
  let startToken = "";
  let adminCookie = "";

  before(async () => {
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/tt-ext-messenger-browser",
      extraEnv: {
        TT_EXTERNAL_MESSENGER_ENABLED: "true",
        TANBOT_TELEGRAM_ENABLED: "true",
        TANBOT_TELEGRAM_BOT_TOKEN: "123456789:AAH-test-token-for-browser-only",
        TANBOT_TELEGRAM_BOT_USERNAME: "tandoor_test_bot",
        TANBOT_TELEGRAM_LINK_TOKEN_PEPPER: "test-link-pepper-min-16-chars",
        TANBOT_MAX_ENABLED: "false",
      },
    });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);

    const { createApp } = await import("../../src/server");
    const app = createApp();
    const login = await request(app)
      .post("/api/auth/login")
      .set({ Origin: fixture.baseUrl, "Content-Type": "application/json" })
      .send({ email: "tt-browser-admin@test.local", password: fixture.password });
    assert.equal(login.status, 200, login.text);
    adminCookie = login.headers["set-cookie"]![0]!.split(";")[0]!;

    const create = await request(app)
      .post("/api/tan-tracker/transfers")
      .set({
        Origin: fixture.baseUrl,
        Cookie: adminCookie,
        "Content-Type": "application/json",
      })
      .send({
        item: "Messenger portal browser item",
        finalRecipientExternal: { name: "Ext", phone: "+79991112233" },
      });
    assert.equal(create.status, 201, create.text);
    const transferCode = create.body.publicCode as string;

    const invite = await request(app)
      .post(`/api/tan-tracker/transfers/${encodeURIComponent(transferCode)}/messenger-invite`)
      .set({
        Origin: fixture.baseUrl,
        Cookie: adminCookie,
        "Content-Type": "application/json",
      })
      .send({});
    assert.equal(invite.status, 201, invite.text);
    startToken = invite.body.startToken as string;
    assert.match(startToken, /^er/);
  });

  after(async () => {
    await stopBrowserHttpFixture(fixture);
  });

  it("loads portal from ?mst= query and opens Telegram deep link on click", async () => {
    const context = await fixture.browser.newContext({ baseURL: fixture.baseUrl });
    try {
      const page = await context.newPage();
      await page.goto(`/tan-tracker/recipient?mst=${encodeURIComponent(startToken)}`);
      await page.waitForSelector('[data-tt="messenger-portal"]', { timeout: 20000 });
      await page.waitForSelector('[data-tt="messenger-channel-open"][data-channel="telegram"]', {
        timeout: 15000,
      });
      const href = await page.getAttribute(
        '[data-tt="messenger-channel-open"][data-channel="telegram"]',
        "href",
      );
      assert.ok(href && href.includes("t.me/"), href ?? "missing telegram href");
      assert.match(href, /start=/);

      await page.waitForSelector('[data-tt="messenger-channel-unavailable"][data-channel="max"]', {
        timeout: 5000,
      });

      const popupPromise = page.waitForEvent("popup", { timeout: 10000 });
      await page.click('[data-tt="messenger-channel-open"][data-channel="telegram"]');
      const popup = await popupPromise;
      assert.match(popup.url(), /t\.me\//);
      await popup.close();
    } finally {
      await context.close();
    }
  });
});
