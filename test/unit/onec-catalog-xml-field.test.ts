import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readXmlScalar } from "../../src/onec-catalog/xml-field";

describe("onec catalog xml scalar reader", () => {
  it("reads attribute values for 1C contract fields", () => {
    const read = readXmlScalar("Цена", { Цена: "347,39" }, "");
    assert.deepEqual(read, { kind: "value", raw: "347,39", source: "attribute" });
  });

  it("falls back to text when attribute is absent", () => {
    const read = readXmlScalar("Цена", {}, "10,5");
    assert.deepEqual(read, { kind: "value", raw: "10,5", source: "text" });
  });

  it("rejects ambiguous attribute and text combinations", () => {
    const read = readXmlScalar("Количество", { Количество: "10" }, "2");
    assert.equal(read.kind, "ambiguous");
  });

  it("distinguishes absent from empty attribute", () => {
    assert.deepEqual(readXmlScalar("Количество", {}, ""), { kind: "absent" });
    assert.deepEqual(readXmlScalar("Количество", { Количество: "" }, ""), {
      kind: "value",
      raw: "",
      source: "attribute",
    });
  });
});
