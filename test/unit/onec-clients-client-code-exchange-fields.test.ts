import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CLIENT_CODE_JSON_KEY,
  createEmptyClientCodeExchange,
  mergeClientCodeExchangeFields,
  parseClientCodeExchangeFields,
} from "../../src/onec-clients/client-code-exchange-fields";

describe("onec-clients client code exchange fields (F5)", () => {
  it("parses client code string with leading zeros", () => {
    const parsed = parseClientCodeExchangeFields({
      [CLIENT_CODE_JSON_KEY]: "001234",
    });
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.clientCode.code1c, "001234");
    assert.equal(parsed.clientCode.fieldPresence.code1c, true);
  });

  it("preserves string zero", () => {
    const parsed = parseClientCodeExchangeFields({ [CLIENT_CODE_JSON_KEY]: "0" });
    assert.equal(parsed.invalid, false);
    assert.equal(parsed.clientCode.code1c, "0");
  });

  it("rejects non-string types", () => {
    for (const bad of [123, true, [], {}]) {
      assert.equal(parseClientCodeExchangeFields({ [CLIENT_CODE_JSON_KEY]: bad }).invalid, true);
    }
  });

  it("preserves previous code when incoming omits key", () => {
    const previous = {
      ...createEmptyClientCodeExchange(),
      code1c: "KEEP-001",
      fieldPresence: { code1c: true },
    };
    const merged = mergeClientCodeExchangeFields(parseClientCodeExchangeFields({}).clientCode, previous);
    assert.equal(merged.code1c, "KEEP-001");
  });

  it("fixture includes Код path", () => {
    const fixture = JSON.parse(
      readFileSync("test/fixtures/onec-clients/recovered-exchange-structure.json", "utf8"),
    ) as { fields: Array<{ path: string }> };
    assert.ok(fixture.fields.some((f) => f.path === "$[].Код"));
  });
});
