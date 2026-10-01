import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import {
  buildMinimalCatalogXmlSet,
  catalogEntriesFromXmlSet,
} from "../helpers/onec-catalog-fixtures";

describe("onec catalog xml structure guard", () => {
  it("skips unknown subtrees without overwriting the outer product", async () => {
    const xmlSet = buildMinimalCatalogXmlSet();
    xmlSet["catalog/products/data.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="outer">
    <Extension>
      <Товары>
        <Товар Код="p2" Группа="g1" Активность="Y" Название="inner"/>
      </Товары>
    </Extension>
  </Товар>
</Товары>`;
    const entries = catalogEntriesFromXmlSet(xmlSet);
    const parsed = await parseCatalogSet(
      entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    );
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.data!.products.map((row) => row.code), ["p1"]);
    assert.ok(parsed.data!.warnings.some((warning) => warning.element === "Extension"));

    const validated = validateCatalogSet(parsed.data!);
    assert.equal(validated.ok, true);
    assert.deepEqual(validated.data!.products.map((row) => row.code), ["p1"]);
    assert.ok(!validated.data!.products.some((row) => row.code === "p2"));
  });

  it("rejects nested root catalog containers", async () => {
    const xmlSet = buildMinimalCatalogXmlSet();
    xmlSet["catalog/products/data.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="outer">
    <Товары>
      <Товар Код="p2" Группа="g1" Активность="Y" Название="inner"/>
    </Товары>
  </Товар>
</Товары>`;
    const entries = catalogEntriesFromXmlSet(xmlSet);
    const parsed = await parseCatalogSet(
      entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.ok(parsed.issues.some((issue) => issue.code === "INVALID_STRUCTURE"));
    }
  });

  it("skips unknown subtrees in commercial stock containers", async () => {
    const xmlSet = buildMinimalCatalogXmlSet();
    xmlSet["catalog/stock/data.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<ОстаткиСклада>
  <Остаток Код="p1">
    <Extension>
      <ОстаткиСклада>
        <Остаток Код="p1">
          <Склады><Склад СкладID="wh1" Количество="99"/></Склады>
        </Остаток>
      </ОстаткиСклада>
    </Extension>
    <Склады><Склад СкладID="wh1" Количество="10,5"/></Склады>
  </Остаток>
</ОстаткиСклада>`;
    const entries = catalogEntriesFromXmlSet(xmlSet);
    const parsed = await parseCatalogSet(
      entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data!.stock.length, 1);
    assert.equal(parsed.data!.stock[0]?.quantityRaw, "10,5");
  });
});
