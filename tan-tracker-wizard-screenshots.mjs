import { chromium } from "playwright";
import { createServer } from "http";
import { readFile, mkdir } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const root = join(fileURLToPath(import.meta.url), "..", "site");
const outDir = "/opt/cursor/artifacts/screenshots/wizard-375";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

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
await new Promise((r) => server.listen(4317, "127.0.0.1", r));

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 375, height: 812 });

const base = "http://127.0.0.1:4317/#tan-tracker?role=manager";
for (const theme of ["light", "dark"]) {
  await page.goto(base);
  await page.reload();
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await page.locator("#tt-root").waitFor({ state: "visible" });
  await page.locator('[data-tt="create"]').click();
  await page.locator('[data-create-phase="item"]').waitFor({ state: "visible" });
  await page.locator('[data-tt-field="item"]').fill("Образцы ткани");
  await page.screenshot({ path: join(outDir, `step1-item-${theme}.png`), fullPage: true });
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="files"]').waitFor({ state: "visible" });
  await page.screenshot({ path: join(outDir, `step2-files-${theme}.png`), fullPage: true });
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page.locator('[data-create-phase="recipient"]').waitFor({ state: "visible" });
  await page.locator(".tt-wizard-contact").first().click();
  await page.screenshot({ path: join(outDir, `step3-recipient-${theme}.png`), fullPage: true });
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
  await page.screenshot({ path: join(outDir, `step4-review-${theme}.png`), fullPage: true });
}

await browser.close();
server.close();
console.log(JSON.stringify({ outDir, files: 8 }, null, 2));
