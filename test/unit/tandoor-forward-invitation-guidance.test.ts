import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildForwardInvitationGuidance } from "../../src/tanbot/native-create/forward-invitation-guidance";

describe("sender forward-invitation guidance", () => {
  it("leads with getting the recipient code, then explains forwarding the next message concisely", () => {
    const text = buildForwardInvitationGuidance("TT-2026-015");
    assert.equal(text.split("\n")[0], "ПОЛУЧИТЕ КОД У ПОЛУЧАТЕЛЯ!");
    assert.match(text, /Перешлите следующее сообщение со ссылкой получателю/u);
    assert.match(text, /Он откроет ссылку и сообщит вам код/u);
    assert.match(text, /Нажмите «Ввести код» и введите его/u);
    assert.match(text, /Передача создана: TT-2026-015\./u);
    assert.match(text, /только после подтверждения/u);
    assert.equal(text.match(/TT-2026-015/g)?.length, 1);
    assert.ok(text.length < 300);
    assert.doesNotMatch(text, /Статус:|Ответственный:|Ваш следующий шаг|Карточка доступна|Для подтверждения в этом чате/u);
  });
});
