import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  V3_CLIENT_OTHER_INVENTORY_KEYS,
  pickSupportedOtherFields,
} from "../../src/onec-exchange-v3/other-fields";

describe("onec-exchange-v3 client other fields", () => {
  it("preserves every inventory key present in source row", () => {
    const raw: Record<string, unknown> = {};
    for (const key of V3_CLIENT_OTHER_INVENTORY_KEYS) {
      raw[key] = key === "ПометкаУдаления" ? "Нет" : `value-${key}`;
    }
    raw["FutureUnknownKeyFrom1C"] = "future";
    const picked = pickSupportedOtherFields(raw);
    for (const key of V3_CLIENT_OTHER_INVENTORY_KEYS) {
      assert.ok(key in picked, `missing ${key}`);
    }
    assert.equal(picked.FutureUnknownKeyFrom1C, "future");
  });

  it("keeps false and zero as stored values", () => {
    const picked = pickSupportedOtherFields({
      Оптовик_Наличные: false,
      Оптовик_СуммаОботоротаВМесяцТандор: 0,
      ПометкаУдаления: "Нет",
    });
    assert.equal(picked.Оптовик_Наличные, false);
    assert.equal(picked.Оптовик_СуммаОботоротаВМесяцТандор, 0);
    assert.equal(picked.ПометкаУдаления, "Нет");
  });
});
