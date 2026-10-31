import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("tan-tracker mobile dock hero observer", () => {
  it("observes only main-content hero outside the mobile dock", () => {
    const js = readFileSync("public/tan-tracker/tan-tracker.js", "utf8");
    assert.match(js, /function findDetailMobileDockHero\(root\)/);
    assert.match(js, /dock\.contains\(el\)/);
    assert.doesNotMatch(js, /document\.querySelector\("\[data-tt-detail-hero-primary\]"\)/);
  });
});
