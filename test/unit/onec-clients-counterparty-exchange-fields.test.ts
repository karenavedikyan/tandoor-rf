import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  COUNTERPARTY_JSON_KEY_FULL_NAME,
  COUNTERPARTY_JSON_KEY_LEGAL_TYPE,
  COUNTERPARTY_JSON_KEY_NAME,
  COUNTERPARTY_JSON_KEY_OGRN,
  createEmptyCounterpartyExchange,
  mergeCounterpartyExchangeFields,
  parseCounterpartyExchangeFields,
} from "../../src/onec-clients/counterparty-exchange-fields";

describe("onec-clients counterparty exchange fields (F3)", () => {
  it("parses scalar counterparty fields and preserves leading zeros in OGRN", () => {
    const parsed = parseCounterpartyExchangeFields({
      [COUNTERPARTY_JSON_KEY_NAME]: "ООО «Синтетика»",
      [COUNTERPARTY_JSON_KEY_LEGAL_TYPE]: "Компания",
      [COUNTERPARTY_JSON_KEY_OGRN]: "0123456789012",
      [COUNTERPARTY_JSON_KEY_FULL_NAME]: "Общество с ограниченной ответственностью «Синтетика»",
    });
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.counterparty.fieldPresence.counterparty, true);
    assert.equal(parsed.counterparty.counterparty, "ООО «Синтетика»");
    assert.equal(parsed.counterparty.fieldPresence.legalEntityType, true);
    assert.equal(parsed.counterparty.legalEntityType, "Компания");
    assert.equal(parsed.counterparty.fieldPresence.ogrn, true);
    assert.equal(parsed.counterparty.ogrn, "0123456789012");
    assert.equal(parsed.counterparty.fieldPresence.fullName, true);
    assert.equal(parsed.counterparty.fullName, "Общество с ограниченной ответственностью «Синтетика»");
  });

  it("treats explicit empty full name string as present with empty value", () => {
    const parsed = parseCounterpartyExchangeFields({
      [COUNTERPARTY_JSON_KEY_FULL_NAME]: "",
    });
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.counterparty.fieldPresence.fullName, true);
    assert.equal(parsed.counterparty.fullName, "");
  });

  it("omits keys without field presence", () => {
    const parsed = parseCounterpartyExchangeFields({});
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.counterparty.fieldPresence.counterparty, false);
    assert.equal(parsed.counterparty.fieldPresence.legalEntityType, false);
    assert.equal(parsed.counterparty.fieldPresence.ogrn, false);
    assert.equal(parsed.counterparty.fieldPresence.fullName, false);
  });

  it("rejects invalid counterparty shapes", () => {
    assert.equal(
      parseCounterpartyExchangeFields({ [COUNTERPARTY_JSON_KEY_OGRN]: { bad: true } }).invalid,
      true,
    );
  });

  it("preserves literal string «invalid» for counterparty scalars", () => {
    const parsed = parseCounterpartyExchangeFields({
      [COUNTERPARTY_JSON_KEY_NAME]: "invalid",
      [COUNTERPARTY_JSON_KEY_OGRN]: "invalid",
    });
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.counterparty.counterparty, "invalid");
    assert.equal(parsed.counterparty.ogrn, "invalid");
  });

  it("preserves previous counterparty when incoming export omits keys", () => {
    const previous = {
      ...createEmptyCounterpartyExchange(),
      ogrn: "0123456789012",
      fieldPresence: { ...createEmptyCounterpartyExchange().fieldPresence, ogrn: true },
    };
    const merged = mergeCounterpartyExchangeFields(parseCounterpartyExchangeFields({}).counterparty, previous);
    assert.equal(merged.ogrn, "0123456789012");
    assert.equal(merged.fieldPresence.ogrn, true);
  });

  it("recovered structure fixture matches confirmed SHA and F3 field paths", () => {
    const fixture = JSON.parse(
      readFileSync("test/fixtures/onec-clients/recovered-exchange-structure.json", "utf8"),
    ) as {
      sha256: string;
      fields: Array<{ path: string }>;
    };
    assert.equal(fixture.sha256, "b439063b1602743ab1df56ee6390ba9d3cc64dce7cdc24763c3d4d7176c74b74");
    const paths = fixture.fields.map((field) => field.path);
    assert.ok(paths.includes("$[].Контрагент"));
    assert.ok(paths.includes("$[].ЮрФизЛицо"));
    assert.ok(paths.includes("$[].Оптовик_ОГРН"));
    assert.ok(paths.includes("$[].НаименованиеПолное"));
  });
});
