import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  createEmptyWholesaleClientExchange,
  mergeWholesaleClientExchangeFields,
  parseWholesaleClientExchangeFields,
  WHOLESALE_JSON_KEY_OUTLET_CATEGORY,
  WHOLESALE_JSON_KEY_TOP150,
} from "../../src/onec-clients/wholesale-client-exchange-fields";

describe("onec-clients wholesale exchange fields (F2)", () => {
  it("parses observed TOP value «Нет» and preserves unknown category strings separately", () => {
    const parsed = parseWholesaleClientExchangeFields({
      [WHOLESALE_JSON_KEY_TOP150]: "Нет",
      [WHOLESALE_JSON_KEY_OUTLET_CATEGORY]: "SYNTH-UNKNOWN",
    });
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.wholesale.fieldPresence.top150, true);
    assert.equal(parsed.wholesale.top150, "Нет");
    assert.equal(parsed.wholesale.fieldPresence.outletCategory, true);
    assert.equal(parsed.wholesale.outletCategory, "SYNTH-UNKNOWN");
  });

  it("treats explicit empty category string as present with empty value", () => {
    const parsed = parseWholesaleClientExchangeFields({
      [WHOLESALE_JSON_KEY_OUTLET_CATEGORY]: "",
    });
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.wholesale.fieldPresence.outletCategory, true);
    assert.equal(parsed.wholesale.outletCategory, "");
  });

  it("omits keys without field presence", () => {
    const parsed = parseWholesaleClientExchangeFields({});
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.wholesale.fieldPresence.top150, false);
    assert.equal(parsed.wholesale.fieldPresence.outletCategory, false);
  });

  it("rejects invalid wholesale shapes", () => {
    assert.equal(
      parseWholesaleClientExchangeFields({ [WHOLESALE_JSON_KEY_TOP150]: { bad: true } }).invalid,
      true,
    );
  });

  it("preserves previous wholesale when incoming export omits keys", () => {
    const previous = {
      ...createEmptyWholesaleClientExchange(),
      top150: "Нет",
      fieldPresence: { ...createEmptyWholesaleClientExchange().fieldPresence, top150: true },
    };
    const merged = mergeWholesaleClientExchangeFields(parseWholesaleClientExchangeFields({}).wholesale, previous);
    assert.equal(merged.top150, "Нет");
    assert.equal(merged.fieldPresence.top150, true);
  });

  it("recovered structure fixture matches confirmed SHA and field paths", () => {
    const fixture = JSON.parse(
      readFileSync("test/fixtures/onec-clients/recovered-exchange-structure.json", "utf8"),
    ) as {
      sha256: string;
      fields: Array<{ path: string }>;
    };
    assert.equal(fixture.sha256, "b439063b1602743ab1df56ee6390ba9d3cc64dce7cdc24763c3d4d7176c74b74");
    const paths = fixture.fields.map((field) => field.path);
    assert.ok(paths.includes("$[].Оптовик_Топ150"));
    assert.ok(paths.includes("$[].Оптовик_КатегорияТорговойТочкиТандор"));
  });
});
