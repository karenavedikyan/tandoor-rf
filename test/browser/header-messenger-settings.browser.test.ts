import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  fullName: "Тестовый сотрудник",
  email: "synthetic@example.invalid",
  phone: "+79000000001",
  role: "manager",
  status: "active",
};
type Channel = { integrationEnabled: boolean; linked: boolean; notificationsEnabled: boolean };
type Mock = {
  preview?: boolean;
  role?: string;
  channels?: Record<string, Channel>;
  failGet?: string;
  failPost?: string;
  badLink?: boolean;
};
const channel = (linked = false, notificationsEnabled = false): Channel => ({
  integrationEnabled: true, linked, notificationsEnabled,
});
const evidence = process.env.TANDOOR_BROWSER_SCREENSHOT_DIR ?? path.join(tmpdir(), "tandoor-header-messenger-qa");

async function mock(page: Page, options: Mock = {}) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const channels = options.channels || { max: channel(), telegram: channel() };
  let unread = 1;
  await page.route("**/api/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    calls.push({ path, method, body: method === "POST" ? request.postDataJSON() : undefined });
    const effectiveUser = { ...user, role: options.role || "manager" };
    let result: unknown = {}, status = 200;
    if (path === "/api/auth/me") {
      result = { user: options.preview ? { ...user, role: "admin" } : effectiveUser,
        preview: options.preview ? { active: true, targetUser: effectiveUser } : { active: false } };
    } else if (path === "/api/clients/presentation") {
      result = { presentation: { clientsHref: "/clients" } };
    } else if (path === "/api/profile/self") {
      if (options.preview) { status = 403; result = { error: { message: "Preview forbidden" } }; }
      else result = { user: effectiveUser };
    } else if (/^\/api\/profile\/tanbot\/(max|telegram)$/.test(path)) {
      const name = path.split("/").pop()!;
      if (options.failGet === name) { status = 503; result = { error: { message: "Канал временно недоступен для проверки." } }; }
      else result = channels[name];
    } else if (path.endsWith("/link/start")) {
      const name = path.split("/")[4];
      if (options.failPost === name) { status = 503; result = { error: { message: "Не удалось подключить канал." } }; }
      else result = { deepLink: options.badLink ? "javascript:alert(1)" :
        `https://${name === "max" ? "max.ru" : "t.me"}/synthetic_bot?start=SYNTHETIC_LOCAL_ONLY` };
    } else if (/\/tanbot\/(max|telegram)\/notifications$/.test(path)) {
      const name = path.split("/")[4];
      if (options.failPost === name) { status = 503; result = { error: { message: "Не удалось сохранить уведомления." } }; }
      else {
        channels[name].notificationsEnabled = request.postDataJSON().enabled;
        result = { ok: true };
      }
    } else if (path === "/api/access/notifications") {
      const currentPage = Number(url.searchParams.get("page") || 1);
      result = {
        items: unread ? [{ id: "22222222-2222-4222-8222-222222222222", kind: "approve", title: "Тестовое назначение",
          message: "Синтетическое уведомление", created_at: "2026-11-12T09:00:00Z",
          delegation_id: "33333333-3333-4333-8333-333333333333", read_at: null }] : [],
        unread, total: 31, page: currentPage, pageSize: 30, serverNow: new Date().toISOString(),
        reviewPendingCount: 0, scopeRevision: null,
      };
    } else if (path.startsWith("/api/access/notifications/")) {
      unread = 0; result = { ok: true };
    } else if (path === "/api/tan-tracker/notifications") {
      result = { items: [{ id: "synthetic", title: "Тестовая передача", body: "Без отправки сообщений" }] };
    } else {
      result = { error: { message: "Unexpected local API: " + path } };
      status = 404;
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(result) });
  });
  return { calls, channels, options };
}

async function openSettings(page: Page, baseUrl: string) {
  await page.goto(baseUrl + "/profile");
  const bell = page.locator("#an-bell, .mn-bell").first();
  await bell.waitFor({ state: "visible" });
  await bell.click();
  await page.getByRole("heading", { name: "Уведомления в мессенджерах" }).waitFor();
}
const roots = (page: Page) => page.locator("dialog[open] .mn-settings");
const channelRoot = (page: Page, name: string) => roots(page).locator(".mn-channel").filter({ has: page.locator("strong", { hasText: new RegExp("^" + name + "$") }) });

describe("header messenger settings (local synthetic API only)", { concurrency: false }, () => {
  let browser: Browser, server: http.Server, baseUrl: string;
  before(async () => {
    await mkdir(evidence, { recursive: true });
    browser = await chromium.launch({ headless: true, channel: "chromium" });
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  });
  after(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  for (const width of [1440, 375]) {
    it(`shows both channels, connection links, inbox and keyboard close at ${width}px`, async () => {
      const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 960 } });
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      const state = await mock(page);
      await openSettings(page, baseUrl);
      await roots(page).getByRole("button", { name: "Подключить MAX", exact: true }).click();
      await roots(page).getByRole("link", { name: "Открыть MAX", exact: true }).waitFor();
      await roots(page).getByRole("button", { name: "Подключить Telegram", exact: true }).click();
      await roots(page).getByRole("link", { name: "Открыть Telegram", exact: true }).waitFor();
      const links = roots(page).getByRole("link");
      assert.equal(await links.count(), 2);
      assert.equal(await links.first().getAttribute("rel"), "noopener noreferrer");
      assert.equal(state.calls.filter((c) => c.path.endsWith("/link/start")).length, 2);
      await page.getByText("Тестовое назначение", { exact: true }).waitFor();
      assert.equal(await page.locator("#profile-form").isVisible(), true);
      await Promise.all([
        page.waitForRequest((r) => r.url().includes("page=1&unread=1")),
        page.getByRole("button", { name: "Непрочитанные", exact: true }).click(),
      ]);
      await page.getByRole("button", { name: "Далее", exact: true }).click();
      await page.getByText("Всего: 31 · 2 / 2", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Назад", exact: true }).click();
      await page.getByText("Всего: 31 · 1 / 2", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Прочитать все", exact: true }).click();
      await page.getByText("Все уведомления прочитаны.", { exact: true }).waitFor();
      const dialog = page.locator("dialog[open]");
      const box = await dialog.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
      assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      await dialog.evaluate((el) => { el.scrollTop = 0; });
      await page.screenshot({ path: `${evidence}/settings-${width}.png` });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.getElementById("an-bell")?.getAttribute("aria-expanded") === "false");
      await page.locator("#an-bell").waitFor({ state: "visible" });
      assert.equal(await page.locator("#an-bell").getAttribute("aria-expanded"), "false");
      assert.equal(await page.locator("#an-bell").evaluate((el) => el === document.activeElement), true);
      assert.deepEqual(errors, []);
      await page.close();
    });
  }

  it("toggles linked channels independently without disconnecting or minting tokens", async () => {
    const page = await browser.newPage();
    const state = await mock(page, { channels: { max: channel(true, false), telegram: channel(true, true) } });
    await openSettings(page, baseUrl);
    await channelRoot(page, "MAX").getByRole("checkbox").check();
    await channelRoot(page, "MAX").getByText("Подключён · уведомления включены", { exact: true }).waitFor();
    await channelRoot(page, "Telegram").getByRole("checkbox").uncheck();
    await channelRoot(page, "Telegram").getByText("Подключён · уведомления выключены", { exact: true }).waitFor();
    assert.equal(state.channels.max.notificationsEnabled, true);
    assert.equal(state.channels.telegram.notificationsEnabled, false);
    assert.equal(state.calls.filter((c) => c.path.endsWith("/link/start") || c.path.endsWith("/disconnect")).length, 0);
    assert.deepEqual(state.calls.filter((c) => c.method === "POST").map((c) => c.body), [{ enabled: true }, { enabled: false }]);
    await page.close();
  });

  it("refreshes linked state and removes the pending link on return from the bot", async () => {
    const page = await browser.newPage();
    const state = await mock(page);
    await openSettings(page, baseUrl);
    await roots(page).getByRole("button", { name: "Подключить MAX", exact: true }).click();
    await roots(page).getByRole("link", { name: "Открыть MAX", exact: true }).waitFor();
    state.channels.max = channel(true, true);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await channelRoot(page, "MAX").getByRole("checkbox").waitFor();
    assert.equal(await roots(page).getByRole("link", { name: "Открыть MAX" }).count(), 0);
    await page.close();
  });

  it("explains preview and never reads or mutates the actor's messenger bindings", async () => {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    const state = await mock(page, { preview: true });
    await openSettings(page, baseUrl);
    await roots(page).getByText(/В режиме «Войти как» статус привязки недоступен/).waitFor();
    assert.equal(await page.locator("#profile-form").isHidden(), true);
    assert.equal(await roots(page).getByRole("checkbox").count(), 0);
    assert.equal(await roots(page).getByRole("button").count(), 0);
    assert.equal(state.calls.filter((c) => c.path.startsWith("/api/profile/")).length, 0);
    await page.screenshot({ path: `${evidence}/preview-375.png` });
    await page.close();
  });

  for (const role of ["admin", "regional_manager", "marketer"]) {
    it(`provides a channel-only bell for ${role} without accessing assignments`, async () => {
      const page = await browser.newPage();
      const state = await mock(page, { role });
      await openSettings(page, baseUrl);
      await roots(page).getByRole("button", { name: "Подключить MAX", exact: true }).waitFor();
      assert.equal(await page.locator(".mn-bell").count(), 1);
      assert.equal(state.calls.filter((c) => c.path.startsWith("/api/access/notifications")).length, 0);
      await page.getByRole("button", { name: "Закрыть", exact: true }).click();
      await page.close();
    });
  }

  it("keeps an unavailable channel visible and retries a failed status request", async () => {
    const page = await browser.newPage();
    const options: Mock = { failGet: "max" };
    await mock(page, options);
    await openSettings(page, baseUrl);
    await channelRoot(page, "MAX").getByRole("alert").waitFor();
    options.failGet = undefined;
    await channelRoot(page, "MAX").getByRole("button", { name: "Повторить" }).click();
    await channelRoot(page, "MAX").getByRole("button", { name: "Подключить MAX" }).waitFor();
    await page.close();
  });

  it("does not falsely enable a preference after a failed save", async () => {
    const page = await browser.newPage();
    const options: Mock = { failPost: "max", channels: { max: channel(true), telegram: channel() } };
    await mock(page, options);
    await openSettings(page, baseUrl);
    await channelRoot(page, "MAX").getByRole("checkbox").click();
    await channelRoot(page, "MAX").getByRole("alert").waitFor();
    await channelRoot(page, "MAX").getByRole("button", { name: "Повторить" }).click();
    await channelRoot(page, "MAX").getByRole("checkbox").waitFor();
    assert.equal(await channelRoot(page, "MAX").getByRole("checkbox").isChecked(), false);
    await page.close();
  });

  it("keeps individual inbox actions reachable below the channel settings on mobile", async () => {
    const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
    const state = await mock(page);
    await openSettings(page, baseUrl);
    await roots(page).getByRole("button", { name: "Подключить MAX", exact: true }).waitFor();
    assert.match(await page.getByRole("link", { name: "Открыть назначение" }).getAttribute("href") || "", /^\/access\?assignment=/);
    await page.getByRole("button", { name: "Прочитано", exact: true }).click();
    await page.getByText("Уведомлений пока нет.", { exact: true }).waitFor();
    assert.equal(state.calls.filter((c) => c.method === "POST" && c.path.endsWith("/read")).length, 1);
    await page.close();
  });

  it("rejects unsafe connection URLs and shows disabled integrations honestly", async () => {
    const page = await browser.newPage();
    await mock(page, { badLink: true, channels: { max: channel(), telegram: { ...channel(), integrationEnabled: false } } });
    await openSettings(page, baseUrl);
    await channelRoot(page, "MAX").getByRole("button", { name: "Подключить MAX" }).click();
    await channelRoot(page, "MAX").getByRole("alert").waitFor();
    assert.equal(await roots(page).getByRole("link").count(), 0);
    await channelRoot(page, "Telegram").getByText("Канал временно недоступен", { exact: true }).waitFor();
    assert.equal(await channelRoot(page, "Telegram").getByRole("button").count(), 0);
    await page.close();
  });

  it("keeps settings mounted in the tracker's separate bell when the feed refreshes", async () => {
    const page = await browser.newPage();
    await mock(page);
    await page.goto(baseUrl + "/profile");
    await page.locator("#an-bell").waitFor();
    await page.addScriptTag({ url: baseUrl + "/tan-tracker-notifications.js" });
    await page.evaluate(() => {
      const host = document.createElement("div");
      document.body.append(host);
      (window as unknown as { mountTanTrackerNotifications: (el: HTMLElement) => void }).mountTanTrackerNotifications(host);
    });
    await page.locator("#tt-notif-bell").click();
    const panel = page.locator("#tt-notif-panel");
    await panel.getByRole("button", { name: "Подключить MAX", exact: true }).waitFor();
    await panel.getByText("Тестовая передача", { exact: true }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event("tandoor:tt-notifications-refresh")));
    assert.equal(await panel.locator(".mn-settings").count(), 1);
    await panel.getByRole("button", { name: "Подключить Telegram", exact: true }).waitFor();
    await page.close();
  });
});
