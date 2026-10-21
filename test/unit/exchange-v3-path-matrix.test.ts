import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { V3_CLIENT_OTHER_INVENTORY_KEYS } from "../../src/onec-exchange-v3/other-fields";
import {
  EXCHANGE_V3_PATH_MATRIX,
  matchExchangeV3MatrixPath,
  type ExchangeV3PathDisposition,
} from "../../src/onec-exchange-v3/exchange-v3-path-matrix";

function collectPaths(value: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (value === null || value === undefined) {
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPaths(item, prefix ? `${prefix}[]` : "[]", out);
    }
    return out;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const next = prefix ? `${prefix}.${key}` : key;
      out.add(next);
      collectPaths(child, next, out);
    }
  }
  return out;
}

function fixturePaths(fileName: string): Set<string> {
  const fixturePath = path.join(process.cwd(), "test/fixtures/onec-exchange-v3", fileName);
  if (!fs.existsSync(fixturePath)) {
    return new Set();
  }
  const data = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as unknown[];
  const keys = new Set<string>();
  for (const row of data) {
    collectPaths(row, "", keys);
  }
  return keys;
}

describe("exchange v3 path matrix", () => {
  it("includes every inventory other key", () => {
    const otherPaths = new Set(
      EXCHANGE_V3_PATH_MATRIX.filter((e) => e.file === "all_clients.json" && e.path.startsWith("other.")).map(
        (e) => e.path.slice("other.".length),
      ),
    );
    const missing = V3_CLIENT_OTHER_INVENTORY_KEYS.filter((key) => !otherPaths.has(key));
    assert.deepEqual(missing, []);
  });

  it("covers every path in materialized five-file inventory (exact match, no parent fallback)", () => {
    const inventory = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data/client-card-v3-exchange-path-inventory.json"), "utf8"),
    ) as { files: Record<string, string[]> };
    const fileNames = Object.keys(inventory.files).sort();
    assert.deepEqual(fileNames, [
      "all_clients.json",
      "all_employees.json",
      "all_holding.json",
      "all_retail.json",
      "sale.json",
    ]);
    let totalPaths = 0;
    const missing: string[] = [];
    for (const [file, paths] of Object.entries(inventory.files)) {
      totalPaths += paths.length;
      for (const observed of paths) {
        if (!matchExchangeV3MatrixPath(file as ExchangeV3PathDisposition["file"], observed)) {
          missing.push(`${file}:${observed}`);
        }
      }
    }
    assert.equal(totalPaths, 218);
    assert.deepEqual(missing, []);
  });

  it("rejects wrong-file paths and does not parent-fallback unlisted children", () => {
    assert.equal(matchExchangeV3MatrixPath("all_retail.json", "other.Пол"), null);
    assert.equal(matchExchangeV3MatrixPath("all_clients.json", "other.Пол"), EXCHANGE_V3_PATH_MATRIX.find(
      (e) => e.file === "all_clients.json" && e.path === "other.Пол",
    ));
    assert.equal(matchExchangeV3MatrixPath("all_retail.json", "address.fictional_nested_field"), null);
    const parent = matchExchangeV3MatrixPath("all_retail.json", "address");
    const child = matchExchangeV3MatrixPath("all_retail.json", "address.store_address");
    assert.ok(parent);
    assert.ok(child);
    assert.notEqual(parent?.path, child?.path);
  });

  it("covers all paths observed in v3 JSON fixtures", () => {
    const files: Array<{ file: "all_clients.json" | "all_holding.json" | "all_retail.json"; name: string }> = [
      { file: "all_clients.json", name: "all_clients.json" },
      { file: "all_holding.json", name: "all_holding.json" },
      { file: "all_retail.json", name: "all_retail.json" },
    ];
    const unmatched: string[] = [];
    for (const { file, name } of files) {
      for (const observed of fixturePaths(name)) {
        if (!matchExchangeV3MatrixPath(file, observed)) {
          unmatched.push(`${file}:${observed}`);
        }
      }
    }
    assert.deepEqual(unmatched, [], `Unmapped fixture paths: ${unmatched.join(", ")}`);
  });
});
