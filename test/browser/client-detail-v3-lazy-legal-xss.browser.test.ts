import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";

const XSS_PAYLOAD = '<img src="data:," onerror="window.__SYNTH_ONLY_XSS=1">';

describe("client-detail-v3 lazy legal preview XSS guard", () => {
  let browser: Browser;

  after(async () => {
    await browser?.close();
  });

  it("escapes scoped detail fields and does not execute injected markup", async () => {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent('<main id="host"></main>');
    const repo = process.cwd();
    await page.addScriptTag({
      content: fs.readFileSync(path.join(repo, "public/client-detail-exchange-catalog.js"), "utf8"),
    });
    await page.addScriptTag({
      content: fs.readFileSync(path.join(repo, "public/clients-shell.js"), "utf8"),
    });
    await page.addScriptTag({
      content: fs.readFileSync(path.join(repo, "public/client-detail-v3.js"), "utf8"),
    });
    await page.evaluate((payload) => {
      const host = document.getElementById("host");
      const shell = window.ClientsShell;
      host.innerHTML = window.ClientDetailV3.renderLegalLazyExpandItem(
        shell,
        { guid: "b2000000-0000-4000-8000-000000000001", name: "SYNTH" },
        "",
      );
      window.ClientDetailV3.bindLegalLazyExpansions(
        host,
        () =>
          Promise.resolve({
            response: { ok: true },
            data: {
              entity: {
                inn: "SYNTH",
                kpp: "SYNTH",
                address: payload,
                name_client: payload,
                telephone: [payload],
                other_fields: { Оптовик_ОсновнойДоговор: payload },
                discount: null,
                markups: [],
                other_field_states: {},
              },
            },
          }),
        shell,
      );
    }, XSS_PAYLOAD);
    await page.locator("summary").click();
    await page.waitForFunction(() => document.querySelector(".v3-legal-lazy-expand")?.dataset.lazyLoaded === "1");
    const result = await page.evaluate(() => ({
      scriptMarkerExecuted: (window as unknown as { __SYNTH_ONLY_XSS?: number }).__SYNTH_ONLY_XSS === 1,
      imgWithOnerror: Boolean(document.querySelector(".v3-legal-scoped-preview img[onerror]")),
      previewText: document.querySelector(".v3-legal-scoped-preview")?.textContent || "",
    }));
    assert.equal(result.scriptMarkerExecuted, false);
    assert.equal(result.imgWithOnerror, false);
    assert.ok(result.previewText.includes("<img"), "payload should appear as escaped text, not DOM");
    await page.close();
  });
});
