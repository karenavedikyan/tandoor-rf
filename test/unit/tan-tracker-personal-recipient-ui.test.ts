import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const jsPath = path.join(process.cwd(), "public/tan-tracker/tan-tracker.js");
const cssPath = path.join(process.cwd(), "public/tan-tracker/tan-tracker-ui.css");
const externalApiPath = path.join(process.cwd(), "public/tan-tracker-external-api.js");

describe("tan-tracker personal recipient UI wiring", () => {
  it("uses TanTrackerExternal for external save, not TtExternalApi", () => {
    const js = fs.readFileSync(jsPath, "utf8");
    assert.doesNotMatch(js, /TtExternalApi/);
    assert.match(js, /TanTrackerExternal\?\.savePersonalRecipientLabel/);
    const ext = fs.readFileSync(externalApiPath, "utf8");
    assert.match(ext, /savePersonalRecipientLabel/);
  });

  it("mounts personal recipient sheet host inside tt-work scope", () => {
    const js = fs.readFileSync(jsPath, "utf8");
    assert.match(js, /getElementById\("tt-root"\)/);
    assert.match(js, /tt-personal-recipient-sheet-host/);
    assert.match(js, /workRoot\.appendChild\(sheetHost\)/);
  });

  it("detail hero recipient lines use recipientDisplayName", () => {
    const js = fs.readFileSync(jsPath, "utf8");
    assert.match(js, /tt-detail-task-receiver">Получатель:.*recipientDisplayName/);
  });

  it("restores focus via stable edit trigger selectors after sheet close", () => {
    const js = fs.readFileSync(jsPath, "utf8");
    assert.match(js, /personalRecipientEditFocusTarget/);
    assert.match(js, /focusPersonalRecipientEditTrigger/);
    assert.match(js, /data-tt="personal-recipient-edit"[\s\S]*data-order-id=/);
    assert.doesNotMatch(js, /personalRecipientEditFocusReturn/);
  });

  it("styles personal sheet with explicit backdrop and surface fallbacks", () => {
    const css = fs.readFileSync(cssPath, "utf8");
    assert.match(css, /\.tt-personal-recipient-sheet \.tt-filter-sheet-backdrop[\s\S]*background:rgba\(20,30,20/);
    assert.match(css, /\.tt-personal-recipient-sheet \.tt-filter-sheet-panel[\s\S]*background:var\(--surface/);
  });
});
