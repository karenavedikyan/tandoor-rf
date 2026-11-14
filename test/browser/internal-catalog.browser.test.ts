import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server";
import { normalizeSearch, parseProductsJson, type Product } from "../../src/internal-catalog/model";
import { listItem } from "../../src/internal-catalog/repository";
import { catalogueFixture, sizeVariantsFixture, fixtureGuid } from "../helpers/internal-catalog-fixtures";
import { productFamilies, productSize } from "../../src/internal-catalog/variants";
import type { CatalogContext } from "../../src/internal-catalog/presentation";
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
  async function open(options: { products?: Product[]; variants?: boolean; mobile?: boolean; metaStatus?: number; empty?: boolean; product?: string; images?: boolean; brokenImages?: boolean; role?: "admin" | "manager"; forbidden?: boolean; workspace?: boolean } = {}) {
    const context = await browser.newContext({ viewport: options.mobile ? { width: 375, height: 812 } : { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const products = options.products ?? catalogueFixture();
    const parsed = parseProductsJson(Buffer.from(JSON.stringify(products)));
    const commerce = { prices: [{ guid: fixtureGuid(800), name: "РРЦ Тандор", value: 12500, conflict: false }],
      warehouses: [{ guid: fixtureGuid(801), name: "Склад 1С", value: 12, conflict: false }], quantity: 12,
      pricesImportedAt: "2026-11-14T08:00:00Z", stocksImportedAt: "2026-11-14T08:00:00Z" };
    const commerceFor = (p: Product) => options.variants ? { ...commerce, quantity: 12 + products.indexOf(p),
      warehouses: [{ ...commerce.warehouses[0], value: 12 + products.indexOf(p) }] } : commerce;
    const catalogContext: CatalogContext = { groups: [], priceTypes: [], commerce: new Map(products.map(p => [p.guid, commerceFor(p)])) };
    const families = () => productFamilies(products, catalogContext, fixtureGuid(800));
    const variant = (p: Product) => ({ ...listItem(p), size: productSize(p), commerce: commerceFor(p) });
    const control = { failList: false, hold: "", release: null as (() => void) | null,
      imported: false, uploadCalls: 0, uploadHash: "", failUpload: false };
    // Synthetic UI only. Real HTML/admin authorization is covered in integration.
    await page.route(url => url.pathname === "/internal-catalog", async route => {
      await route.fulfill({ contentType: "text/html",
        body: await readFile(path.resolve("server/pages/internal-catalog.html"), "utf8") });
    });
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url()), pathname = url.pathname;
      let status = 200, data: unknown;
      if (pathname === "/api/internal-catalog/bootstrap") {
        control.uploadCalls++; control.uploadHash = route.request().headers()["x-content-sha256"];
        status = control.failUpload ? 400 : 201;
        data = { status: control.failUpload ? "invalid" : "imported" };
        if (!control.failUpload) control.imported = true;
      } else if (pathname === "/api/internal-catalog/meta") {
        status = options.metaStatus ?? 200;
        data = status !== 200 ? { error: { message: "Нет доступа" } } : { imagesConfigured: options.images === true, snapshot: options.empty && !control.imported ? null : {
          id: fixtureGuid(900), sha256: parsed.sha256, sourceName: "synthetic.json",
          importedAt: "2026-10-31T08:00:00Z", summary: parsed.summary,
        }, ...(options.workspace ? { groups: [{ guid: fixtureGuid(810), name: "Группа 1С", parent: null }],
          groupCounts: [{ guid: fixtureGuid(810), count: products.length }], priceTypes: [{ guid: fixtureGuid(800), name: "РРЦ Тандор" }],
          facets: [{ name: "Цвет", values: ["Белый", "Серый"] }] } : {}) };
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
          if (options.variants) {
            const matches = new Set(filtered.map(p => p.guid));
            const items = families().map(f => ({ ...f, selected: f.products.find(p => matches.has(p.guid)) }))
              .filter(f => f.selected).map(f => ({ ...variant(f.selected!), modelName: f.modelName,
                variants: f.products.map(p => ({ ...variant(p), matchesFilters: matches.has(p.guid) })) }));
            const pageNumber = Math.min(Number(url.searchParams.get("page") || 1), Math.max(1, Math.ceil(items.length / 24)));
            data = { snapshotId: fixtureGuid(900), total: items.length, matchedProducts: filtered.length, page: pageNumber, pageSize: 24,
              items: items.slice((pageNumber - 1) * 24, pageNumber * 24) };
          } else {
          const pageNumber = Math.min(Number(url.searchParams.get("page") || 1), Math.max(1, Math.ceil(filtered.length / 24)));
          data = { snapshotId: fixtureGuid(900), total: filtered.length, page: pageNumber, pageSize: 24,
            items: filtered.slice((pageNumber - 1) * 24, pageNumber * 24).map(p => ({
              ...listItem(p), ...(options.workspace ? { commerce } : {}),
            })) };
          }
        }
      } else if (pathname.includes("/images/")) {
        await route.fulfill(options.brokenImages ? { status: 404, body: "unavailable" } :
          { status: 200, contentType: "image/webp", body: photoBytes });
        return;
      } else if (pathname.startsWith("/api/internal-catalog/products/")) {
        const product = products.find(x => x.guid === pathname.split("/").pop());
        status = product ? 200 : 404;
        data = product ? { snapshotId: fixtureGuid(900), importedAt: "2026-10-31T08:00:00Z", product,
          ...(options.workspace ? { commerce: commerceFor(product), ...(options.variants ?
            { variants: families().find(f => f.products.some(p => p.guid === product.guid))?.products.map(variant) } : {}) } : {}) } : { error: { message: "Товар не найден" } };
      } else {
        const mock = resolveMockResponse(url, { role: options.role ?? "admin" }, { listCalls: 0, catalogProductsCalls: 0 }, route.request().method());
        if (mock) { await route.fulfill(mock); return; }
        status = 404; data = { error: "not mocked" };
      }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto(base + "/internal-catalog" + (options.product ? "?product=" + options.product : ""));
    if (!options.empty && !options.metaStatus && !options.forbidden) await page.locator(".cat-card").first().waitFor();
    return { page, context, errors, control };
  }
  async function idle(page: Page, count: number) {
    await page.waitForFunction(expected => document.querySelector("#ic-count")?.textContent === `Найдено: ${expected} из 30` &&
      document.querySelector("#ic-results")?.getAttribute("aria-busy") === "false", count);
  }
  for (const mobile of [false, true]) it(`selects real size-specific data in every view and detail (${mobile ? "mobile" : "desktop"})`, async () => {
    const { page, context, errors } = await open({ products: sizeVariantsFixture(), workspace: true, variants: true, images: true, mobile });
    try {
      assert.equal(await page.locator(".cat-card").count(), 1);
      assert.match(await page.locator("#ic-count").textContent() ?? "", /карточек: 1.*товаров: 4/);
      for (const view of ["show", "site", "table"]) {
        await page.locator(`[data-view="${view}"]`).click();
        const button = page.locator('#ic-results [data-action="size"]').filter({ hasText: "2000×800" });
        await button.click();
        assert.equal(await button.getAttribute("aria-pressed"), "true");
        assert.match(await page.locator("#ic-results .cat-stock").textContent() ?? "", /14/);
        assert.match(await page.locator("#ic-results img").first().getAttribute("src") ?? "", new RegExp(fixtureGuid(3)));
      }
      await page.locator('[data-view="show"]').click();
      await page.locator(".cat-name").first().click();
      await page.locator('#ic-detail [data-action="detail-size"]').last().waitFor();
      assert.match(await page.locator("#ic-detail-title").textContent() ?? "", /2000\*800/);
      await page.locator('#ic-detail [data-action="detail-size"]').filter({ hasText: "2000×900" }).click();
      await page.waitForFunction(() => document.querySelector("#ic-detail-title")?.textContent?.includes("2000*900"));
      assert.match(page.url(), new RegExp("product=" + fixtureGuid(4)));
      assert.match(await page.locator(".cat-stocktable").textContent() ?? "", /15/);
      await page.locator('#ic-detail [data-action="reply"]').click();
      assert.match(await page.locator("#ic-copy-text").inputValue(), /2000\*900/);
      await page.locator('[data-close="copy"]').click();
      await page.locator("#ic-close").click();
      await page.waitForURL(url => !url.searchParams.has("product"));
      await page.locator("#ic-query").fill("2000*800");
      await page.waitForFunction(() => document.querySelector("#ic-results")?.getAttribute("aria-busy") === "false" &&
        document.querySelector('#ic-results [data-action="size"][aria-pressed="true"]')?.textContent === "2000×800" &&
        document.querySelectorAll('#ic-results [data-action="size"][title]').length === 3);
      assert.equal(await page.locator('#ic-results [data-action="size"][title]').count(), 3);
      await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `/home/user/workspace/catalog-sizes-${mobile ? "mobile" : "desktop"}.png`, fullPage: true });
      await page.goto(base + "/internal-catalog?product=" + fixtureGuid(2));
      await page.locator('#ic-detail [data-action="detail-size"]').last().waitFor();
      assert.match(await page.locator("#ic-detail-title").textContent() ?? "", /2000\*700/);
      await page.locator('#ic-detail [data-action="detail-size"]').filter({ hasText: "2000×600" }).click();
      await page.waitForFunction(() => document.querySelector("#ic-detail-title")?.textContent?.includes("2000*600"));
      await page.locator("#ic-close").click();
      await page.waitForURL(url => !url.searchParams.has("product"));
      assert.equal(await page.locator("#ic-detail").evaluate((d: HTMLDialogElement) => d.open), false);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  it("uploads only after explicit confirmation and removes the form after success", async () => {
    const { page, context, errors, control } = await open({ empty: true, mobile: true });
    try {
      const button = page.getByRole("button", { name: "Загрузить каталог", exact: true });
      assert.equal(await button.isDisabled(), true);
      await page.locator("#ic-import-file").setInputFiles({ name: "products.json", mimeType: "application/json", buffer: Buffer.from("synthetic bytes") });
      assert.equal(control.uploadCalls, 0); assert.equal(await button.isEnabled(), true);
      control.failUpload = true; await button.click();
      await page.getByText("Не удалось принять выгрузку. Проверьте JSON и повторите попытку.", { exact: true }).waitFor();
      assert.equal(control.uploadCalls, 1);
      control.failUpload = false; await button.click(); await page.locator(".cat-card").first().waitFor();
      assert.equal(control.uploadCalls, 2); assert.match(control.uploadHash, /^[a-f0-9]{64}$/);
      assert.equal(await page.locator("#ic-import-file").count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  it("hides catalogue navigation and blocks UI boot for non-admin staff", async () => {
    const { page, context, errors } = await open({ role: "manager", forbidden: true, mobile: true });
    try {
      await page.getByText("Раздел доступен только администратору для тестирования.", { exact: true }).waitFor();
      assert.equal(await page.locator('a[href="/internal-catalog"]').count(), 0);
      assert.equal(await page.locator(".cat-card").count(), 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  it("shows opt-in covers/gallery with pinned same-origin URLs and mobile-safe layout", async () => {
    const products = catalogueFixture();
    products[0].files.push({ guid: fixtureGuid(301), name: 'Фото "2" <без HTML>', path: "second.png" });
    const { page, context, errors } = await open({ mobile: true, images: true, products });
    try {
      const cover = page.locator("#ic-results .cat-img img").first();
      await cover.evaluate((img: HTMLImageElement) => img.decode());
      assert.equal(await cover.count(), 1);
      const href = await cover.getAttribute("src");
      assert.equal(href, "/api/internal-catalog/products/" + fixtureGuid(1) + "/images/" + fixtureGuid(300) + "?version=" + fixtureGuid(900));
      await page.locator(".cat-card .cat-name").first().click();
      await page.locator(".cat-gallery .cat-img img").evaluate((img: HTMLImageElement) => img.decode());
      assert.equal(await page.locator(".cat-thumbs button").count(), 2);
      await page.locator(".cat-thumbs button").nth(1).click();
      assert.match(await page.locator(".cat-gallery .cat-img img").getAttribute("alt") ?? "", /Фото "2" <без HTML>/);
      await page.locator(".cat-gallery .cat-zoom").click();
      await page.locator("#ic-light[open]").waitFor();
      await page.keyboard.press("ArrowLeft");
      assert.match(await page.locator(".cat-light-n").textContent() ?? "", /1 \/ 2/);
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#ic-detail").evaluate((dialog: HTMLDialogElement) => dialog.open), false);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  it("missing photos show a readable fallback without breaking cards or characteristics", async () => {
    const { page, context, errors } = await open({ images: true, brokenImages: true });
    try {
      await page.locator("#ic-results .cat-img-missing").first().waitFor({ state: "visible" });
      await page.locator(".cat-card").first().click();
      await page.locator(".cat-gallery .cat-img-missing").waitFor({ state: "visible" });
      assert.equal(await page.locator(".cat-specs").first().isVisible(), true);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  it("searches, combines filters, resets and changes pages without losing controls", async () => {
    const { page, context, errors } = await open();
    await page.getByLabel("Найти товар", { exact: true }).fill("ЕЛКА 100%_");
    await page.locator("#ic-query").press("Enter"); await idle(page, 1);
    await page.locator("#ic-filter-open").click();
    await page.getByLabel("Бренд", { exact: true }).selectOption("Альфа"); await idle(page, 1);
    await page.getByLabel("Раздел", { exact: true }).selectOption(fixtureGuid(101)); await idle(page, 0);
    await page.locator(".cat-fclose").click();
    assert.ok(await page.getByRole("heading", { name: "Ничего не найдено" }).isVisible());
    await page.locator("#ic-empty-reset").click(); await idle(page, 30);
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#ic-page-label")?.textContent === "Страница 2 из 2");
    assert.equal(await page.locator(".cat-card").count(), 6);
    await page.locator("#ic-prev").click();
    await page.waitForFunction(() => document.querySelectorAll(".cat-card").length === 24);
    assert.deepEqual(errors, []); await context.close();
  });
  it("renders hostile text inertly, keeps filters after modal/Escape and handles history/deep links", async () => {
    const products = catalogueFixture(30); products[0].name = '<img src=x onerror="window.INJECTED=true">';
    products[0].properties[0].value = "<script>window.INJECTED=true</script>";
    const { page, context, errors } = await open({ products });
    await page.getByLabel("Найти товар", { exact: true }).fill(fixtureGuid(1));
    await page.locator("#ic-query").press("Enter"); await idle(page, 1);
    await page.locator(".cat-card").click(); await page.locator(".cat-specs").first().waitFor();
    assert.equal(await page.locator("#ic-detail-title img").count(), 0);
    assert.equal(await page.evaluate(() => (window as unknown as Record<string, unknown>).INJECTED), undefined);
    assert.match(await page.locator("#ic-detail-title").textContent() ?? "", /<img/);
    await page.keyboard.press("Escape"); await page.waitForURL(url => !url.searchParams.has("product"));
    assert.equal(await page.getByLabel("Найти товар", { exact: true }).inputValue(), fixtureGuid(1));
    await page.goForward(); await page.locator(".cat-specs").first().waitFor();
    await page.locator("#ic-close").click(); await page.waitForURL(url => !url.searchParams.has("product"));
    assert.deepEqual(errors, []); await context.close();
    const deep = await open({ product: fixtureGuid(1) });
    await deep.page.locator(".cat-specs").first().waitFor();
    await deep.page.getByRole("button", { name: "Закрыть", exact: true }).click();
    assert.equal(new URL(deep.page.url()).searchParams.has("product"), false);
    await deep.context.close();
  });
  it("shows local error/retry and does not leave stale data labelled as current", async () => {
    const { page, context, control } = await open();
    control.failList = true;
    await page.locator("#ic-query").press("Enter");
    await page.getByRole("heading", { name: "Не удалось выполнить поиск" }).waitFor();
    assert.equal(await page.locator(".cat-card").count(), 0);
    control.failList = false;
    await page.getByRole("button", { name: "Повторить", exact: true }).click(); await idle(page, 30);
    await context.close();
  });
  it("ignores an older search response after a newer search completes", async () => {
    const { page, context, control } = await open();
    control.hold = "елка";
    await page.getByLabel("Найти товар", { exact: true }).fill("елка");
    const slowRequest = page.waitForRequest(request => new URL(request.url()).searchParams.get("q") === "елка");
    await page.locator("#ic-query").press("Enter");
    await slowRequest;
    await page.getByLabel("Найти товар", { exact: true }).fill("ART-30");
    await page.locator("#ic-query").press("Enter"); await idle(page, 1);
    assert.ok(control.release);
    const oldResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get("q") === "елка");
    control.release!(); await oldResponse;
    assert.match(await page.locator(".cat-card .cat-name").textContent() ?? "", /030/);
    await context.close();
  });
  it("has distinct empty/forbidden states without exposing product data", async () => {
    const empty = await open({ empty: true });
    await empty.page.getByRole("heading", { name: "Каталог ещё не загружен" }).waitFor();
    assert.equal(await empty.page.locator(".cat-card").count(), 0); await empty.context.close();
    const denied = await open({ metaStatus: 403 });
    await denied.page.getByRole("heading", { name: "Каталог недоступен" }).waitFor();
    assert.match(await denied.page.locator("#ic-state").textContent() ?? "", /только администратору/);
    assert.equal(await denied.page.locator("#ic-app").isVisible(), false); await denied.context.close();
  });
  it("fits 375px, opens/closes a full-height card, and remains usable in dark/large type", async () => {
    const { page, context, errors } = await open({ mobile: true });
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(await overflow(), false);
    await page.locator(".cat-card").first().click(); await page.locator(".cat-specs").first().waitFor();
    assert.equal(await overflow(), false);
    const detailBox = await page.locator("#ic-detail").boundingBox();
    assert.ok(detailBox && Math.abs(detailBox.width - 375) < 1 && Math.abs(detailBox.height - 812) < 1);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.waitForURL(url => !url.searchParams.has("product"));
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.fontSize = "200%"; });
    assert.equal(await overflow(), false);
    assert.deepEqual(errors, []); await context.close();
  });
  it("switches prototype layouts, filters source data, masks client presentation, copies manually and exits fullscreen", async () => {
    const { page, context, errors } = await open({ workspace: true });
    try {
      assert.match(await page.locator(".cat-price").first().textContent() ?? "", /12.500/);
      await page.locator('[data-view="site"]').click();
      assert.equal(await page.locator(".view-site .cat-head").count(), 24);
      await page.locator('[data-view="table"]').click();
      assert.equal(await page.locator(".cat-table tbody tr").count(), 24);
      await page.locator("#ic-client-view").check();
      assert.equal(await page.locator(".cat-table th").filter({ hasText: "Цена из 1С" }).count(), 0);
      assert.equal(await page.getByText("Остаток в 1С · 12", { exact: true }).count(), 0);
      await page.locator('[data-view="show"]').click();
      await page.locator(".cat-card").first().click();
      await page.locator(".cat-specs").first().waitFor();
      assert.equal(await page.locator(".cat-pricebox").count(), 0);
      await page.locator('#ic-detail [data-action="reply"]').click();
      await page.locator("#ic-copy[open]").waitFor();
      const reply = await page.locator("#ic-copy-text").inputValue();
      assert.doesNotMatch(reply, /12.?500|Склад 1С|РРЦ Тандор/);
      await page.locator('[data-close="copy"]').click();
      await page.locator("#ic-close").click();
      await page.waitForURL(url => !url.searchParams.has("product"));
      await page.locator("#ic-client-view").uncheck();
      await page.locator("#ic-filter-open").click();
      assert.equal(await page.locator("#ic-filters").isVisible(), true);
      const filtered = page.waitForRequest(request => {
        const u = new URL(request.url()); return u.pathname.endsWith("/products") && u.searchParams.get("filters") === JSON.stringify({ Цвет: ["Белый"] });
      });
      await page.locator('[data-property="Цвет"][value="Белый"]').check(); await filtered;
      await page.locator(".cat-fclose").click();
      const grouped = page.waitForRequest(request => new URL(request.url()).searchParams.get("group") === fixtureGuid(810));
      await page.locator('#ic-tree [data-group]').filter({ hasText: "Группа 1С" }).click(); await grouped;
      await page.locator("#ic-full").click();
      assert.equal(await page.locator("body").evaluate(el => el.classList.contains("cat-fullscreen")), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("body").evaluate(el => el.classList.contains("cat-fullscreen")), false);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  it("matches measured prototype typography, colors, spacing and responsive image geometry", async () => {
    const { page, context, errors } = await open({ workspace: true });
    try {
      for (const mobile of [false, true]) for (const dark of [false, true]) {
        await page.setViewportSize(mobile ? { width: 375, height: 812 } : { width: 1440, height: 1000 });
        await page.evaluate(dark => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, dark);
        const actual = await page.evaluate(() => {
          const [cat, input, toolbar, grid, body, name, price, color, filter, image] = [
            ".cat", ".cat-search input", ".cat-toolbar", ".cat-grid", ".cat-body", ".cat-name", ".cat-price", ".cat-color", ".cat-filterbtn", ".view-show .cat-img",
          ].map(selector => getComputedStyle(document.querySelector(selector)!));
          return {
            font: cat.fontFamily, base: cat.fontSize, line: cat.lineHeight,
            input: input.fontSize, inputHeight: input.minHeight,
            toolbarPadding: toolbar.padding, toolbarBg: toolbar.backgroundColor,
            gap: grid.gap, columns: grid.gridTemplateColumns.split(" ").length,
            cardPadding: body.padding, name: name.fontSize,
            nameWeight: name.fontWeight, price: price.fontSize,
            priceWeight: price.fontWeight, text: name.color,
            muted: color.color, green: filter.backgroundColor,
            imageRatio: image.aspectRatio,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        assert.deepEqual(actual, {
          font: "Golos, sans-serif", base: "14px", line: "20.3px", input: "16px", inputHeight: "44px",
          toolbarPadding: mobile ? "10px 12px" : "14px 16px", toolbarBg: dark ? "rgb(34, 44, 37)" : "rgb(255, 255, 255)",
          gap: mobile ? "10px" : "14px", columns: mobile ? 2 : 3, cardPadding: mobile ? "10px 12px 12px" : "12px 14px 14px",
          name: mobile ? "14px" : "16px", nameWeight: "650", price: mobile ? "16px" : "18px", priceWeight: "700",
          text: dark ? "rgb(236, 240, 233)" : "rgb(35, 44, 53)", muted: dark ? "rgb(167, 178, 169)" : "rgb(105, 118, 131)",
          green: dark ? "rgb(168, 203, 120)" : "rgb(80, 127, 34)", imageRatio: "2 / 3", overflow: false,
        }, `mobile=${mobile}, dark=${dark}`);
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
});
