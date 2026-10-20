import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLegalSalesCliArgs } from "../../src/onec-sales/cli-args";
import { saleDecimalStringsEqual } from "../../src/onec-sales/decimal";

describe("legal sales decimal plan comparison", () => {
  it("treats JSON integer and PostgreSQL numeric scale as equal", () => {
    assert.equal(saleDecimalStringsEqual("1000", "1000.0000"), true);
    assert.equal(saleDecimalStringsEqual("900", "900.0000"), true);
  });

  it("detects real monetary changes", () => {
    assert.equal(saleDecimalStringsEqual("1000", "1000.0001"), false);
  });
});

describe("legal sales CLI default source", () => {
  it("allows dry-run without --sale-file (FTP default)", () => {
    const parsed = parseLegalSalesCliArgs(["--dry-run"]);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.options.saleFilePath, undefined);
    assert.equal(parsed.options.mode, "dry_run");
  });
});
