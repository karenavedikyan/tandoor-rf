import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("list-legal-grouped TOP SQL", () => {
  it("uses nameType for grouped category_name column", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/clients/v3/list-legal-grouped.ts"),
      "utf8",
    );
    assert.match(source, /v3TypeNameSql\("h"\)/);
    assert.match(source, /v3TypeNameSql\("m"\)/);
    assert.doesNotMatch(source, /category_name[\s\S]{0,120}v3CategoryNameSql\("h"\)/);
  });
});
