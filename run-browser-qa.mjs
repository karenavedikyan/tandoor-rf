import { chromium } from "playwright";
import { createServer } from "http";
import { readFile } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const root = join(fileURLToPath(import.meta.url), "..", "site");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ttf": "font/ttf" };

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

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
page.setDefaultTimeout(5000);
page.on("pageerror", (e) => console.error("PAGEERROR:", e.message));
globalThis.page = page;
globalThis.ttOpenDemoSettings = async () => {
  const panel = page.locator('[data-tt="demo-settings"]');
  if (await panel.count() && !(await panel.evaluate((el) => el.open))) await panel.locator("summary").click();
};
globalThis.ttOpenDetailDemo = async () => {
  const panel = page.locator('[data-tt="detail-demo"]');
  if (await panel.count() && !(await panel.evaluate((el) => el.open))) await panel.locator("summary").click();
};
globalThis.ttBackToList = async () => {
  const terminal = page.locator('[data-tt="terminal-back-list"]');
  const headerBack = page.locator('[data-tt="detail-head"] [data-tt="back-list"]');
  const genericBack = page.locator('[data-tt="back-list"]');
  if (await terminal.isVisible()) {
    await terminal.click();
  } else if (await headerBack.isVisible()) {
    await headerBack.click();
  } else {
    await genericBack.first().waitFor({ state: "visible" });
    await genericBack.first().click();
  }
  await page.locator("#tt-root").waitFor({ state: "visible" });
};
globalThis.ttOpenOtherActions = async () => {
  const panel = page.locator('[data-tt="other-actions"]');
  if (await panel.count() && !(await panel.evaluate((el) => el.open))) await panel.locator("summary").click();
};
globalThis.ttOpenRecipientList = async () => {
  await page.locator('[data-create-phase="recipient"]').waitFor({ state: "visible" });
  if ((await page.locator('[data-tt="contact-pick"]').count()) === 0) {
    await page.locator('[data-tt="create-recipient-browse"]').click();
    await page.locator('[data-tt="contact-pick"]').waitFor({ state: "visible" });
  }
};
globalThis.ttExitWizardToRegistry = async () => {
  for (let i = 0; i < 10; i++) {
    if ((await page.locator('[data-tt="create-wizard"]').count()) === 0) {
      await page.locator("#tt-root").waitFor({ state: "visible" });
      return;
    }
    if (await page.locator('[data-tt="back-list"]').count()) {
      await page.locator('[data-tt="back-list"]').click();
      await page.locator("#tt-root").waitFor({ state: "visible" });
      return;
    }
    const back = page.getByRole("button", { name: "Назад", exact: true });
    if (await back.count()) {
      await back.click();
      continue;
    }
    throw new Error("ttExitWizardToRegistry: no Назад or Отмена control");
  }
  throw new Error("ttExitWizardToRegistry: wizard still open after steps");
};
globalThis.ttWaitAttThumbLoaded = async () => {
  await page.locator(".tt-att-thumb img").first().waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const img = document.querySelector(".tt-att-thumb img:not(.tt-att-img-broken)");
    return img && img.naturalWidth > 0;
  });
};
/** After pick or when summary card is shown: one «Далее» → review. */
globalThis.ttWizardRecipientToReview = async () => {
  await page.locator('[data-create-phase="recipient"]').waitFor({ state: "visible" });
  if ((await page.locator('[data-tt="recipient-selected"]').count()) === 0) {
    throw new Error("ttWizardRecipientToReview: expected recipient summary");
  }
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.locator('[data-create-phase="review"]').waitFor({ state: "visible" });
};

const contrastHelper = await readFile(join(process.cwd(), "tan-tracker-qa-contrast.js"), "utf8");
await page.addInitScript(contrastHelper);

const script = process.argv[2];
if (!script) throw new Error("usage: node run-browser-qa.mjs <qa.js>");
const { pathToFileURL } = await import("url");
await import(pathToFileURL(join(process.cwd(), script)).href);

await browser.close();
server.close();
