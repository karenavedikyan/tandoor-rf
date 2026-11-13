import assert from "node:assert/strict";
import http from "node:http";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";

const syntheticUser = {
  id: "11111111-1111-4111-8111-111111111111",
  fullName: "Тестовый сотрудник", email: "synthetic@example.invalid",
  phone: "+79000000001", role: "manager", status: "active",
};
const evidence = process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ??
  path.join(tmpdir(), "tandoor-profile-save-qa");

async function fixture(page: Page, options: { preview?: boolean } = {}) {
  const state = {
    user: { ...syntheticUser }, patches: [] as unknown[], profileReads: 0,
    status: 200, malformed: false, networkFailure: false,
    gate: Promise.resolve(), notificationWrites: 0,
    notifications: { max: false, telegram: false } as Record<string, boolean>,
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request(), pathname = new URL(req.url()).pathname;
    let status = 200, result: unknown = {};
    if (pathname === "/api/auth/me") {
      result = { user: options.preview ? { ...state.user, role: "admin" } : state.user,
        preview: options.preview ? { active: true, targetUser: state.user } : { active: false } };
    } else if (pathname === "/api/profile/self") {
      if (req.method() === "PATCH") {
        state.patches.push(req.postDataJSON());
        await state.gate;
        if (state.networkFailure) { await route.abort("failed"); return; }
        status = state.status;
        if (status === 200 && !state.malformed) {
          state.user = { ...state.user, ...req.postDataJSON() };
          state.user.fullName = state.user.fullName.trim();
          result = { user: state.user };
        } else result = state.malformed ? {} : { error: { message: "Не удалось сохранить изменения." } };
      } else {
        state.profileReads++;
        result = { user: state.user };
      }
    } else if (/\/tanbot\/(max|telegram)$/.test(pathname)) {
      result = { integrationEnabled: true, linked: true, notificationsEnabled: state.notifications[pathname.split("/").pop()!] };
    } else if (pathname.endsWith("/notifications") && req.method() === "POST") {
      state.notificationWrites++;
      state.notifications[pathname.split("/")[4]] = req.postDataJSON().enabled;
      result = { ok: true };
    } else if (pathname === "/api/clients/presentation") {
      result = { presentation: { clientsHref: "/clients" } };
    } else if (pathname === "/api/access/notifications") {
      result = { items: [], unreadCount: 0, total: 0, page: 1, pageSize: 15 };
    }
    await route.fulfill({ status, json: result });
  });
  return state;
}

async function assertFeedbackInViewport(page: Page) {
  const message = page.locator("#profile-save-status");
  const box = await message.boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height <= page.viewportSize()!.height + 1,
    `save result must be in viewport: ${JSON.stringify(box)}`);
  const order = await message.evaluate((el) => Boolean(
    el.compareDocumentPosition(document.getElementById("tanbot-max-section")!) &
    Node.DOCUMENT_POSITION_FOLLOWING));
  assert.equal(order, true);
  assert.equal(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
}

for (const engine of [chromium, webkit]) {
  describe(`profile save feedback, ${engine.name()} (synthetic API only)`, { concurrency: false }, () => {
    let browser: Browser, server: http.Server, baseUrl: string;
    before(async () => {
      await mkdir(evidence, { recursive: true });
      browser = await engine.launch({ headless: true, ...(engine === chromium ? { channel: "chromium" } : {}) });
      server = http.createServer(createApp());
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      baseUrl = "http://127.0.0.1:" + (server.address() as { port: number }).port;
    });
    after(async () => {
      await browser?.close();
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    });

    for (const viewport of [{ width: 1366, height: 768 }, { width: 1366, height: 600 }, { width: 375, height: 812 }]) {
      for (const theme of ["light", "dark"]) {
        it(`busy, success, next edit and keyboard submit at ${viewport.width}x${viewport.height}, ${theme}`, async () => {
          const page = await browser.newPage({ viewport });
          const errors: string[] = [];
          page.on("pageerror", e => errors.push(e.message));
          await page.addInitScript((theme) => localStorage.setItem("tandoor-rf-theme", theme), theme);
          const state = await fixture(page);
          await page.goto(baseUrl + "/profile");
          await page.locator("#profile-form:not([hidden])").waitFor();
          // Use the app's theme control if its persisted theme differs.
          if (await page.locator("html").getAttribute("data-theme") !== theme) {
            await page.locator("[data-theme-toggle]").click();
          }
          assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
          const initialColor = await page.locator("#save-button").evaluate(el => getComputedStyle(el).backgroundColor);
          assert.equal(await page.locator(".profile-save-icon").isVisible(), false);
          assert.equal(await page.locator("#email").getAttribute("readonly"), "");
          await page.locator("#full-name").fill("  Новое тестовое имя  ");
          await page.locator("#phone").fill("+79000000002");
          let release!: () => void;
          state.gate = new Promise<void>(resolve => { release = resolve; });
          await page.getByRole("button", { name: "Сохранить", exact: true }).click();
          await page.getByRole("button", { name: "Сохраняем…", exact: true }).waitFor();
          assert.equal(await page.locator("#save-button").isDisabled(), true);
          assert.equal(await page.locator("#profile-form").getAttribute("aria-busy"), "true");
          assert.equal(await page.locator("#phone").isEditable(), false);
          await page.locator("#full-name").focus();
          await page.keyboard.press("Enter");
          release();
          await page.getByRole("button", { name: "Сохранено", exact: true }).waitFor();
          assert.equal(await page.locator(".profile-save-icon").isVisible(), true);
          assert.notEqual(await page.locator("#save-button").evaluate(el => getComputedStyle(el).backgroundColor), initialColor);
          assert.deepEqual(state.patches, [{ fullName: "  Новое тестовое имя  ", phone: "+79000000002" }]);
          assert.equal(await page.locator("#full-name").inputValue(), "Новое тестовое имя");
          assert.equal(await page.locator("#phone").isEditable(), true);
          assert.equal(await page.locator("#profile-form").getAttribute("aria-busy"), "false");
          assert.equal(await page.locator("#profile-save-status").textContent(), "Профиль сохранён.");
          assert.equal(await page.locator("#status-message").textContent(), "");
          await assertFeedbackInViewport(page);
          await page.screenshot({ path: path.join(evidence, `${engine.name()}-${viewport.width}-${viewport.height}-${theme}-success.png`) });
          // A separate settings result must not replace the profile save result.
          await Promise.all([
            page.waitForResponse(r => r.url().endsWith("/tanbot/max/notifications") && r.request().method() === "POST"),
            page.locator("#tanbot-max-notifications-toggle").check(),
          ]);
          await Promise.all([
            page.waitForResponse(r => r.url().endsWith("/tanbot/max/notifications") && r.request().method() === "POST"),
            page.locator("#tanbot-max-notifications-toggle").uncheck(),
          ]);
          assert.equal(state.notificationWrites, 2);
          assert.equal(await page.locator("#profile-save-status").textContent(), "Профиль сохранён.");
          await page.locator("#full-name").fill("Ещё одно тестовое имя");
          assert.equal(await page.locator(".profile-save-icon").isVisible(), false);
          assert.equal(await page.locator("#save-button").evaluate(el => getComputedStyle(el).backgroundColor), initialColor);
          assert.equal(await page.locator("#profile-save-status").textContent(), "");
          await page.locator("#full-name").press("Enter");
          await page.getByRole("button", { name: "Сохранено", exact: true }).waitFor();
          assert.equal(state.patches.length, 2);
          assert.deepEqual(errors, []);
          await page.close();
        });
      }
    }

    for (const failure of ["400", "503", "malformed", "network"]) {
      it(`shows ${failure} near save, keeps inputs and supports retry`, async () => {
        const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
        const state = await fixture(page);
        await page.goto(baseUrl + "/profile");
        await page.locator("#profile-form:not([hidden])").waitFor();
        await page.locator("#full-name").fill("Новое имя для повтора");
        state.status = /^\d+$/.test(failure) ? Number(failure) : 200;
        state.malformed = failure === "malformed";
        state.networkFailure = failure === "network";
        await page.getByRole("button", { name: "Сохранить", exact: true }).click();
        await page.locator("#profile-save-status.status--error").waitFor();
        await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#save-button")!.disabled);
        assert.equal(await page.locator("#full-name").inputValue(), "Новое имя для повтора");
        assert.equal(await page.locator("#save-button-label").textContent(), "Сохранить");
        assert.equal(await page.locator(".profile-save-icon").isVisible(), false);
        assert.equal(await page.getByText("Профиль сохранён.", { exact: true }).count(), 0);
        await assertFeedbackInViewport(page);
        await page.screenshot({ path: path.join(evidence, `${engine.name()}-${failure}-error.png`) });
        state.status = 200; state.malformed = false; state.networkFailure = false;
        await page.getByRole("button", { name: "Сохранить", exact: true }).click();
        await page.getByRole("button", { name: "Сохранено", exact: true }).waitFor();
        assert.equal(state.patches.length, 2);
        await page.close();
      });
    }

    it("keeps preview read-only without loading a user's profile", async () => {
      const page = await browser.newPage();
      const state = await fixture(page, { preview: true });
      await page.goto(baseUrl + "/profile");
      await page.getByText(/Настройки профиля и привязки MAX \/ Telegram недоступны/).waitFor();
      assert.equal(await page.locator("#profile-form").isHidden(), true);
      assert.equal(state.profileReads, 0);
      assert.equal(state.patches.length, 0);
      await page.close();
    });

    it("preserves the existing login redirect after a 401", async () => {
      const page = await browser.newPage();
      const state = await fixture(page);
      await page.route("**/login", r => r.fulfill({ contentType: "text/html", body: "<h1>Вход</h1>" }));
      await page.goto(baseUrl + "/profile");
      await page.locator("#profile-form:not([hidden])").waitFor();
      state.status = 401;
      await page.getByRole("button", { name: "Сохранить", exact: true }).click();
      await page.waitForURL("**/login");
      assert.equal(state.patches.length, 1);
      await page.close();
    });
  });
}
