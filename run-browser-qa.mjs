import { chromium } from "playwright";
import { createServer } from "http";
import { readFile } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { ensureDemoBackend, releaseDemoBackend } from "./prototype/qa-demo-backend.mjs";

const root = join(fileURLToPath(import.meta.url), "..", "site");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ttf": "font/ttf" };

const demoHandle = await ensureDemoBackend();
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

let browser;
try {
  if (process.env.QA_REUSE_SERVER !== "1")
    await new Promise((r) => server.listen(4317, "127.0.0.1", r));

  browser = await chromium.launch({ channel: "chromium" });
  const page = await browser.newPage();
  await page.addInitScript((visitor) => {
    window.__NOTIFICATION_DEMO_VISITOR__ = visitor;
  }, `qa-${Date.now()}-${process.pid}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => console.error("PAGEERROR:", e.message));
  globalThis.page = page;
  globalThis.ttWaitDemoSaveSaved = async () => {
    await page.evaluate(async () => {
      await window.NotificationDemoStore.flush();
    });
    await page.waitForFunction(() => window.NotificationDemoStore.getSaveStatus() === "saved");
  };
  globalThis.ttWaitRegistryPersonalReady = async () => {
    await page.locator('[data-tt-registry-personal-ready="true"]').waitFor({ state: "attached" });
  };
  globalThis.ttOpenDemoSettings = async () => {
    const panel = page.locator('[data-tt="demo-settings"]');
    if (await panel.count() && !(await panel.evaluate((el) => el.open))) await panel.locator("summary").click();
  };
  globalThis.ttOpenDetailDemo = async () => {
    if (!(await page.locator('[data-tt="detail-demo"]').count())) return;
    const overflow = page.locator('[data-tt="detail-overflow"]');
    if (await overflow.count() && !(await overflow.evaluate((el) => el.open))) {
      await overflow.locator(":scope > summary").click();
    }
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
    if (!(await page.locator('[data-tt="other-actions"]').count())) return;
    const overflow = page.locator('[data-tt="detail-overflow"]');
    if (await overflow.count() && !(await overflow.evaluate((el) => el.open))) {
      await overflow.locator(":scope > summary").click();
    }
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
  globalThis.ttClickCreate = async () => {
    const fab = page.locator('[data-tt="create-fab"]');
    if (await fab.isVisible()) await fab.click();
    else await page.locator('.tt-head-cta-desktop [data-tt="create"], [data-tt="create"]').first().click();
  };
  globalThis.ttAckRecipientWelcome = async () => {
    const welcome = page.locator('[data-tt="recipient-welcome"]');
    if ((await welcome.count()) === 0) return;
    await welcome.waitFor({ state: "visible" });
    await page.locator('[data-tt="recipient-welcome-continue"]').click();
    await page.locator('[data-tt="recipient-screen"]').waitFor({ state: "visible" });
  };
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
  const { writeFile, unlink } = await import("fs/promises");
  const { tmpdir } = await import("os");
  const qaPath = join(process.cwd(), script);
  const qaSource = await readFile(qaPath, "utf8");
  const tmpQa = join(tmpdir(), `tan-tracker-qa-${Date.now()}.mjs`);
  await writeFile(tmpQa, qaSource);
  try {
    await import(pathToFileURL(tmpQa).href);
  } catch (error) {
    await page.screenshot({path: `/tmp/tandoor-qa-failure-${script.replace(/[^a-z0-9.-]/gi,"_")}.png`}).catch(()=>{});
    console.error("QA_FAILURE_URL",page.url());
    throw error;
  } finally {
    await unlink(tmpQa).catch(() => {});
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  server?.close?.();
  releaseDemoBackend(demoHandle);
}
