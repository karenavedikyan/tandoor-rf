import { chromium } from "playwright";
import { createServer } from "http";
import { readFile, mkdir } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const root = join(fileURLToPath(import.meta.url), "..", "site");
const outDir = join(fileURLToPath(import.meta.url), "..", "qa-screens", "tt56");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };

const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\//, "") || "index.html");
    const body = await readFile(path);
    res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(4318, "127.0.0.1", r));
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
const base = "http://127.0.0.1:4318";

async function shot(name, w, theme, url, action) {
  await page.setViewportSize({ width: w, height: 812 });
  await page.goto(url);
  await page.reload();
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  if (action) await action();
  await page.locator("#tt-root, .tt-recipient-card, .tt-error").first().waitFor({ state: "visible", timeout: 15000 });
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
}

await shot("overflow-open-390-light", 390, "light", `${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`, async () => {
  await page.locator('[data-tt="detail-overflow"] > summary').click();
});

await page.setViewportSize({ width: 1440, height: 900 });
await shot("overflow-open-1440-light", 1440, "light", `${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`, async () => {
  await page.locator('[data-tt="detail-overflow"] > summary').click();
});

await shot(
  "recipient-390-light-before-verify",
  390,
  "light",
  `${base}/#tan-tracker?role=manager&tt_view=recipient&tt_order=TT-2026-001&tt_via=qr&tt_rcv=ext_01&tt_hv=1`
);

await shot(
  "recipient-390-light-after-verify",
  390,
  "light",
  `${base}/#tan-tracker?role=manager&tt_view=recipient&tt_order=TT-2026-001&tt_via=qr&tt_rcv=ext_01&tt_hv=1`,
  async () => {
    await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  }
);

await shot(
  "recipient-390-dark-after-verify",
  390,
  "dark",
  `${base}/#tan-tracker?role=manager&tt_view=recipient&tt_order=TT-2026-001&tt_via=qr&tt_rcv=ext_01&tt_hv=1`,
  async () => {
    await page.getByRole("button", { name: "Подтвердить номер (демо)", exact: true }).click();
  }
);

await page.setViewportSize({ width: 1440, height: 900 });
await shot("wizard-1-1440-light", 1440, "light", `${base}/#tan-tracker?role=manager&tt_emp=m1`, async () => {
  await page.locator('[data-tt-main-cta]').first().click();
  await page.locator('[data-create-phase="item"]').waitFor({ state: "visible" });
});

await shot("wizard-3-390-contact-selected", 390, "light", `${base}/#tan-tracker?role=manager&tt_emp=m1`, async () => {
  await page.locator('[data-tt="create-fab"]').click();
  await page.locator('[data-tt-field="item"]').fill("Скриншот выбранного контакта");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page.locator('[data-tt="create-recipient-browse"]').click();
  await page.locator(".tt-wizard-contact").first().click();
});

await browser.close();
server.close();
console.log("saved screenshots to qa-screens/tt56/");
