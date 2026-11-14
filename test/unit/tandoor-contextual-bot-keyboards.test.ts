import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCompactMenuInline,
  buildMainMenuInline,
  buildStepUi,
  menuReplyKeyboard,
} from "../../src/tanbot/native-create/keyboards";
import { buildNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";
import { withMaxMainMenuButton } from "../../src/tanbot-max/main-menu-button";

const draftId = "ca957158-e27c-4d05-86db-494c59a2c750";
const revision = 3;

describe("contextual bot keyboards", () => {
  it("home reply keyboard keeps primary actions only", () => {
    const keyboard = menuReplyKeyboard({ showContinue: true }).keyboard as Array<Array<{ text: string }>>;
    const labels = keyboard.flat().map((b) => b.text);
    assert.deepEqual(labels, ["Создать передачу", "Мои передачи", "Статус трека", "Каталог", "Продолжить оформление", "Меню"]);
  });

  for (const channel of ["max", "telegram"] as const) {
    it(`${channel}: compact menu lists secondary actions and home return`, () => {
      const ui = buildCompactMenuInline(channel, { draftId, revision });
      const rows = channel === "max" ? ui.maxInlineButtons! : ui.telegramInlineKeyboard!;
      const labels = rows.flat().map((b) => b.text);
      assert.ok(labels.includes("Получить код приёма"));
      assert.ok(labels.includes("Настройки"));
      assert.ok(labels.includes("К основным действиям"));
      assert.ok(labels.includes("Продолжить оформление"));
    });

    it(`${channel}: wizard photo step uses Без вложений or single Далее`, () => {
      const empty = buildStepUi(channel, draftId, revision, "photo", { wizardShowBack: false });
      const filled = buildStepUi(channel, draftId, revision, "photo", { photoSkipHidden: true, wizardShowBack: true });
      const emptyLabels = (channel === "max" ? empty.maxInlineButtons! : empty.telegramInlineKeyboard!).flat().map(b => b.text);
      const filledLabels = (channel === "max" ? filled.maxInlineButtons! : filled.telegramInlineKeyboard!).flat().map(b => b.text);
      assert.ok(emptyLabels.includes("Без вложений"));
      assert.ok(!emptyLabels.includes("Далее"));
      assert.ok(filledLabels.includes("Далее"));
      assert.ok(!filledLabels.includes("Без вложений"));
    });

    it(`${channel}: summary keeps create, edit and one menu exit`, () => {
      const ui = buildStepUi(channel, draftId, revision, "summary");
      const labels = (channel === "max" ? ui.maxInlineButtons! : ui.telegramInlineKeyboard!).flat().map(b => b.text);
      assert.deepEqual(labels.filter(l => l === "Создать передачу").length, 1);
      assert.ok(labels.includes("Изменить"));
      assert.ok(labels.includes("Меню"));
      assert.ok(!labels.includes("◀ Назад"));
      assert.ok(!labels.includes("Отмена"));
    });
  }

  it("MAX home inline matches primary labels", () => {
    const labels = buildMainMenuInline("max").maxInlineButtons!.flat().map(b => b.text);
    assert.ok(labels.includes("Создать передачу"));
    assert.ok(labels.includes("Мои передачи"));
    assert.ok(labels.includes("Меню"));
    assert.ok(!labels.includes("Получить код приёма"));
  });

  it("MAX footer defers to contextual menu buttons", () => {
    const menuPayload = buildNativeCreateCallback("menu", draftId, revision)!;
    const rows = withMaxMainMenuButton([[{ type: "callback", text: "Меню", payload: menuPayload }]]);
    assert.deepEqual(rows.flat().map(b => b.text), ["Меню"]);
  });
});
