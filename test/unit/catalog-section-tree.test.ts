import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSectionTree, expandSectionCodes } from "../../src/catalog/section-tree";

describe("catalog section tree", () => {
  it("builds hierarchy and sorts by name", () => {
    const tree = buildSectionTree([
      { code: "b", name: "Beta", parent_code: "a" },
      { code: "a", name: "Alpha", parent_code: null },
      { code: "c", name: "Gamma", parent_code: "a" },
    ]);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.code, "a");
    assert.deepEqual(
      tree[0]!.children.map((node) => node.code),
      ["b", "c"],
    );
  });

  it("treats missing parent as root without throwing on cycles", () => {
    const tree = buildSectionTree([
      { code: "a", name: "A", parent_code: "b" },
      { code: "b", name: "B", parent_code: "a" },
      { code: "x", name: "X", parent_code: "missing" },
    ]);
    assert.ok(tree.length >= 1);
    const codes = new Set<string>();
    function walk(nodes: typeof tree): void {
      nodes.forEach((node) => {
        codes.add(node.code);
        walk(node.children);
      });
    }
    walk(tree);
    assert.equal(codes.size, 3);
  });

  it("expands descendants without duplicates", () => {
    const rows = [
      { code: "s1", name: "One", parent_code: null },
      { code: "s2", name: "Two", parent_code: "s1" },
      { code: "s3", name: "Three", parent_code: "s2" },
    ];
    const expanded = expandSectionCodes(rows, "s1");
    assert.deepEqual(expanded?.sort(), ["s1", "s2", "s3"]);
  });

  it("handles cyclic hierarchy safely", () => {
    const rows = [
      { code: "a", name: "A", parent_code: "b" },
      { code: "b", name: "B", parent_code: "a" },
    ];
    const expanded = expandSectionCodes(rows, "a");
    assert.ok(expanded?.includes("a"));
    assert.ok(expanded?.includes("b"));
    assert.equal(expanded?.length, 2);
  });
});
