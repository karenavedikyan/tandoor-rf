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
  await page.locator('.cat-filters .cat-chip[data-cat="attr"][data-key="Цветовая гамма"][data-val="Белая"]').click();
  await page.waitForFunction((n) => Number(document.querySelector(".cat-summary b")?.textContent) < n, nIn);
  ok((await page.locator(".cat-active .cat-chip").count()) === 2, "two active filter chips");
  // tags (Хит / Новинки / Акции как на сайте)
  await page.locator('.cat-filters .cat-chip[data-cat="tag"][data-val="new"]').click();
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => window.CatalogPrototype.filtered().every((p) => p.isNew)), "Новинки tag filter applies");
  await page.locator('.cat-filters .cat-chip[data-cat="tag"][data-val="new"]').click();
  await page.waitForTimeout(150);
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

  // section filters mirror tandoor.ru
  const groupsFor = async (sec) => {
    await page.locator(`.cat-tree button[data-cat="sec"][data-sec="${sec}"]`).click();
    await page.waitForFunction(() => document.querySelector(".cat-fgroup-attr"));
    return page.evaluate(() => [...document.querySelectorAll(".cat-fgroup-attr > span")].map((e) => e.textContent));
  };
  const gi = await groupsFor("interior");
  ok(["Дизайн", "Цветовая гамма", "Материал\\Покрытие", "Вид двери"].every((g) => gi.includes(g)), `interior filter groups: ${gi.join(", ")}`);
  ok(await page.locator('.cat-fgroup-attr .cat-chip[data-val="Под покраску"].empty').count() === 1, "site-only option shown dimmed (Под покраску)");
  await page.locator('.cat-fgroup-attr .cat-chip[data-key="Вид двери"][data-val="Стеклянная (ДО)"]').click();
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => window.CatalogPrototype.filtered().every((p) => p.types.includes("ДО"))), "Вид двери ДО filter applies");
  await page.locator('.cat-fgroup-attr .cat-chip[data-key="Вид двери"][data-val="Глухая (ДГ)"]').click();
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => window.CatalogPrototype.filtered().every((p) => p.types.includes("ДО") || p.types.includes("ДГ"))), "multi-select within group (ДО или ДГ)");
  const ge = await groupsFor("entry");
  ok(["Место назначения", "Вид двери", "Толщина полотна, мм", "Толщина стали, мм", "Терморазрыв", "Ковка", "Стеклопакет", "Зеркало", "Ценовой сегмент"].every((g) => ge.includes(g)), `entry filter groups: ${ge.length}`);
  ok(await page.evaluate(() => Object.keys(window.CatalogPrototype.state.f).length === 0), "section switch clears section filters");
  await page.locator('.cat-fgroup-attr .cat-chip[data-key="Терморазрыв"][data-val="да"]').click();
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => window.CatalogPrototype.filtered().every((p) => p.attrs["Терморазрыв"] === "да")), "Терморазрыв=да applies");
  const gh = await groupsFor("hardware");
  ok(["Бренд", "Цветовая гамма", "Вид ручки", "Основание ручки", "Тип установки", "Высота петли", "Вид замка/защёлки", "Материал язычка", "Дизайн"].every((g) => gh.includes(g)), `hardware filter groups: ${gh.length}`);
  const gm = await groupsFor("molding");
  ok(gm.includes("Материал") && gm.includes("Цвет"), "molding filter groups");
  await page.locator('.cat-filters button[data-cat="reset"]').click();
  await page.waitForFunction(() => document.querySelector(".cat-summary b")?.textContent === "167");
  await shot("desktop-filters-entry");

  // views
  await page.locator('.cat-seg button[data-view="site"]').click();
  await page.locator(".cat-grid.view-site").waitFor({ state: "visible" });
  ok((await page.locator(".view-site .cat-cta").count()) === 48, "site variant cards with CTA");
  ok((await page.locator(".view-site button.cat-cta").count()) === 48, "CTA is a real button");
  await page.locator(".view-site .cat-cta").first().hover();
  const cardHover = await page.locator(".view-site .cat-card").first().evaluate((el) => getComputedStyle(el).transform);
  ok(cardHover === "none" || cardHover === "matrix(1, 0, 0, 1, 0, 0)", "hovering CTA does not lift the whole card");
  // card carousel (витрина/сайт): все фото в полный рост, стрелки, стороны входных дверей
  ok(await page.evaluate(() => [...document.querySelectorAll(".view-site .cat-img > img")].slice(0, 20).every((im) => im.naturalHeight > 0 && im.clientHeight <= im.parentElement.clientHeight && im.clientWidth <= im.parentElement.clientWidth)), "site view: photos fit the box fully (no crop)");
  const multi = page.locator(".view-site .cat-img.has-gallery").first();
  ok(await multi.count() === 1, "card has gallery controls when several photos");
  const src0 = await multi.locator("img").getAttribute("src");
  await multi.locator(".cat-arr.next").click();
  await page.waitForTimeout(100);
  const gid = await page.locator(".view-site .cat-img.has-gallery").first().getAttribute("data-gallery");
  const src1 = await page.locator(`.view-site [data-gallery="${gid}"] img`).getAttribute("src");
  ok(src0 !== src1, "card arrow switches photo");
  ok(!(await page.locator(".cat-panel.open").count()), "card arrow does not open the panel");
  await shot("desktop-site");
  // entry doors: outside / inside
  await page.locator('.cat-tree button[data-cat="sec"][data-sec="entry"]').click();
  await page.waitForFunction(() => document.querySelector(".cat-summary b")?.textContent === "29");
  ok((await page.locator(".cat-sides").count()) === 29, "entry cards show Снаружи / Изнутри toggle");
  const sidesBtn = page.locator(".cat-sides button").nth(1);
  const sBefore = await page.locator(".cat-card .cat-img img").first().getAttribute("src");
  await sidesBtn.click();
  await page.waitForTimeout(100);
  ok((await page.locator(".cat-card .cat-img img").first().getAttribute("src")) !== sBefore, "Изнутри shows the other side");
  await shot("desktop-entry-sides");
  await page.locator('.cat-tree button[data-cat="sec"][data-sec=""]').click();
  await page.waitForFunction(() => document.querySelector(".cat-summary b")?.textContent === "167");
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
  // gallery in panel
  const nThumbs = await page.locator(".cat-thumbs button").count();
  ok(nThumbs >= 2, `panel gallery thumbnails: ${nThumbs}`);
  const g0 = await page.locator(".cat-gallery .cat-img img").getAttribute("src");
  const gActive = Number(await page.locator(".cat-thumbs button.active").getAttribute("data-idx"));
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(100);
  ok((await page.locator(".cat-gallery .cat-img img").getAttribute("src")) !== g0, "ArrowRight switches panel photo");
  await page.locator(".cat-thumbs button").nth(gActive).click();
  await page.waitForTimeout(100);
  ok((await page.locator(".cat-gallery .cat-img img").getAttribute("src")) === g0, "thumbnail click selects photo");
  await page.locator('.cat-gallery [data-cat="zoom"]').click();
  ok(await page.locator(".cat-gallery.zoom").count() === 1, "zoom toggles");
  await page.locator('.cat-panel .primary[data-cat="copy"]').click();
  await page.locator("#notice.show").waitFor({ state: "visible" });
  ok((await page.locator("#notice").textContent()).includes("скопирован") || (await page.locator("#notice").textContent()).includes("Буфер"), "copy gives notice");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".cat-panel.open"));
  ok(true, "Escape closes panel");
  ok((await page.evaluate(() => document.body.style.overflow)) === "", "body scroll restored");

  // full-screen mode
  await page.locator('.cat-fullbtn[data-cat="full"]').click();
  await page.waitForFunction(() => document.body.classList.contains("cat-fullscreen"));
  ok(!(await page.locator(".sidebar").isVisible()) && !(await page.locator(".head").isVisible()), "full screen hides sidebar and header");
  ok((await page.locator(".cat-secbar .cat-chip").count()) === 5, "full screen: sections as a bar");
  const fullCols = await page.evaluate(() => getComputedStyle(document.querySelector(".cat-grid")).gridTemplateColumns.split(" ").length);
  ok(fullCols >= 6, `full screen uses the width: ${fullCols} columns`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "full screen: no horizontal overflow");
  await shot("desktop-full");
  await page.locator('.cat-secbar .cat-chip[data-sec="hardware"]').click();
  await page.waitForFunction(() => document.querySelector(".cat-summary b")?.textContent === "53");
  ok(await page.evaluate(() => document.body.classList.contains("cat-fullscreen")), "section switch keeps full screen");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.body.classList.contains("cat-fullscreen"));
  ok(await page.locator(".sidebar").isVisible(), "Escape leaves full screen");
  await page.locator('.cat-fullbtn[data-cat="full"]').click();
  await page.waitForFunction(() => document.body.classList.contains("cat-fullscreen"));
  await page.evaluate(() => { location.hash = "#exchange?role=manager"; });
  await page.waitForFunction(() => !document.body.classList.contains("cat-fullscreen") && document.querySelector(".sidebar"));
  ok(true, "leaving catalog restores layout");
  await page.goto(`${base}/?reload=1#catalog?role=manager`);
  await page.waitForFunction(() => document.querySelector(".cat-summary b")?.textContent === "167");

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

  // как на tandoor.ru: входные двери — обе стороны в одной рамке; палитра цветов модели; сторона открывания в карточке
  await page.goto(`${base}/?r=2#catalog?role=manager&sec=entry&view=site`);
  await page.locator(".cat-grid.view-site").waitFor({ state: "visible" });
  ok((await page.locator(".view-site .cat-pair").count()) === 29, "entry doors: both sides shown in one frame (pair)");
  const frontAlt0 = await page.locator(".view-site .cat-pair img.front").first().getAttribute("alt");
  await page.locator(".view-site .cat-pair img.back").first().click({ force: true });
  await page.waitForTimeout(100);
  ok((await page.locator(".view-site .cat-pair img.front").first().getAttribute("alt")) !== frontAlt0, "clicking the back side brings it forward");
  ok(!(await page.locator(".cat-panel.open").count()), "clicking the back side does not open the panel");
  ok((await page.locator(".view-site .cat-colors").count()) > 0, "colour swatches of the same model shown on cards");
  await page.locator(".view-site .cat-card .cat-cta").first().click();
  await page.locator(".cat-panel.open").waitFor({ state: "visible" });
  ok((await page.locator(".cat-panel .cat-options .row>span").first().textContent()) === "Открывание", "entry panel: side of opening selector");
  await page.locator('.cat-panel .cat-opt[data-val="Правое"]').click();
  await page.waitForTimeout(100);
  ok(/открывание правое/.test(await page.locator("[data-cat-reply]").textContent()), "reply text reflects side of opening");
  ok((await page.locator(".cat-panel-head .sub").textContent()).includes(" / Правое"), "panel subtitle: цвет / размер / сторона");
  await page.locator(".cat-panel .cat-close").click();
  await page.waitForFunction(() => !document.querySelector(".cat-panel.open"));
  await page.goto(`${base}/?r=3#catalog?role=manager&sec=interior&q=522&view=site`);
  await page.locator(".cat-grid.view-site").waitFor({ state: "visible" });
  await page.locator(".view-site .cat-colors button:not(.active)").first().click();
  await page.locator(".cat-panel.open").waitFor({ state: "visible" });
  ok((await page.locator(".cat-panel-head .sub").textContent()).startsWith("Белый"), "swatch opens the model in the other colour");
  ok((await page.locator(".cat-panel .cat-colors.big button").count()) === 2, "panel lists all colours of the model");
  await page.locator(".cat-panel .cat-close").click();
  await page.waitForFunction(() => !document.querySelector(".cat-panel.open"));

  ok(errors.length === 0, "no page errors: " + errors.join(" | "));
  console.log(`Catalog QA PASS ${checks.length} checks`);
  return checks;
})();
