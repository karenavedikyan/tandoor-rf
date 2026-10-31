import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";
import { normalizeSearch, parseProductsJson, type Product } from "../../src/internal-catalog/model";
import { listItem } from "../../src/internal-catalog/repository";
import { catalogueFixture, fixtureGuid } from "../helpers/internal-catalog-fixtures";
import { resolveMockResponse } from "./helpers/clients-api-mocks";
import sharp from "sharp";

describe("internal catalogue UI (synthetic API; real import/access covered in integration)", { concurrency: false }, () => {
  let server: http.Server, browser: Browser, base: string;
  let photoBytes: Buffer;
  before(async () => {
    server = http.createServer(createApp());
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address === "object");
    base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true, channel: "chromium" });
    photoBytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: "#426428" } }).webp().toBuffer();
  });
  after(async () => { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  async function open(options: { products?: Product[]; mobile?: boolean; metaStatus?: number; empty?: boolean; product?: string; images?: boolean; brokenImages?: boolean; role?: "admin" | "manager"; forbidden?: boolean } = {}) {
    const context = await browser.newContext({ viewport: options.mobile ? { width: 375, height: 812 } : { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const products = options.products ?? catalogueFixture();
    const parsed = parseProductsJson(Buffer.from(JSON.stringify(products)));
    const control = { failList: false, hold: "", release: null as (() => void) | null };
    // Synthetic UI only. Real HTML/admin authorization is covered in integration.
    await page.route(url => url.pathname === "/internal-catalog", async route => {
      await route.fulfill({ contentType: "text/html",
        body: await readFile(path.resolve("server/pages/internal-catalog.html"), "utf8") });
    });
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url()), pathname = url.pathname;
      let status = 200, data: unknown;
      if (pathname === "/api/internal-catalog/meta") {
        status = options.metaStatus ?? 200;
        data = status !== 200 ? { error: { message: "Нет доступа" } } : { imagesConfigured: options.images === true, snapshot: options.empty ? null : {
          id: fixtureGuid(900), sha256: parsed.sha256, sourceName: "synthetic.json",
          importedAt: "2026-10-31T08:00:00Z", summary: parsed.summary,
        } };
      } else if (pathname === "/api/internal-catalog/products") {
        if (control.failList) { status = 503; data = { error: { message: "Тестовая ошибка загрузки" } }; }
        else {
          const q = normalizeSearch(url.searchParams.get("q") ?? "");
          if (control.hold && q === control.hold) await new Promise<void>(resolve => { control.release = resolve; });
          const filtered = products.filter(p => {
            const item = listItem(p), search = normalizeSearch([p.name, p.guid, item.article].join(" "));
            return q.split(" ").filter(Boolean).every(word => search.includes(word)) &&
              (!url.searchParams.get("section") || p.chapter.some(x => x.guid === url.searchParams.get("section"))) &&
              (!url.searchParams.get("brand") || item.brand === url.searchParams.get("brand"));
          }).sort((a, b) => a.name.localeCompare(b.name, "ru"));
          const pageNumber = Math.min(Number(url.searchParams.get("page") || 1), Math.max(1, Math.ceil(filtered.length / 24)));
          data = { snapshotId: fixtureGuid(900), total: filtered.length, page: pageNumber, pageSize: 24,
            items: filtered.slice((pageNumber - 1) * 24, pageNumber * 24).map(listItem) };
        }
      } else if (pathname.includes("/images/")) {
        await route.fulfill(options.brokenImages ? { status: 404, body: "unavailable" } :
          { status: 200, contentType: "image/webp", body: photoBytes });
        return;
      } else if (pathname.startsWith("/api/internal-catalog/products/")) {
        const product = products.find(x => x.guid === pathname.split("/").pop());
        status = product ? 200 : 404;
        data = product ? { snapshotId: fixtureGuid(900), importedAt: "2026-10-31T08:00:00Z", product } : { error: { message: "Товар не найден" } };
      } else {
        const mock = resolveMockResponse(url, { role: options.role ?? "admin" }, { listCalls: 0, catalogProductsCalls: 0 }, route.request().method());
        if (mock) { await route.fulfill(mock); return; }
        status = 404; data = { error: "not mocked" };
      }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto(base + "/internal-catalog" + (options.product ? "?product=" + options.product : ""));
    if (!options.empty && !options.metaStatus && !options.forbidden) await page.locator(".ic-card").first().waitFor();
    return { page, context, errors, control };
  }
  async function idle(page: Page, count: number) {
    await page.waitForFunction(expected => document.querySelector("#ic-count")?.textContent === `Найдено: ${expected} из 30` &&
      document.querySelector("#ic-results")?.getAttribute("aria-busy") === "false", count);
  }
  it("hides catalogue navigation and blocks UI boot for non-admin staff", async () => {
    const { page, context, errors } = await open({ role: "manager", forbidden: true, mobile: true });
    try {
      await page.getByText("Раздел доступен только администратору для тестирования.", { exact: true }).waitFor();
      assert.equal(await page.locator('a[href="/internal-catalog"]').count(), 0);
      assert.equal(await page.locator(".ic-card").count(), 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  it("shows opt-in covers/gallery with pinned same-origin URLs and mobile-safe layout", async () => {
    const products = catalogueFixture();
    products[0].files.push({ guid: fixtureGuid(301), name: 'Фото "2" <без HTML>', path: "second.png" });
    const { page, context, errors } = await open({ mobile: true, images: true, products });
    try {
      const cover = page.locator(".ic-cover img");
      await cover.evaluate((img: HTMLImageElement) => img.decode());
      assert.equal(await cover.count(), 1);
      const href = await page.locator(".ic-cover a").getAttribute("href");
      assert.equal(href, "/api/internal-catalog/products/" + fixtureGuid(1) + "/images/" + fixtureGuid(300) + "?version=" + fixtureGuid(900));
      assert.equal(await page.locator(".ic-cover a").getAttribute("target"), "_blank");
      await page.locator(".ic-card-footer").first().click();
      await page.locator(".ic-gallery img").first().evaluate((img: HTMLImageElement) => img.decode());
      assert.equal(await page.locator(".ic-gallery img").count(), 2);
      assert.equal(await page.locator(".ic-gallery img").nth(1).getAttribute("alt"), 'Фото "2" <без HTML>');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#ic-detail").evaluate((dialog: HTMLDialogElement) => dialog.open), false);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  it("missing photos show a readable fallback without breaking cards or characteristics", async () => {
    const { page, context, errors } = await open({ images: true, brokenImages: true });
    try {
      await page.locator(".ic-cover .ic-image-error").waitFor({ state: "visible" });
      assert.equal(await page.locator(".ic-cover a").isVisible(), false);
      await page.locator(".ic-card-footer").first().click();
      await page.locator(".ic-gallery .ic-image-error").waitFor({ state: "visible" });
      assert.equal(await page.locator(".ic-properties").first().isVisible(), true);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  it("searches, combines filters, resets and changes pages without losing controls", async () => {
    const { page, context, errors } = await open();
    await page.getByLabel("Найти товар", { exact: true }).fill("ЕЛКА 100%_");
    await page.getByRole("button", { name: "Найти", exact: true }).click(); await idle(page, 1);
    await page.getByLabel("Бренд", { exact: true }).selectOption("Альфа"); await idle(page, 1);
    await page.getByLabel("Раздел", { exact: true }).selectOption(fixtureGuid(101)); await idle(page, 0);
    assert.ok(await page.getByRole("heading", { name: "Ничего не найдено" }).isVisible());
    await page.getByRole("button", { name: "Показать все товары" }).click(); await idle(page, 30);
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#ic-page-label")?.textContent === "Страница 2 из 2");
    assert.equal(await page.locator(".ic-card").count(), 6);
    await page.getByRole("button", { name: "Назад", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".ic-card").length === 24);
    assert.deepEqual(errors, []); await context.close();
  });
  it("renders hostile text inertly, keeps filters after modal/Escape and handles history/deep links", async () => {
    const products = catalogueFixture(30); products[0].name = '<img src=x onerror="window.INJECTED=true">';
    products[0].properties[0].value = "<script>window.INJECTED=true</script>";
    const { page, context, errors } = await open({ products });
    await page.getByLabel("Найти товар", { exact: true }).fill(fixtureGuid(1));
    await page.getByRole("button", { name: "Найти", exact: true }).click(); await idle(page, 1);
    await page.locator(".ic-card-footer").click(); await page.locator(".ic-properties").first().waitFor();
    assert.equal(await page.locator("#ic-detail-title img").count(), 0);
    assert.equal(await page.evaluate(() => (window as unknown as Record<string, unknown>).INJECTED), undefined);
    assert.match(await page.locator("#ic-detail-title").textContent() ?? "", /<img/);
    await page.keyboard.press("Escape"); await page.waitForURL(url => !url.searchParams.has("product"));
    assert.equal(await page.getByLabel("Найти товар", { exact: true }).inputValue(), fixtureGuid(1));
    await page.goForward(); await page.locator(".ic-properties").first().waitFor();
    await page.getByRole("button", { name: "Закрыть", exact: true }).click(); await page.waitForURL(url => !url.searchParams.has("product"));
    assert.deepEqual(errors, []); await context.close();
    const deep = await open({ product: fixtureGuid(1) });
    await deep.page.locator(".ic-properties").first().waitFor();
    await deep.page.getByRole("button", { name: "Закрыть", exact: true }).click();
    assert.equal(new URL(deep.page.url()).searchParams.has("product"), false);
    await deep.context.close();
  });
  it("shows local error/retry and does not leave stale data labelled as current", async () => {
    const { page, context, control } = await open();
    control.failList = true;
    await page.getByRole("button", { name: "Найти", exact: true }).click();
    await page.getByRole("heading", { name: "Не удалось выполнить поиск" }).waitFor();
    assert.equal(await page.locator(".ic-card").count(), 0);
    control.failList = false;
    await page.getByRole("button", { name: "Повторить", exact: true }).click(); await idle(page, 30);
    await context.close();
  });
  it("ignores an older search response after a newer search completes", async () => {
    const { page, context, control } = await open();
    control.hold = "елка";
    await page.getByLabel("Найти товар", { exact: true }).fill("елка");
    const slowRequest = page.waitForRequest(request => new URL(request.url()).searchParams.get("q") === "елка");
    await page.getByRole("button", { name: "Найти", exact: true }).click();
    await slowRequest;
    await page.getByLabel("Найти товар", { exact: true }).fill("ART-30");
    await page.getByRole("button", { name: "Найти", exact: true }).click(); await idle(page, 1);
    assert.ok(control.release);
    const oldResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get("q") === "елка");
    control.release!(); await oldResponse;
    assert.match(await page.locator(".ic-card h2").textContent() ?? "", /030/);
    await context.close();
  });
  it("has distinct empty/forbidden states without exposing product data", async () => {
    const empty = await open({ empty: true });
    await empty.page.getByRole("heading", { name: "Каталог ещё не загружен" }).waitFor();
    assert.equal(await empty.page.locator(".ic-card").count(), 0); await empty.context.close();
    const denied = await open({ metaStatus: 403 });
    await denied.page.getByRole("heading", { name: "Каталог недоступен" }).waitFor();
    assert.match(await denied.page.locator("#ic-state").textContent() ?? "", /Нет доступа/);
    assert.equal(await denied.page.locator("#ic-app").isVisible(), false); await denied.context.close();
  });
  it("fits 375px, opens/closes a full-height card, and remains usable in dark/large type", async () => {
    const { page, context, errors } = await open({ mobile: true });
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(await overflow(), false);
    await page.locator(".ic-card-footer").first().click(); await page.locator(".ic-properties").first().waitFor();
    assert.equal(await overflow(), false);
    const detailBox = await page.locator("#ic-detail").boundingBox();
    assert.ok(detailBox && Math.abs(detailBox.width - 375) < 1 && Math.abs(detailBox.height - 812) < 1);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.waitForURL(url => !url.searchParams.has("product"));
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.fontSize = "200%"; });
    assert.equal(await overflow(), false);
    assert.deepEqual(errors, []); await context.close();
  });
});
