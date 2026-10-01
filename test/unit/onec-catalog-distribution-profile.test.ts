import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCatalogImportCliArgs } from "../../src/onec-catalog/cli-args";
import { buildManifest } from "../../src/onec-catalog/manifest";
import { parseCatalogSet } from "../../src/onec-catalog/parse-catalog-set";
import { validateCatalogSet } from "../../src/onec-catalog/validate-catalog-set";
import {
  buildMinimalCatalogXmlSet,
  buildMinimalDistributionXmlSet,
  catalogDistributionEntriesFromXmlSet,
  catalogEntriesFromXmlSet,
} from "../helpers/onec-catalog-fixtures";

describe("onec catalog distribution profile", () => {
  it("parses --profile=distribution from CLI args", () => {
    const parsed = parseCatalogImportCliArgs(["--dry-run", "--profile=distribution"]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.options.profile, "distribution");
      assert.equal(parsed.options.mode, "dry_run");
    }
  });

  it("defaults to full profile when --profile is omitted", () => {
    const parsed = parseCatalogImportCliArgs(["--dry-run"]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.options.profile, "full");
  });

  it("builds distinct manifest SHA for the same three files across profiles", () => {
    const xmlSet = buildMinimalDistributionXmlSet();
    const distributionEntries = catalogDistributionEntriesFromXmlSet(xmlSet);
    const fullEntries = catalogEntriesFromXmlSet(buildMinimalCatalogXmlSet());
    const distributionManifest = buildManifest(distributionEntries, "distribution").manifestSha256;
    const fullManifest = buildManifest(fullEntries, "full").manifestSha256;
    assert.notEqual(distributionManifest, fullManifest);
  });

  it("allows missing group references in distribution but blocks in full profile", async () => {
    const xmlSet = buildMinimalDistributionXmlSet();
    xmlSet["catalog/products/data.xml"] = xmlSet["catalog/products/data.xml"].replace(
      'Группа="g1"',
      'Группа="missing-group"',
    );
    const entries = catalogDistributionEntriesFromXmlSet(xmlSet);
    const fileInputs = entries.map((file) => ({
      relativePath: file.relativePath,
      bytes: file.bytes,
    }));

    const distributionParsed = await parseCatalogSet(fileInputs, "distribution");
    assert.equal(distributionParsed.ok, true);
    const distributionValidated = validateCatalogSet(distributionParsed.data!, { profile: "distribution" });
    assert.equal(distributionValidated.ok, true);
    assert.equal(distributionValidated.data!.products[0]?.groupCode, "missing-group");
    assert.equal(distributionValidated.data!.classificationIncomplete, true);
    assert.equal(distributionValidated.data!.classificationWarnings[0]?.code, "MISSING_GROUP_REFERENCE");
    assert.equal(distributionValidated.data!.classificationWarnings[0]?.affectedProductCount, 1);
    assert.equal(distributionValidated.data!.commercialStatus, "not_requested");

    const fullParsed = await parseCatalogSet(
      catalogEntriesFromXmlSet(buildMinimalCatalogXmlSet()).map((file) => ({
        relativePath: file.relativePath,
        bytes: file.bytes,
      })),
    );
    assert.equal(fullParsed.ok, true);
    const fullXml = buildMinimalCatalogXmlSet();
    fullXml["catalog/products/data.xml"] = fullXml["catalog/products/data.xml"].replace(
      'Группа="g1"',
      'Группа="missing-group"',
    );
    const fullWithMissing = await parseCatalogSet(
      catalogEntriesFromXmlSet(fullXml).map((file) => ({
        relativePath: file.relativePath,
        bytes: file.bytes,
      })),
      "full",
    );
    assert.equal(fullWithMissing.ok, true);
    const fullValidated = validateCatalogSet(fullWithMissing.data!, { profile: "full" });
    assert.equal(fullValidated.ok, false);
    if (!fullValidated.ok) {
      assert.ok(fullValidated.issues.some((issue) => issue.code === "MISSING_GROUP"));
    }
  });

  it("does not require commercial XML files in distribution parse", async () => {
    const xmlSet = buildMinimalDistributionXmlSet();
    const entries = catalogDistributionEntriesFromXmlSet(xmlSet);
    const parsed = await parseCatalogSet(
      entries.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
      "distribution",
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data!.prices.length, 0);
    assert.equal(parsed.data!.stock.length, 0);
    assert.equal(parsed.data!.storages.length, 0);
  });
});
