import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMinimalCatalogXmlSet, catalogEntriesFromXmlSet } from "../helpers/onec-catalog-fixtures";
import { buildManifest } from "../../src/onec-catalog/manifest";

describe("onec catalog manifest", () => {
  it("changes when any file bytes change", () => {
    const base = buildManifest(catalogEntriesFromXmlSet(buildMinimalCatalogXmlSet())).manifestSha256;
    const alteredSet = buildMinimalCatalogXmlSet();
    alteredSet["catalog/prices/data.xml"] = alteredSet["catalog/prices/data.xml"].replace(
      "347,39",
      "347,40",
    );
    const altered = buildManifest(catalogEntriesFromXmlSet(alteredSet)).manifestSha256;
    assert.notEqual(base, altered);
  });
});
