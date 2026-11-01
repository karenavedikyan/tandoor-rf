import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  seedTanTrackerBrowserUsers,
  startBrowserHttpFixture,
  stopBrowserHttpFixture,
  type BrowserHttpFixture,
} from "./helpers/http-integration-browser";
import { signInvitationToken } from "../../src/tan-tracker/invitation-token";

describe("stale tracker links give an actionable explanation", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;
  const invalidMst = `er${"a".repeat(43)}`;

  before(async () => {
    fixture = await startBrowserHttpFixture({ attachmentsDir: "var/tt-stale-links-browser" });
    await seedTanTrackerBrowserUsers(fixture.databaseUrl, fixture.password);
  });
  after(async () => stopBrowserHttpFixture(fixture));

  it("missing, unknown messenger, invitation and holder links show a denial at mobile and desktop widths", async () => {
    const expired = signInvitationToken({
      transferId: "TT-OLD-NONEXISTENT",
      hv: 1,
      pendingPartyId: "00000000-0000-4000-8000-000000000001",
      exp: Date.now() - 60_000,
    });
    const links = [
      "/tan-tracker/recipient",
      `/tan-tracker/recipient?mst=${invalidMst}`,
      "/tan-tracker/recipient#tan-tracker?tt_tok=invalid&tt_order=TT-OLD&tt_view=recipient",
      "/tan-tracker/recipient#tan-tracker?tt_hat=invalid&tt_screen=public-holder",
      `/tan-tracker/recipient#tan-tracker?tt_tok=${encodeURIComponent(expired)}&tt_order=TT-OLD&tt_view=recipient`,
    ];
    const ctx = await fixture.browser.newContext();
    const page = await ctx.newPage();
    const jsErrors: string[] = [];
    const writes: string[] = [];
    page.on("pageerror", e => jsErrors.push(e.message));
    page.on("request", req => {
      if (!["GET", "HEAD"].includes(req.method()) && req.url().includes("/api/")) writes.push(req.url());
    });
    try {
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const link of links) {
          await page.goto("about:blank");
          await page.goto(fixture.baseUrl + link);
          const denial = page.locator('[data-tt="recipient-welcome-invalid"]');
          await denial.waitFor();
          const text = await denial.innerText();
          assert.match(text, /Ссылка на передачу больше не действует/);
          assert.match(text, /создайте новую передачу/);
          assert.match(text, /актуальное приглашение/);
          assert.equal(await page.locator('[data-tt="recipient-welcome-continue"], [data-tt="recipient-phone-send"], [data-tt="gen-code"], [data-tt="confirm-qr-receive"]').count(), 0);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
        }
      }
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({ path: "/home/user/workspace/tandoor-stale-link-mobile.png" });
      assert.deepEqual(jsErrors, []);
      assert.deepEqual(writes, []);
    } finally {
      await ctx.close();
    }
  });

  it("503/network failures offer retry, do not call a valid transfer stale and do not fall back to a receipt", async () => {
    const ctx = await fixture.browser.newContext();
    const page = await ctx.newPage();
    try {
      for (const kind of ["503", "network"]) {
        await page.route("**/api/tan-tracker/public/recipient/messenger?*", route =>
          kind === "503"
            ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Сервис недоступен." } }) })
            : route.abort("failed"));
        await page.goto(`${fixture.baseUrl}/tan-tracker/recipient?mst=${invalidMst}`);
        await page.locator('[data-tt="recipient-load-error"]').waitFor();
        assert.equal(await page.locator('[data-tt="recipient-welcome-invalid"]').count(), 0);
        assert.match(await page.locator("main").innerText(), /не означает, что передача устарела/);
        await page.unrouteAll({ behavior: "wait" });
      }
      let receiptFetches = 0;
      page.on("request", req => { if (req.url().includes("/public/recipient/receipt?")) receiptFetches++; });
      await page.route("**/api/tan-tracker/public/recipient/context?*", route =>
        route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
      const url = `${fixture.baseUrl}/tan-tracker/recipient#tan-tracker?tt_tok=test&tt_order=TT-OLD&tt_view=recipient`;
      await page.goto(url);
      await page.locator('[data-tt="recipient-load-error"]').waitFor();
      await page.getByRole("link", { name: "Повторить загрузку" }).click();
      await page.locator('[data-tt="recipient-load-error"]').waitFor();
      assert.equal(page.url(), url);
      assert.equal(receiptFetches, 0);
    } finally {
      await ctx.close();
    }
  });

  it("Continue checks the invitation again before showing channels", async () => {
    const ctx = await fixture.browser.newContext();
    const page = await ctx.newPage();
    let reads = 0;
    try {
      await page.route("**/api/tan-tracker/public/recipient/messenger?*", route => {
        reads++;
        return route.fulfill({
          status: reads === 1 ? 200 : 410,
          contentType: "application/json",
          body: JSON.stringify(reads === 1
            ? { transferPublicCode: "TT-LOCAL", senderDisplayName: "Тестовый отправитель", itemTitle: "Тестовый предмет", channels: [] }
            : { error: { message: "Приглашение устарело." } }),
        });
      });
      await page.goto(`${fixture.baseUrl}/tan-tracker/recipient?mst=${invalidMst}`);
      await page.locator('[data-tt="recipient-welcome-continue"]').click();
      await page.locator('[data-tt="recipient-welcome-invalid"]').waitFor();
      assert.equal(reads, 2);
      assert.equal(await page.locator('[data-tt="messenger-portal"], [data-tt="recipient-welcome-continue"]').count(), 0);
      assert.doesNotMatch(await page.locator("main").innerText(), /Тестовый предмет/);
    } finally {
      await ctx.close();
    }
  });

  it("a used invitation still opens its saved receipt, including detail/code deep links", async () => {
    const ctx = await fixture.browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.route("**/api/tan-tracker/public/recipient/context?*", route =>
        route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
      await page.route("**/api/tan-tracker/public/recipient/receipt?*", route =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            publicReceipt: true,
            receipt: { transferStatus: "delivered", publicCode: "TT-LOCAL-RECEIVED", item: "Локальная квитанция" },
          }),
        }));
      for (const screen of ["recipient", "detail", "code"]) {
        await page.goto("about:blank");
        await page.goto(`${fixture.baseUrl}/tan-tracker/recipient#tan-tracker?tt_tok=used-local&tt_order=TT-LOCAL-RECEIVED&tt_view=recipient&tt_screen=${screen}`);
        await page.locator('[data-tt="public-receipt"]').waitFor();
        assert.match(await page.locator("main").innerText(), /Доставлено/);
        assert.equal(await page.locator('[data-tt="recipient-welcome-invalid"], [data-tt="transfer-unavailable"]').count(), 0);
        await page.reload();
        await page.locator('[data-tt="public-receipt"]').waitFor();
      }
    } finally {
      await ctx.close();
    }
  });

  it("an old staff link survives login, shows a warning, then opens a new transfer or the registry", async () => {
    const ctx = await fixture.browser.newContext();
    const page = await ctx.newPage();
    const oldPath = "/tan-tracker/#tan-tracker?tt_screen=detail&tt_order=TT-DELETED-LOCAL";
    try {
      await page.goto(fixture.baseUrl + oldPath);
      await page.waitForURL(/\/login\?next=/);
      assert.equal(new URL(page.url()).searchParams.get("next"), oldPath);
      await page.fill("#email", "tt-browser-admin@test.local");
      await page.fill("#password", fixture.password);
      await page.click("#login-button");
      await page.waitForURL(fixture.baseUrl + oldPath);
      const warning = page.locator('[data-tt="transfer-unavailable"]');
      await warning.waitFor();
      assert.match(await warning.innerText(), /Создать новую передачу/);
      assert.equal(await page.locator('[data-tt="detail"], [data-tt="confirm-transfer"], [data-tt="gen-code"]').count(), 0);
      await warning.getByRole("button", { name: "Создать новую передачу", exact: true }).click();
      await page.locator('[data-tt-field="item"]').waitFor();
      await page.goto(fixture.baseUrl + oldPath);
      await page.locator('[data-tt="transfer-unavailable"]').getByRole("button", { name: "Мои передачи", exact: true }).click();
      await page.waitForFunction(() => window.location.hash.indexOf("tt_order=") < 0);
      assert.equal(await page.locator('[data-tt="transfer-unavailable"]').count(), 0);
    } finally {
      await ctx.close();
    }
  });

  it("login never follows external, protocol-relative or non-tracker next destinations", async () => {
    for (const next of ["https://example.org/tan-tracker", "//example.org/tan-tracker", "/admin/access"]) {
      const ctx = await fixture.browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${fixture.baseUrl}/login?next=${encodeURIComponent(next)}`);
        await page.fill("#email", "tt-browser-admin@test.local");
        await page.fill("#password", fixture.password);
        await page.click("#login-button");
        await page.waitForURL(`${fixture.baseUrl}/clients`);
      } finally {
        await ctx.close();
      }
    }
  });

  it("old external-cabinet sessions explain how to get a new link without claiming the transfer has ended", async () => {
    const ctx = await fixture.browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(`${fixture.baseUrl}/tan-tracker/?est=invalid-external-session`);
      const error = page.locator("#tt-state-panel");
      await error.waitFor({ state: "visible" });
      await page.waitForFunction(() => document.getElementById("tt-state-panel")?.textContent?.includes("Ссылка для входа больше не действует"));
      assert.match(await error.innerText(), /актуальную ссылку/);
      assert.match(await error.innerText(), /создайте новую передачу/);
      assert.equal(await page.locator('[data-tt="ext-request-open"], [data-tt="gen-code"]').count(), 0);
    } finally {
      await ctx.close();
    }
  });
});
