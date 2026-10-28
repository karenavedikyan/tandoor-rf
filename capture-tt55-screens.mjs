import { chromium } from "playwright";
import { createServer } from "http";
import { readFile, mkdir } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const root = join(fileURLToPath(import.meta.url), "..", "site");
const outDir = join(fileURLToPath(import.meta.url), "..", "qa-screens", "tt55");
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

const shots = [
  { w: 390, theme: "light", url: `${base}/#tan-tracker?role=manager&tt_emp=m1`, name: "registry-390-light" },
  { w: 390, theme: "dark", url: `${base}/#tan-tracker?role=manager&tt_emp=m1`, name: "registry-390-dark" },
  { w: 1440, theme: "light", url: `${base}/#tan-tracker?role=manager&tt_emp=m1`, name: "registry-1440-light" },
  { w: 1440, theme: "dark", url: `${base}/#tan-tracker?role=manager&tt_emp=m1`, name: "registry-1440-dark" },
  { w: 390, theme: "light", url: `${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`, name: "detail-390-light" },
  { w: 1440, theme: "light", url: `${base}/#tan-tracker?role=manager&tt_emp=m1&tt_id=TT-2026-001`, name: "detail-1440-light" },
];

for (const s of shots) {
  await page.setViewportSize({ width: s.w, height: 812 });
  await page.goto(s.url);
  await page.reload();
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, s.theme);
  await page.locator("#tt-root, .tt-recipient-card, .tt-error").first().waitFor({ state: "visible", timeout: 15000 });
  await page.screenshot({ path: join(outDir, `${s.name}.png`), fullPage: true });
}

await browser.close();
server.close();
console.log("saved", shots.length, "screenshots to qa-screens/tt55/");
