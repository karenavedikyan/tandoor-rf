import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";
import { V3_CLIENT_OTHER_INVENTORY_KEYS } from "../../src/onec-exchange-v3/other-fields";

describe("exchange field matrix inventory", () => {
  it("maps every declared client other key into UI catalog groups or extra bucket policy", () => {
    const catalogSource = fs.readFileSync(
      path.join(process.cwd(), "public/client-detail-exchange-catalog.js"),
      "utf8",
    );
    const window: Record<string, unknown> = {};
    vm.runInNewContext(catalogSource, { window });
    const catalog = window.ClientDetailExchangeCatalog as {
      otherFieldGroups: Record<string, string[]>;
    };
    const grouped = new Set<string>();
    Object.values(catalog.otherFieldGroups).forEach((keys) => keys.forEach((key) => grouped.add(key)));
    const missing = V3_CLIENT_OTHER_INVENTORY_KEYS.filter((key) => !grouped.has(key));
    assert.deepEqual(missing, [], `Unmapped inventory keys: ${missing.join(", ")}`);
  });
});
