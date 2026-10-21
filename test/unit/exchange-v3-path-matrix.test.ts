import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { V3_CLIENT_OTHER_INVENTORY_KEYS } from "../../src/onec-exchange-v3/other-fields";
import {
  EXCHANGE_V3_PATH_MATRIX,
  matchExchangeV3MatrixPath,
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
