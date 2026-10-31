import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSearch, parseProductsJson, safeImagePath, searchText } from "../../src/internal-catalog/model";
import { catalogueFixture, fixtureGuid } from "../helpers/internal-catalog-fixtures";
const parse = (value: unknown) => parseProductsJson(Buffer.from(JSON.stringify(value)));
describe("isolated internal JSON catalogue", () => {
  it("preserves raw strings, GUID identity, sections and partial metadata", () => {
    const products = catalogueFixture();
    const parsed = parse(products);
    assert.deepEqual(parsed.products, products);
    assert.equal(parsed.summary.products, 30);
    assert.equal(parsed.summary.sections.length, 2);
    assert.equal(parsed.summary.textsAt1024, 1);
    assert.equal(parsed.summary.productsWithImagePaths, 1);
    assert.equal(parsed.summary.imagePaths, 1);
    assert.deepEqual(parsed.summary.brands, ["Альфа", "Бета"]);
    assert.equal(parsed.sha256.length, 64);
  });
  it("normalizes ё/case/Unicode spaces for search, not source values", () => {
    assert.equal(normalizeSearch("  ЁЛКА\u00a0  ТЕСТ "), "елка тест");
    assert.match(searchText(catalogueFixture()[0]), /елка 100%_ a\/b/);
    assert.match(searchText(catalogueFixture()[0]), /art-1/);
  });
  it("rejects unsafe paths and external URLs, accepts relative Windows paths", () => {
    for (const value of ["../a.jpg", "/a.jpg", "C:\\a.jpg", "https://x/a.jpg", "a\\..\\b.jpg", "a//b.png", "a\0.jpg", "a.svg", "a.jpg "]) {
      assert.equal(safeImagePath(value), null, value);
    }
    assert.equal(safeImagePath("20240626\\Товар.JPG"), "20240626/Товар.JPG");
    const products = catalogueFixture(1); products[0].files[0].path = "../x.jpg";
    assert.throws(() => parse(products), /UNSAFE_IMAGE_PATH/);
  });
  it("rejects empty/malformed files, duplicate identities and conflicting dictionaries", () => {
    assert.throws(() => parse([]), /EMPTY_SNAPSHOT/);
    assert.throws(() => parse({ products: [] }), /INVALID_ARRAY/);
    assert.throws(() => parseProductsJson(Buffer.from("broken")), /INVALID_JSON/);
    const duplicate = catalogueFixture(2); duplicate[1].guid = duplicate[0].guid;
    assert.throws(() => parse(duplicate), /DUPLICATE_GUID/);
    const conflicting = catalogueFixture(2);
    conflicting[1].chapter = [{ guid: fixtureGuid(100), name: "Другой раздел" }];
    assert.throws(() => parse(conflicting), /CONFLICTING_NAME/);
    const invalid = catalogueFixture(1); invalid[0].guid = "bad";
    assert.throws(() => parse(invalid), /INVALID_GUID/);
    assert.throws(() => parseProductsJson(Buffer.from([0xc3, 0x28])), /INVALID_UTF8/);
    assert.throws(() => parse([{ ...catalogueFixture(1)[0], price: 100 }]), /UNEXPECTED_FIELD/);
  });
  it("does not invent missing price, stock, article, image or publication defaults", () => {
    const products = catalogueFixture(1); products[0].properties = []; products[0].files = [];
    const result = parse(products);
    assert.deepEqual(result.products[0].properties, []);
    assert.deepEqual(result.products[0].files, []);
    assert.equal(result.summary.brands.length, 0);
    assert.equal(result.summary.productsWithImagePaths, 0);
    assert.equal("price" in result.products[0], false);
    assert.equal("activity" in result.products[0], false);
  });
  it("allows HTML only as inert source strings; does not interpret data as markup", () => {
    const products = catalogueFixture(1); products[0].name = '<img src=x onerror="alert(1)">';
    products[0].properties[0].value = "<script>bad()</script>";
    assert.deepEqual(parse(products).products, products);
  });
});
