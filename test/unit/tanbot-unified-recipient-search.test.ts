import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  externalRecipientIntroPrompt,
  externalSummaryDisplayName,
  staffRecipientIntroPrompt,
  recipientStepPrompt,
  staffSingleCharHint,
} from "../../src/tanbot/native-create/recipient-unified";
import type { NativeCreateDraftPayload } from "../../src/tanbot/native-create/draft-scope";

describe("unified recipient prompts", () => {
  it("staff intro requests only phone, with contact as an alternative way to send it", () => {
    const text = staffRecipientIntroPrompt();
    assert.doesNotMatch(text, /имя|фамили/i);
    assert.match(text, /\+7XXXXXXXXXX/);
    assert.match(text, /телефон/i);
    assert.match(text, /контакт/i);
  });

  it("external intro is phone/contact only without internal search hints", () => {
    const text = externalRecipientIntroPrompt();
    assert.match(text, /телефон/i);
    assert.match(text, /контакт/i);
    assert.doesNotMatch(text, /фамили/i);
    assert.doesNotMatch(text, /каталог/i);
  });

  it("external summary display avoids private staff profile names", () => {
    assert.match(externalSummaryDisplayName("+79991112233"), /Получатель/);
    assert.doesNotMatch(externalSummaryDisplayName("+79991112233"), /Иванов/);
  });

  it("short input, no match and existing match all guide to phone, not name search", () => {
    const payload = {
      draftOrigin: "native_bot", actor: "staff", revision: 1, recipientSearchQuery: "Unmatched Name",
      eligibleRecipients: [],
    } as NativeCreateDraftPayload;
    for (const text of [
      staffSingleCharHint(),
      recipientStepPrompt(payload, "staff"),
      recipientStepPrompt({ ...payload, eligibleRecipients: [{ userId: "synthetic", fullName: "Target" }] }, "staff"),
    ]) {
      assert.match(text, /телефон/);
      assert.doesNotMatch(text, /Введите имя|фамили|имя от|символ.*поиск|уточните запрос/);
    }
  });
});
