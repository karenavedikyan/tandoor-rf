import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("clients v3 TOP field shortcut", () => {
  it("maps ТОП shortcut to typeGuid filled, not categoryGuid", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "public/clients-v3-field-rules.js"), "utf8");
    assert.match(source, /label:\s*"ТОП"[\s\S]{0,80}fieldId:\s*"typeGuid"[\s\S]{0,40}op:\s*"filled"/);
    assert.doesNotMatch(source, /label:\s*"ТОП"[\s\S]{0,80}fieldId:\s*"categoryGuid"/);
  });
});
