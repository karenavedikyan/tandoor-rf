import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withMaxMainMenuButton, MAX_MAIN_MENU_CALLBACK } from "../../src/tanbot-max/main-menu-button";
import { buildNativeCreateCallback, parseNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";
import { NATIVE_MENU_DRAFT_HEX } from "../../src/tanbot/native-create/menu-sentinel";
import { buildMaxSendMessagePayload, type MaxInlineButton } from "../../src/tanbot-max/delivery-transport";
import { buildReceiptEntryCallback } from "../../src/tanbot/receipt-entry-callback";

describe("MAX main-menu footer", () => {
  it("keeps exactly the code/invite pair, but not mismatched tracks or stages", () => {
    const pair = (id: string, version: number): MaxInlineButton[][] => [
      [{ type: "callback", text: "Ввести код", payload: buildReceiptEntryCallback("code", "TT-LOCAL", 1)! }],
      [{ type: "callback", text: "Получить код у получателя", payload: buildReceiptEntryCallback("invite", id, version)! }],
    ];
    assert.deepEqual(withMaxMainMenuButton(pair("TT-LOCAL", 1)), pair("TT-LOCAL", 1));
    assert.equal(withMaxMainMenuButton(pair("TT-OTHER", 1)).flat().length, 3);
    assert.equal(withMaxMainMenuButton(pair("TT-LOCAL", 2)).flat().length, 3);
  });
  it("uses the existing navigation-only action, no transfer or draft binding", () => {
    const parsed = parseNativeCreateCallback(MAX_MAIN_MENU_CALLBACK);
    assert.equal(parsed?.action, "menu_home");
    assert.equal(parsed?.draftIdHex, NATIVE_MENU_DRAFT_HEX);
    assert.ok(Buffer.byteLength(MAX_MAIN_MENU_CALLBACK, "utf8") <= 64);
    assert.deepEqual(withMaxMainMenuButton(), [[{
      type: "callback", text: "Главное меню", payload: MAX_MAIN_MENU_CALLBACK,
    }]]);
  });

  it("keeps retry/cancel input pair compact only for the same transfer and handoff version", () => {
    const pair = (id: string, version: number): MaxInlineButton[][] => [
      [{ type: "callback", text: "Запросить код ещё раз", payload: buildReceiptEntryCallback("retry", "TT-LOCAL", 1)! }],
      [{ type: "callback", text: "Отменить ввод кода", payload: buildReceiptEntryCallback("cancel", id, version)! }],
    ];
    assert.deepEqual(withMaxMainMenuButton(pair("TT-LOCAL", 1)), pair("TT-LOCAL", 1));
    assert.equal(withMaxMainMenuButton(pair("TT-OTHER", 1)).flat().length, 3);
    assert.equal(withMaxMainMenuButton(pair("TT-LOCAL", 2)).flat().length, 3);
  });

  it("skips footer when contextual Menu is present and strips duplicate menu rows", () => {
    const oldPayload = buildNativeCreateCallback("menu", "11111111-1111-4111-8111-111111111111", 5)!;
    const source: MaxInlineButton[][] = [
      [{ type: "callback", text: "Далее", payload: "business-next" }, { type: "callback", text: "Меню", payload: oldPayload }],
      [{ type: "callback", text: "Отмена", payload: "business-cancel" }],
    ];
    const snapshot = JSON.stringify(source);
    const decorated = withMaxMainMenuButton(source);
    assert.deepEqual(decorated.map(row => row.map(button => button.text)), [["Далее", "Меню"], ["Отмена"]]);
    assert.equal(JSON.stringify(source), snapshot);
    assert.deepEqual(withMaxMainMenuButton(decorated), decorated, "retry decoration is idempotent");
  });

  it("keeps transfer links, code actions and share previews in the actual MAX wire payload", () => {
    const actions: MaxInlineButton[][] = [[
      { type: "link", text: "Открыть передачу", url: "https://example.invalid/tan-tracker" },
      { type: "callback", text: "Получить код", payload: "hc:gen:TT-LOCAL:1" },
      { type: "request_contact", text: "Отправить свой контакт" },
    ]];
    const wire = buildMaxSendMessagePayload({
      text: "Передача",
      shareUrl: "https://example.invalid/tan-tracker",
      inlineButtons: withMaxMainMenuButton(actions),
    });
    const attachments = wire.attachments as { type: string; payload: { buttons?: unknown[][]; url?: string } }[];
    assert.deepEqual(attachments.map(x => x.type), ["share", "inline_keyboard"]);
    assert.deepEqual(attachments[1]!.payload.buttons?.[0], actions[0]);
    assert.equal((attachments[1]!.payload.buttons?.[1]?.[0] as MaxInlineButton).text, "Главное меню");
  });

  it("adds one footer only for business-only inline rows", () => {
    const decorated = withMaxMainMenuButton([[{ type: "callback", text: "Далее", payload: "next" }]]);
    assert.deepEqual(decorated.at(-1)?.[0]?.text, "Главное меню");
  });
});
