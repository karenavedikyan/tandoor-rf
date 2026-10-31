import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("external person UI markup (prototype parity hooks)", () => {
  let dom: JSDOM;

  before(async () => {
    dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
      url: "http://127.0.0.1/",
      runScripts: "dangerously",
    });
    const g = dom.window as unknown as {
      window: Window & {
        TanTrackerPrototype?: object;
        __TT_EXTERNAL_PERSON__?: boolean;
        TtExternalUi?: {
          extRequestView: () => string;
          externalShellHomeHtml: () => string;
          externalHolderDetailBlocks: (o: object, actor: string) => string;
        };
      };
    };
    g.window.__TT_EXTERNAL_PERSON__ = true;
    g.window.TanTrackerPrototype = {
      state: {
        actingContactId: "ext1",
        view: "ext-request",
        extRequestPhase: "item",
        extRequestForm: { item: "", comment: "", recipientId: "", duePreset: "today", draftId: "", photoCount: 0, photos: [] },
        historicalSummaries: [],
      },
      orders: () => [
        { id: "VIS", item: "Box", status: "waiting", holderId: "ext1", pendingId: "u1", timeline: [], fromExternal: true },
      ],
      contacts: () => [{ id: "ext1", kind: "external", name: "Ext User", phone: "+79990000001" }],
      canViewOrder: () => true,
      registryCardHtml: (o: { id: string; item: string }) =>
        `<article data-tt="open-order" data-order-id="${o.id}">${o.item}</article>`,
    };
    const photosScript = readFileSync(join(root, "public/tan-tracker-external-request-photos.js"), "utf8");
    const photosEl = dom.window.document.createElement("script");
    photosEl.textContent = photosScript;
    dom.window.document.body.appendChild(photosEl);
    const script = readFileSync(join(root, "public/tan-tracker-external-ui.js"), "utf8");
    const scriptEl = dom.window.document.createElement("script");
    scriptEl.textContent = script;
    dom.window.document.body.appendChild(scriptEl);
  });

  it("renders chat wizard frame with progress and bot bubble", () => {
    const html = dom.window.TtExternalUi!.extRequestView();
    assert.match(html, /tt-ext-chat-head/);
    assert.match(html, /tt-ext-chat-progress/);
    assert.match(html, /tt-bot-preview--bubble/);
    assert.match(html, /data-tt-field="extItem"/);
  });

  it("groups registry home with section counts", () => {
    const html = dom.window.TtExternalUi!.externalShellHomeHtml();
    assert.match(html, /tt-ext-group-title/);
    assert.match(html, /tt-ext-group-count/);
    assert.match(html, /data-tt="open-order"/);
  });

  it("renders delivered holder continue/return card", () => {
    const html = dom.window.TtExternalUi!.externalHolderDetailBlocks(
      {
        id: "D1",
        holderId: "ext1",
        finalRecipientId: "ext1",
        status: "delivered",
        pendingId: null,
        holderSince: Date.now(),
        timeline: [{ from: "u1", to: "ext1", note: "Подтверждено кодом", at: Date.now() }],
      },
      "ext1",
    );
    assert.match(html, /data-tt="holder-delivered"/);
    assert.match(html, /data-tt="transfer"/);
    assert.match(html, /Передать этот предмет дальше/);
    assert.match(html, /продолжение трека D1, а не новая передача/);
  });
});

describe("profile admin TT controls present in HTML", () => {
  it("includes intake and phone dedupe test hooks", () => {
    const html = readFileSync(join(root, "public/profile.html"), "utf8");
    assert.match(html, /data-testid="tt-external-intake-toggle"/);
    assert.match(html, /data-testid="tt-phone-dedupe-refresh"/);
    assert.match(html, /data-testid="tt-admin-intake-save"/);
  });
});

describe("tan-tracker contact dedupe UI strings", () => {
  it("exports contact-exists block from bundled script", () => {
    const js = readFileSync(join(root, "public/tan-tracker/tan-tracker.js"), "utf8");
    assert.match(js, /data-tt="contact-exists"/);
    assert.match(js, /pick-existing-wizard/);
    assert.match(js, /data-tt="contact-new"/);
  });
});
