import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  externalRecipientIntroPrompt,
  externalSummaryDisplayName,
  staffRecipientIntroPrompt,
} from "../../src/tanbot/native-create/recipient-unified";

describe("unified recipient prompts", () => {
  it("staff intro mentions name, surname, phone and contact", () => {
    const text = staffRecipientIntroPrompt();
    assert.match(text, /имя/i);
    assert.match(text, /фамили/i);
    assert.match(text, /телефон/i);
    assert.match(text, /контакт/i);
    assert.doesNotMatch(text, /только.*телефон/i);
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
});
