import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildForwardInvitationGuidance } from "../../src/tanbot/native-create/forward-invitation-guidance";

describe("sender forward-invitation guidance", () => {
  it("leads with forwarding the next message, keeping the code action and track identity concise", () => {
    const text = buildForwardInvitationGuidance("TT-2026-015");
    assert.equal(text.split("\n")[0], "ПЕРЕШЛИТЕ СЛЕДУЮЩЕЕ СООБЩЕНИЕ ПОЛУЧАТЕЛЮ");
    assert.match(text, /ссылка для получения кода/u);
    assert.match(text, /Попросите код у получателя и нажмите «Ввести код»/u);
    assert.match(text, /Передача создана: TT-2026-015\./u);
    assert.match(text, /только после подтверждения/u);
    assert.equal(text.match(/TT-2026-015/g)?.length, 1);
    assert.ok(text.length < 300);
    assert.doesNotMatch(text, /Статус:|Ответственный:|Ваш следующий шаг|Карточка доступна|Для подтверждения в этом чате/u);
  });
});
