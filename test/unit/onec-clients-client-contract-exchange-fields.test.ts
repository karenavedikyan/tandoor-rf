import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CLIENT_CONTRACT_JSON_KEY_AGREEMENT,
  CLIENT_CONTRACT_JSON_KEY_PRIMARY,
  createEmptyClientContractExchange,
  mergeClientContractExchangeFields,
  parseClientContractExchangeFields,
} from "../../src/onec-clients/client-contract-exchange-fields";

describe("onec-clients client contract exchange fields (F4)", () => {
  it("parses both scalar contract fields as strings", () => {
    const parsed = parseClientContractExchangeFields({
      [CLIENT_CONTRACT_JSON_KEY_PRIMARY]: "Договор № F4-2026",
      [CLIENT_CONTRACT_JSON_KEY_AGREEMENT]: "Соглашение «Рамочное»",
    });
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.clientContract.primaryContract, "Договор № F4-2026");
    assert.equal(parsed.clientContract.mainAgreement, "Соглашение «Рамочное»");
    assert.equal(parsed.clientContract.fieldPresence.primaryContract, true);
    assert.equal(parsed.clientContract.fieldPresence.mainAgreement, true);
  });

  it("treats explicit empty string as present with empty value", () => {
    const parsed = parseClientContractExchangeFields({
      [CLIENT_CONTRACT_JSON_KEY_PRIMARY]: "",
    });
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.clientContract.primaryContract, "");
    assert.equal(parsed.clientContract.fieldPresence.primaryContract, true);
  });

  it("rejects non-string types for both F4 fields", () => {
    const invalidValues: unknown[] = [123, 0, true, false, [], { x: 1 }];
    for (const fieldKey of [CLIENT_CONTRACT_JSON_KEY_PRIMARY, CLIENT_CONTRACT_JSON_KEY_AGREEMENT]) {
      for (const bad of invalidValues) {
        assert.equal(parseClientContractExchangeFields({ [fieldKey]: bad }).invalid, true);
      }
    }
  });

  it("preserves string zero and literal invalid as-is", () => {
    const parsed = parseClientContractExchangeFields({
      [CLIENT_CONTRACT_JSON_KEY_PRIMARY]: "0",
      [CLIENT_CONTRACT_JSON_KEY_AGREEMENT]: "invalid",
    });
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.clientContract.primaryContract, "0");
    assert.equal(parsed.clientContract.mainAgreement, "invalid");
  });

  it("preserves previous contract when incoming export omits keys", () => {
    const previous = {
      ...createEmptyClientContractExchange(),
      primaryContract: "Stored contract",
      fieldPresence: { ...createEmptyClientContractExchange().fieldPresence, primaryContract: true },
    };
    const merged = mergeClientContractExchangeFields(parseClientContractExchangeFields({}).clientContract, previous);
    assert.equal(merged.primaryContract, "Stored contract");
  });

  it("recovered structure fixture includes F4 field paths", () => {
    const fixture = JSON.parse(
      readFileSync("test/fixtures/onec-clients/recovered-exchange-structure.json", "utf8"),
    ) as { fields: Array<{ path: string }> };
    const paths = fixture.fields.map((field) => field.path);
    assert.ok(paths.includes("$[].Оптовик_ОсновнойДоговор"));
    assert.ok(paths.includes("$[].Оптовик_ОсновноеСоглашение"));
  });
});
