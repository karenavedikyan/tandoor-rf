import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("external shell code dock (inline, no keyboard overlap)", () => {
  it("uses inline dock class in code view for external shell", () => {
    const js = readFileSync(join(root, "public/tan-tracker/tan-tracker.js"), "utf8");
    assert.match(js, /tt-code-dock--inline/);
    assert.match(js, /isExternalShell\(\) \? " tt-code-dock--inline"/);
    assert.match(js, /function codeEntryUsesDemoHelpers/);
    assert.match(js, /!TT_LK && !isExternalShell\(\) && !window\.__TT_EXTERNAL_PERSON__/);
  });

  it("CSS hides feedback widget and FAB on external shell", () => {
    const css = readFileSync(join(root, "public/tan-tracker/tan-tracker.css"), "utf8");
    assert.match(css, /\.tt-external-shell #af-required-reminder/);
    assert.match(css, /\.tt-external-shell \.tt-fab/);
    assert.match(css, /body\.tt-external-shell\.tt-code-view \.tt-code-dock/);
  });
});
