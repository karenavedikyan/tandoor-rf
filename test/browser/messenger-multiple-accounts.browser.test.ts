import assert from "node:assert/strict";
import http from "node:http";
import { mkdir } from "node:fs/promises";
import { before, after, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";

const evidence = "/tmp/tandoor-messenger-accounts-qa";
const p1 = "+79000000001", p2 = "+79000000002";
const account = (id: string, phone: string | null, confirmed = true) => ({
  accountId: id, phoneE164: phone, phoneConfirmed: confirmed,
  username: "synthetic_" + id, notificationsEnabled: true,
});
async function fixture(page: Page, legacy = false) {
  const state = {
    user: { id: "11111111-1111-4111-8111-111111111111", fullName: "Тестовый сотрудник",
      email: "synthetic@example.invalid", phone: p1, additionalPhone: p2, role: "manager", status: "active" },
    max: [account("91001", legacy ? null : p1)],
    telegram: [account("92001", p1, false)],
    failWrite: false, failRead: false, failStart: false,
    starts: [] as Record<string, unknown>[],
  };
  await page.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let result: unknown = {}, status = 200;
    if (path === "/api/auth/me") result = { user: state.user, preview: { active: false } };
    else if (path === "/api/profile/self") {
      if (req.method() === "PATCH") Object.assign(state.user, req.postDataJSON());
      result = { user: state.user };
    } else if (path === "/api/clients/presentation") result = { presentation: { clientsHref: "/clients" } };
    else if (path === "/api/access/notifications") result = { items: [], unread: 0, total: 0, page: 1, pageSize: 30 };
    else if (/\/tanbot\/(max|telegram)(\/.*)?$/.test(path)) {
      const channel = path.split("/")[4] as "max" | "telegram", rows = state[channel];
      if (req.method() === "GET") {
        if (state.failRead) { status = 503; result = { error: { message: "Синтетический сбой проверки" } }; }
        else result = { integrationEnabled: true, linked: true, notificationsEnabled: rows[0]?.notificationsEnabled,
          accounts: rows, profilePhones: [state.user.phone, state.user.additionalPhone] };
      } else if (path.endsWith("/link/start")) {
        state.starts.push(req.postDataJSON());
        if (state.failStart) { status = 503; result = { error: { message: "Нет связи. Повторите подключение." } }; }
        else result = { deepLink: `https://${channel === "max" ? "max.ru" : "t.me"}/synthetic_bot?start=SYNTHETIC_ONLY`,
          expiresAt: new Date(Date.now() + 600000).toISOString() };
      } else if (state.failWrite) { status = 503; result = { error: { message: "Нет связи. Настройка не сохранена." } }; }
      else if (path.endsWith("/notifications")) {
        rows.find(a => a.accountId === req.postDataJSON().accountId)!.notificationsEnabled = req.postDataJSON().enabled;
      } else if (path.endsWith("/disconnect")) {
        state[channel] = rows.filter(a => a.accountId !== req.postDataJSON().accountId);
      }
    }
    await route.fulfill({ status, json: result });
  });
  return state;
}
describe("phone and messenger profile UI, synthetic API only", { concurrency: false }, () => {
  let browser: Browser, server: http.Server, url: string;
  before(async () => {
    await mkdir(evidence, { recursive: true });
    browser = await chromium.launch({ headless: true, channel: "chromium" });
    server = http.createServer(createApp());
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    url = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  });
  after(async () => {
    await browser?.close();
    if (server) await new Promise<void>(r => server.close(() => r()));
  });
  for (const width of [1440, 375]) for (const theme of ["light", "dark"]) {
    it(`connect, opt-out, network rollback, disconnect cancellation and confirmation: ${width}px ${theme}`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.addInitScript(t => localStorage.setItem("tandoor-rf-theme", t), theme);
      const state = await fixture(page);
      await page.goto(url + "/profile");
      const root = page.locator("#messenger-accounts");
      await root.getByText("Аккаунтов с уведомлениями: 2", { exact: true }).waitFor();
      assert.equal(await page.locator("#tanbot-max-section").isVisible(), false);
      assert.equal(await root.getByText("Номер выбран в ЛК", { exact: true }).count(), 1);
      assert.equal(await root.getByText("Номер подтверждён в боте", { exact: true }).count(), 1);
      await root.evaluate(el => el.scrollIntoView({ block: "start" }));
      assert.match(await root.evaluate(el => getComputedStyle(el).fontFamily), /Golos/i);
      const colors = await root.locator(".ma-muted,.ma-badge,.profile-muted").evaluateAll(elements => {
        return elements.map(el => {
          let parent: Element | null = el, background = "rgb(255,255,255)";
          while (parent) {
            const raw = getComputedStyle(parent).backgroundColor;
            const color = (raw.match(/[\d.]+/g) || []).map(Number);
            if (color.length && (color.length < 4 || color[3] === 1)) { background = raw; break; }
            parent = parent.parentElement;
          }
          return [getComputedStyle(el).color, background];
        });
      });
      const luminance = (c: string) => (c.match(/[\d.]+/g) || []).slice(0,3).map(Number).map(n => {
        const s = n/255; return s <= .04045 ? s/12.92 : ((s+.055)/1.055)**2.4;
      }).reduce((n,v,i) => n+v*[.2126,.7152,.0722][i],0);
      const contrast = colors.map(([foreground, background]) => {
        const a = luminance(foreground), b = luminance(background);
        return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      });
      assert.ok(contrast.every(n => n >= 4.5), `small status labels: ${contrast.join(",")}`);
      await page.screenshot({ path: `${evidence}/profile-${width}-${theme}.png` });
      const secondMax = root.locator(`[data-testid="ma-max-${p2}"]`);
      await secondMax.getByRole("button", { name: "Подключить MAX" }).click();
      const dialog = page.locator("#messenger-account-dialog");
      await dialog.getByRole("checkbox").uncheck();
      state.failStart = true;
      await dialog.getByRole("button", { name: "Получить ссылку" }).click();
      await dialog.getByRole("alert").getByText("Нет связи. Повторите подключение.").waitFor();
      state.failStart = false;
      await dialog.getByRole("button", { name: "Получить ссылку" }).click();
      const open = dialog.getByRole("link", { name: "Открыть MAX" });
      await open.waitFor();
      assert.deepEqual(state.starts.at(-1), { phone: p2, enableNotifications: false });
      // Activate real outbound UI without contacting any provider.
      await page.context().route("https://max.ru/**", r => r.fulfill({ body: "<title>Synthetic messenger destination</title>" }));
      const popupPromise = page.waitForEvent("popup");
      await open.click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.ok(popup.url().startsWith("https://max.ru/synthetic_bot?start="));
      await popup.close();
      assert.match(await dialog.getByLabel("Ссылка подключения").inputValue(), /SYNTHETIC_ONLY/);
      await page.screenshot({ path: `${evidence}/connect-${width}-${theme}.png` });
      state.max.push({ ...account("91002", p2, false), notificationsEnabled: false });
      await dialog.getByRole("button", { name: "Проверить подключение" }).click();
      await dialog.waitFor({ state: "hidden" });
      await root.getByText("Аккаунт подключён. Остальные привязки сохранены.", { exact: true }).waitFor();
      const toggle = secondMax.getByRole("checkbox");
      assert.equal(await toggle.isChecked(), false);
      await toggle.check();
      await root.getByText("Аккаунтов с уведомлениями: 3", { exact: true }).waitFor();
      state.failWrite = true;
      await toggle.uncheck();
      await root.getByRole("status").getByText("Нет связи. Настройка не сохранена.").waitFor();
      assert.equal(await toggle.isChecked(), true);
      state.failWrite = false;
      await toggle.uncheck();
      await root.getByText("Аккаунтов с уведомлениями: 2", { exact: true }).waitFor();
      await secondMax.getByRole("button", { name: "Отключить", exact: true }).click();
      await dialog.getByRole("button", { name: "Оставить подключённым" }).click();
      assert.equal(state.max.length, 2);
      await secondMax.getByRole("button", { name: "Отключить", exact: true }).click();
      await dialog.getByRole("button", { name: "Отключить аккаунт", exact: true }).click();
      await secondMax.getByRole("button", { name: "Подключить MAX" }).waitFor();
      assert.equal(state.max.length, 1);
      assert.equal(state.telegram.length, 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.setViewportSize({ width: width === 375 ? 1440 : 375, height: 900 });
      await secondMax.getByRole("button", { name: "Подключить MAX" }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.deepEqual(errors, []);
      await page.close();
    });
  }
  it("legacy accounts remain distinct; profile save and read-error recovery still work", async () => {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    const state = await fixture(page, true);
    await page.goto(url + "/profile");
    const root = page.locator("#messenger-accounts");
    await root.getByRole("heading", { name: "Ранее подключённые аккаунты" }).waitFor();
    assert.equal(await root.getByText("Номер подтверждён в боте", { exact: true }).count(), 0);
    await page.locator("#additional-phone").fill("+79000000003");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("button", { name: "Сохранено", exact: true }).waitFor();
    await root.getByRole("heading", { name: "+79000000003", exact: true }).waitFor();
    state.failRead = true;
    await page.reload();
    await root.getByText("Не все подключения проверены", { exact: true }).waitFor();
    assert.equal(await root.getByRole("button", { name: "Подключить MAX" }).first().isDisabled(), true);
    state.failRead = false;
    await root.getByRole("button", { name: "Повторить проверку подключений" }).click();
    await root.getByRole("heading", { name: "Ранее подключённые аккаунты" }).waitFor();
    await page.close();
  });
  it("bell summarizes multiple accounts and its profile link closes the modal", async () => {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    const state = await fixture(page);
    state.max.push(account("91002", p2));
    state.telegram.push(account("92002", p2));
    await page.goto(url + "/profile");
    await page.locator("#messenger-accounts").getByText("Аккаунтов с уведомлениями: 4", { exact: true }).waitFor();
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator("#messenger-accounts").evaluate(el => el.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${evidence}/four-accounts-desktop.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator("#an-bell, .mn-bell").first().click();
    const settings = page.locator("dialog[open] .mn-settings");
    await settings.getByText("Подключено: 2 · с уведомлениями: 2", { exact: true }).first().waitFor();
    const max = settings.locator(".mn-channel").filter({ has: page.locator("strong", { hasText: /^MAX$/ }) });
    assert.equal(await max.getByRole("checkbox").count(), 0);
    await max.getByRole("link", { name: "Настроить номера и ботов" }).click();
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.match(page.url(), /\/profile#messenger-accounts$/);
    const heading = await page.locator("#ma-title").boundingBox();
    assert.ok(heading && heading.y >= 68 && heading.y < 250);
    await page.close();
  });
});
