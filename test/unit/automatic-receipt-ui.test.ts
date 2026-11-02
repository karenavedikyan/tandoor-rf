import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { it } from "node:test";
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
