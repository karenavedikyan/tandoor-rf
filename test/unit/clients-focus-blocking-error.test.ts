import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("clients focus blocking error shell", () => {
  it("exposes renderBlockingError with retry/exit controls", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "public/clients-lktandoor-focus.js"), "utf8");
    assert.match(source, /renderBlockingError/);
    assert.match(source, /data-testid="v3-focus-error"/);
    assert.match(source, /id="v3-focus-exit"/);
    assert.match(source, /id="v3-focus-retry-load"/);
  });

  it("routes showResultsState through focus error in fullscreen mode", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "public/clients.js"), "utf8");
    assert.match(source, /renderBlockingError/);
    assert.match(source, /x14-focus-mode/);
  });
});
