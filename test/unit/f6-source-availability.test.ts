import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("F6 source availability fixture", () => {
  it("recovered-exchange-structure.json has expected historical metadata", () => {
    const path = join(process.cwd(), "test/fixtures/onec-clients/recovered-exchange-structure.json");
    assert.ok(existsSync(path));
    const meta = JSON.parse(readFileSync(path, "utf8")) as {
      sha256: string;
      clients: number;
      outlets: number;
      historicalSnapshot: boolean;
      fields: Array<{ path: string }>;
    };
    assert.equal(meta.sha256, "b439063b1602743ab1df56ee6390ba9d3cc64dce7cdc24763c3d4d7176c74b74");
    assert.equal(meta.clients, 3087);
    assert.equal(meta.outlets, 473);
    assert.equal(meta.historicalSnapshot, true);
    const paths = new Set(meta.fields.map((f) => f.path));
    assert.ok(paths.has("$[].Код"));
    assert.ok(paths.has("$[].Оптовик_Топ150"));
  });
});
