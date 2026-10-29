import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { runProductionOmitDevStartupVerify } from "../../scripts/verify-production-omit-dev-startup.mjs";

describe("production npm ci --omit=dev packaging", () => {
  it("lists undici as a direct runtime dependency", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    assert.ok(pkg.dependencies?.undici, "dependencies.undici is required for tanbot-max/tls-fetch at runtime");
  });

  it("starts dist/server.js from an isolated prod-only node_modules tree", async () => {
    const dist = path.join(process.cwd(), "dist", "server.js");
    assert.ok(fs.existsSync(dist), "run npm run build before unit tests (dist/server.js missing)");

    const result = await runProductionOmitDevStartupVerify({ healthTimeoutMs: 60_000 });
    assert.equal(result.ok, true);
    const rel = path.relative(path.resolve(result.repoRoot), path.resolve(result.stageDir));
    assert.ok(
      rel.startsWith("..") || path.isAbsolute(rel),
      `stage dir must be outside repo (got relative path ${JSON.stringify(rel)})`,
    );
  });
});
