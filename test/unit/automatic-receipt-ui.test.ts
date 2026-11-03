import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { it } from "node:test";
import { automaticReceiptSenderGuidance } from "../../src/tan-tracker/automatic-receipt-codes";
const source = fs.readFileSync("public/tan-tracker/tan-tracker.js", "utf8");
const start = source.indexOf("  function automaticReceiptHandoffHtml(");
const end = source.indexOf("  function recipientCodeInvitationUrl(", start);
const context = vm.createContext({ E: (x: string) => x });
vm.runInContext(source.slice(start, end), context);
const render = (status?: string) =>
  vm.runInContext(
    `automaticReceiptHandoffHtml({automaticReceiptStatus:${JSON.stringify(status) ?? "undefined"}},"FALLBACK")`,
    context,
  ) as string;
it("creation and continuation use the same private recipient delivery and current retry button", () => {
  for (const existing of [true, false]) {
    const text = automaticReceiptSenderGuidance("TT-2026-42", existing);
    assert.match(text, /Пересылать приглашение не нужно/);
    assert.match(text, /Запросить код повторно/);
    assert.match(text, /Ответственность перейдёт только после проверки кода/);
    assert.doesNotMatch(text, /Обновить приглашение/);
    if (existing) {
      assert.match(text, /назначен следующий получатель/);
      assert.doesNotMatch(text, /Передача создана/);
    } else assert.match(text, /Передача создана/);
  }
});
it("holder sees queued versus delivered copy, never digits, with invitation only as fallback", () => {
  assert.match(render("pending"), /Код будет отправлен/);
  assert.doesNotMatch(render("pending"), /Код отправлен/);
  assert.match(render("sent"), /Код отправлен/);
  assert.match(
    render("sent"),
    /<details><summary>Если сообщение с кодом не пришло<\/summary>FALLBACK<\/details>/,
  );
  assert.match(render("sent"), /Пересылать приглашение не нужно/);
  for (const s of [undefined, "failed", "cancelled"])
    assert.equal(render(s), "FALLBACK");
});
