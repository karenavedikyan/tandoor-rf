import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withMaxMainMenuButton, MAX_MAIN_MENU_CALLBACK } from "../../src/tanbot-max/main-menu-button";
import { buildNativeCreateCallback, parseNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";
import { NATIVE_MENU_DRAFT_HEX } from "../../src/tanbot/native-create/menu-sentinel";
import { buildMaxSendMessagePayload, type MaxInlineButton } from "../../src/tanbot-max/delivery-transport";

describe("MAX main-menu footer", () => {
  it("uses the existing navigation-only action, no transfer or draft binding", () => {
    const parsed = parseNativeCreateCallback(MAX_MAIN_MENU_CALLBACK);
    assert.equal(parsed?.action, "menu");
    assert.equal(parsed?.draftIdHex, NATIVE_MENU_DRAFT_HEX);
    assert.ok(Buffer.byteLength(MAX_MAIN_MENU_CALLBACK, "utf8") <= 64);
    assert.deepEqual(withMaxMainMenuButton(), [[{
      type: "callback", text: "Главное меню", payload: MAX_MAIN_MENU_CALLBACK,
    }]]);
  });

  it("replaces old draft-bound Menu buttons with one footer and does not mutate the source", () => {
    const oldPayload = buildNativeCreateCallback("menu", "11111111-1111-4111-8111-111111111111", 5)!;
    const source: MaxInlineButton[][] = [
      [{ type: "callback", text: "Далее", payload: "business-next" }, { type: "callback", text: "Меню", payload: oldPayload }],
      [{ type: "callback", text: "Меню", payload: MAX_MAIN_MENU_CALLBACK }],
      [{ type: "callback", text: "Отмена", payload: "business-cancel" }],
    ];
    const snapshot = JSON.stringify(source);
    const decorated = withMaxMainMenuButton(source);
    assert.deepEqual(decorated.map(row => row.map(button => button.text)), [["Далее"], ["Отмена"], ["Главное меню"]]);
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
});
