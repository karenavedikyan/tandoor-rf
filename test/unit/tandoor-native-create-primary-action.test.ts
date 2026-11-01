import assert from "node:assert/strict";
import { it } from "node:test";
import { buildStepUi } from "../../src/tanbot/native-create/keyboards";
import { buildNativeCreateCallback } from "../../src/tanbot/native-create/callback-codec";
import { buildMaxInlineKeyboardAttachment } from "../../src/tanbot-max/delivery-transport";

const draftId = "ca957158-e27c-4d05-86db-494c59a2c750";
const revision = 7;
for (const channel of ["max", "telegram"] as const) {
  for (const photoCount of [0, 1, 5]) {
    it(`${channel}: summary with ${photoCount} photos has first full-width create action and secondary navigation`, () => {
      const ui = buildStepUi(channel, draftId, revision, "summary", {
        photoInspectButtons: Array.from({ length: photoCount }, (_, i) => ({
          label: `Фото ${i + 1}`, arg: String(i),
        })),
      });
      const rows = channel === "max"
        ? buildMaxInlineKeyboardAttachment(ui.maxInlineButtons!).payload.buttons
        : ui.telegramInlineKeyboard!;
      assert.equal(rows[0].length, 1, "primary action must not share its row");
      assert.equal(rows[0][0].text, "Создать передачу");
      const callback = "payload" in rows[0][0] ? rows[0][0].payload : rows[0][0].callback_data;
      assert.equal(callback, buildNativeCreateCallback("confirm", draftId, revision),
        "presentation change preserves canonical confirmation callback");
      assert.equal(rows.flat().filter(b => b.text === "Создать передачу").length, 1);
      assert.equal(rows[1][0].text, "Имя для меня");
      if (photoCount) {
        assert.deepEqual(rows[2].map(b => b.text),
          Array.from({ length: photoCount }, (_, i) => `Фото ${i + 1}`));
      }
      assert.deepEqual(rows.at(-2)!.map(b => b.text), ["Изменить данные", "◀ Назад"]);
      assert.deepEqual(rows.at(-1)!.map(b => b.text), ["Отмена", "Меню"]);
      for (const row of rows) {
        assert.ok(row.length >= 1 && row.length <= 5);
        for (const button of row) {
          const data = "payload" in button ? button.payload : button.callback_data;
          assert.ok(data && Buffer.byteLength(data) <= 64);
        }
      }
    });
  }
}
