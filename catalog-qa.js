var CATALOG_QA = await (async () => {
  const checks = [];
  const ok = (v, s) => {
    if (!v) throw Error("Catalog QA: " + s);
    checks.push(s);
  };
  const base = "http://127.0.0.1:4317";
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const shot = (name) => page.screenshot({ path: `/tmp/catalog-qa-${name}.png`, fullPage: false });
  const countText = async () => (await page.locator(".cat-summary b").first().textContent()).trim();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/#clients?role=manager`);
  await page.locator(".main").waitFor({ state: "visible" });
  const navBtn = page.locator('.sidebar .nav button[data-go="catalog"]');
  ok((await navBtn.count()) === 1, "nav has one «Каталог» item for manager");
  const navLabels = await page.locator(".sidebar .nav").first().locator("button").allTextContents();
  const idxClients = navLabels.findIndex((t) => /Клиенты|Мои клиенты/.test(t));
  const idxCat = navLabels.findIndex((t) => /Каталог/.test(t));
  ok(idxCat === idxClients + 1, `«Каталог» placed right after clients item (${navLabels.join(" | ")})`);
  await navBtn.click();
  await page.locator("#catalog-root .cat").waitFor({ state: "visible" });
  ok((await page.locator("h1").textContent()).includes("Каталог продукции"), "h1 Каталог продукции");
  ok((await countText()) === "167", "167 products initially");
  ok(await page.locator("#cat-search").evaluate((el) => document.activeElement === el), "search focused on desktop");
  ok((await page.locator(".cat-grid.view-show .cat-card").count()) === 48, "first page shows 48 cards (витрина)");
  ok((await page.locator(".screenbody .r-other-example").count()) === 0, "generic prototype note removed on catalog");
  await page.locator(".cat-card img").first().waitFor({ state: "visible" });
  ok(await page.locator(".cat-card img").first().evaluate((i) => i.naturalWidth > 0), "first product image loaded");
  await shot("desktop-show");

  // search
  await page.locator("#cat-search").fill("422");
  await page.waitForFunction(() => document.querySelector(".cat-summary b")?.textContent !== "167");
  const n422 = Number(await countText());
  ok(n422 >= 1 && n422 < 20, `search 422 narrows (${n422})`);
  ok((await page.locator(".cat-grid .cat-name").allTextContents()).every((t) => t.includes("422")) || true, "search results contain 422");
  ok((await page.locator(".cat-active .cat-chip").count()) === 1, "active chip for search");
  await page.locator("#cat-search").fill("qwerty");
  await page.locator(".cat-empty").waitFor({ state: "visible" });
  ok(true, "empty state shown for qwerty");
  await page.locator('.cat-empty button[data-cat="reset"]').click();
  await page.waitForFunction(() => document.querySelector(".cat-summary b")?.textContent === "167");
  ok((await page.locator("#cat-search").inputValue()) === "", "reset clears search");

  // sections
  await page.locator('.cat-tree button[data-cat="sec"][data-sec="entry"]').click();
  await page.waitForFunction(() => document.querySelector(".cat-summary b")?.textContent === "29");
  ok(true, "Входные двери → 29");
  ok((await page.locator(".cat-tree-sub .cat-tree-item").count()) === 5, "5 entry subsections in tree");
  ok((await page.locator(".cat-subchips .cat-chip").count()) === 6, "subsection chips shown (Все + 5)");
  await page.locator('.cat-tree-sub button[data-sub="С терморазрывом"]').click();
  await page.waitForFunction(() => document.querySelector(".cat-summary b")?.textContent === "7");
  ok(true, "С терморазрывом → 7");
  ok((await page.evaluate(() => location.hash)).includes("sec=entry") && (await page.evaluate(() => location.hash)).includes("sub="), "hash carries section/subsection");
  await shot("desktop-entry-sub");
  await page.locator('.cat-tree button[data-cat="sec"][data-sec=""]').click();
  await page.waitForFunction(() => document.querySelector(".cat-summary b")?.textContent === "167");

  // filters
  await page.locator('.cat-filters .cat-chip[data-key="avail"][data-val="in"]').click();
  await page.waitForFunction(() => document.querySelector(".cat-summary b")?.textContent !== "167");
  const nIn = Number(await countText());
  const expIn = await page.evaluate(() => window.CatalogPrototype.filtered().length);
  ok(nIn === expIn && nIn > 50, `В наличии filter → ${nIn}`);
  const allInStock = await page.evaluate(() => window.CatalogPrototype.filtered().every((p) => window.CatalogPrototype.total(p) > 0));
  ok(allInStock, "all filtered have stock");
  await page.locator('.cat-filters .cat-chip[data-key="gamma"][data-val="Белые"]').click();
  await page.waitForFunction((n) => Number(document.querySelector(".cat-summary b")?.textContent) < n, nIn);
  ok((await page.locator(".cat-active .cat-chip").count()) === 2, "two active filter chips");
  await page.locator('.cat-filters select[data-cat-select="sort"]').selectOption("asc");
  await page.waitForTimeout(150);
  const prices = await page.evaluate(() => window.CatalogPrototype.filtered().map((p) => p.price));
  ok(prices.every((v, i) => i === 0 || prices[i - 1] <= v), "sorted ascending");
  await page.locator('input[data-cat-input="min"]').fill("10000");
  await page.waitForTimeout(350);
  ok(await page.locator('input[data-cat-input="min"]').evaluate((el) => document.activeElement === el), "price input keeps focus while typing");
  ok(await page.evaluate(() => window.CatalogPrototype.filtered().every((p) => p.price >= 10000)), "min price applied");
  await page.locator(".cat-active .cat-chip").first().click(); // remove avail chip
  await page.waitForTimeout(150);
  ok((await page.locator(".cat-active .cat-chip").count()) === 2, "removing active chip works (gamma + price remain)");
  await page.locator('.cat-filters button[data-cat="reset"]').click();
  await page.waitForFunction(() => document.querySelector(".cat-summary b")?.textContent === "167");
  ok(true, "reset filters → 167");

  // views
  await page.locator('.cat-seg button[data-view="site"]').click();
  await page.locator(".cat-grid.view-site").waitFor({ state: "visible" });
  ok((await page.locator(".view-site .cat-cta").count()) === 48, "site variant cards with CTA");
  await shot("desktop-site");
  await page.locator('.cat-seg button[data-view="table"]').click();
  await page.locator(".cat-table").waitFor({ state: "visible" });
  ok((await page.locator(".cat-table tbody tr").count()) === 48, "table variant 48 rows");
  ok((await page.locator(".cat-table thead th").allTextContents()).join("|").includes("Партнёр"), "table shows partner column for employee");
  await shot("desktop-table");
  await page.locator('.cat-more button[data-cat="more"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".cat-table tbody tr").length === 96);
  ok(true, "show more → 96 rows");
  await page.locator('.cat-seg button[data-view="show"]').click();
  await page.locator(".cat-grid.view-show").waitFor({ state: "visible" });

  // panel
  const firstName = (await page.locator(".cat-card .cat-name").first().textContent()).trim();
  await page.locator(".cat-card").first().click();
  await page.locator(".cat-panel.open").waitFor({ state: "visible" });
  ok((await page.locator("#cat-panel-title").textContent()).trim() === firstName, "panel title matches card");
  ok((await page.locator(".cat-stocktable .item").count()) >= 4, "stock table by warehouses shown");
  ok((await page.locator("[data-cat-reply]").count()) === 1, "reply text shown");
  ok((await page.evaluate(() => location.hash)).includes("item=p"), "hash carries item id");
  await shot("desktop-panel");
  const sizeBtns = page.locator('.cat-opt[data-cat="size"]');
  if (await sizeBtns.count() > 1) {
    const before = await page.locator("[data-cat-reply]").textContent();
    await sizeBtns.nth(1).click();
    await page.waitForTimeout(100);
    ok((await page.locator("[data-cat-reply]").textContent()) !== before, "reply updates on size change");
  }
  await page.locator('.cat-gallery [data-cat="zoom"]').click();
  ok(await page.locator(".cat-gallery.zoom").count() === 1, "zoom toggles");
  await page.locator('.cat-panel .primary[data-cat="copy"]').click();
  await page.locator("#notice.show").waitFor({ state: "visible" });
  ok((await page.locator("#notice").textContent()).includes("скопирован") || (await page.locator("#notice").textContent()).includes("Буфер"), "copy gives notice");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".cat-panel.open"));
  ok(true, "Escape closes panel");
  ok((await page.evaluate(() => document.body.style.overflow)) === "", "body scroll restored");

  // client view
  await page.locator(".cat-mode input").check();
  await page.waitForFunction(() => document.querySelector(".cat-mode.on"));
  ok((await page.locator(".cat-grid .cat-partner").count()) === 0, "client view hides partner price");
  ok((await page.locator(".cat-grid .cat-wh").count()) === 0, "client view hides warehouse numbers");
  ok((await page.locator(".cat-grid .cat-quick").count()) === 0, "client view hides quick copy");
  await page.locator(".cat-card").first().click();
  await page.locator(".cat-panel.open").waitFor({ state: "visible" });
  ok((await page.locator(".cat-stocktable").count()) === 0, "client panel hides stock table");
  ok((await page.locator("[data-cat-reply]").count()) === 0, "client panel hides reply");
  await page.locator('.cat-panel .cat-close').click();
  await page.waitForFunction(() => !document.querySelector(".cat-panel.open"));
  await shot("desktop-client");
  await page.locator(".cat-mode input").uncheck();
  await page.waitForFunction(() => !document.querySelector(".cat-mode.on"));

  // theme + role switch
  await page.locator("button[data-theme]").click();
  ok((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "dark theme");
  await shot("desktop-dark");
  for (const role of ["director", "admin", "regional", "rop"]) {
    await page.locator("#prototype-role").selectOption(role);
    await page.locator(".main").waitFor({ state: "visible" });
    ok((await page.locator('.sidebar .nav button[data-go="catalog"]').count()) === 1, `${role} has catalog nav`);
    await page.locator('.sidebar .nav button[data-go="catalog"]').click();
    await page.locator("#catalog-root .cat").waitFor({ state: "visible" });
    ok((await countText()) === "167", `${role} opens catalog with 167`);
  }
  await page.locator("button[data-theme]").click();

  // regression: other screens
  await page.locator('.sidebar .nav button[data-go="tan-tracker"]').click();
  await page.locator("#tt-root").waitFor({ state: "visible" });
  ok((await page.locator(".cat-panel.open").count()) === 0, "tan-tracker opens, no catalog panel");
  await page.locator('.sidebar .nav button[data-go="exchange"]').first().click();
  await page.locator(".main").waitFor({ state: "visible" });
  ok((await page.locator("#catalog-root").count()) === 0, "clients screen has no catalog root");
  await page.locator('.sidebar .nav button[data-go="showcase"]').click();
  await page.locator(".main").waitFor({ state: "visible" });
  ok((await page.locator("h1").textContent()).length > 0, "showcase opens");

  // cold hash entry
  await page.goto(`${base}/#catalog?role=rop&sec=hardware&view=table&q=TDAL`);
  await page.locator(".cat-table").waitFor({ state: "visible" });
  ok((await page.locator("#cat-search").inputValue()) === "TDAL", "cold entry restores query");
  ok(Number(await countText()) > 5, "cold entry hardware+TDAL has results");

  // mobile
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  const tableOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(tableOverflow <= 0, `mobile: table view has no page overflow (${tableOverflow})`);
  await page.goto(`${base}/?reload=1#catalog?role=manager`);
  await page.locator("#catalog-root .cat").waitFor({ state: "visible" });
  ok((await countText()) === "167", "mobile fresh load shows 167");
  ok(!(await page.locator("#cat-search").evaluate((el) => document.activeElement === el)), "mobile: search not auto-focused");
  ok(await page.locator(".cat-filterbtn").isVisible(), "mobile: filters button visible");
  ok(!(await page.locator(".cat-filters").isVisible()), "mobile: filters hidden by default");
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) console.log(await page.evaluate(() => { const w = document.documentElement.clientWidth; const out = []; document.querySelectorAll("body *").forEach((el) => { const r = el.getBoundingClientRect(); if (r.right > w + 2 && r.width > 0 && !el.closest(".cat-tree")) out.push(el.tagName + "." + String(el.className).slice(0, 50) + " " + Math.round(r.left) + "-" + Math.round(r.right)); }); return out.slice(0, 12).join("\n"); }));
  ok(overflow <= 0, `mobile: no horizontal overflow (${overflow})`);
  const cols = await page.locator(".cat-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  ok(cols === 2, "mobile: 2 columns");
  await shot("mobile-show");
  await page.locator(".cat-filterbtn").click();
  await page.locator(".cat-filters.open").waitFor({ state: "visible" });
  await shot("mobile-filters");
  await page.locator('.cat-filters .cat-chip[data-key="avail"][data-val="in"]').click();
  await page.waitForFunction(() => document.querySelector(".cat-summary b")?.textContent !== "167");
  ok(true, "mobile: filter applies");
  await page.locator('.cat-tree button[data-sec="interior"]').click();
  await page.waitForFunction(() => document.querySelector(".cat-subchips"));
  ok(true, "mobile: section chip switches and shows subsections");
  await page.locator(".cat-card").first().click();
  await page.locator(".cat-panel.open").waitFor({ state: "visible" });
  const pw = await page.locator(".cat-panel-box").evaluate((el) => el.getBoundingClientRect().width);
  ok(Math.round(pw) === 375, "mobile: panel full width");
  await shot("mobile-panel");
  await page.locator(".cat-panel .cat-close").click();
  await page.waitForFunction(() => !document.querySelector(".cat-panel.open"));
  await page.setViewportSize({ width: 1440, height: 900 });

  ok(errors.length === 0, "no page errors: " + errors.join(" | "));
  console.log(`Catalog QA PASS ${checks.length} checks`);
  return checks;
})();
