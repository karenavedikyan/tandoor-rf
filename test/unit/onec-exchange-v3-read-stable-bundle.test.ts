import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { readStableV3Bundle } from "../../src/onec-exchange-v3/read-stable-bundle";
import { V3_BUNDLE_FILES } from "../../src/onec-exchange-v3/constants";

async function writeMinimalBundle(dir: string): Promise<void> {
  await fs.writeFile(path.join(dir, V3_BUNDLE_FILES.holdings), '{"holdings":[]}\n');
  await fs.writeFile(path.join(dir, V3_BUNDLE_FILES.clients), '{"clients":[]}\n');
  await fs.writeFile(path.join(dir, V3_BUNDLE_FILES.retail), '{"retail":[]}\n');
  await fs.writeFile(path.join(dir, V3_BUNDLE_FILES.employees), '{"employees":[]}\n');
}

describe("exchange v3 read-stable-bundle", () => {
  let tempRoot = "";

  after(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts stable four-file bundle after two full passes", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "v3-bundle-stable-"));
    await writeMinimalBundle(tempRoot);
    const result = await readStableV3Bundle({ bundleDir: tempRoot });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.fileMeta.length, 4);
      assert.ok(result.bundleSha256[V3_BUNDLE_FILES.holdings]);
    }
  });

  it("rejects when first file changes while reading the last file in pass 1", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "v3-bundle-unstable-"));
    await writeMinimalBundle(tempRoot);
    const holdingsPath = path.join(tempRoot, V3_BUNDLE_FILES.holdings);
    const result = await readStableV3Bundle({
      bundleDir: tempRoot,
      testHooks: {
        afterFileRead: async ({ fileName, pass }) => {
          if (pass === 1 && fileName === V3_BUNDLE_FILES.employees) {
            await fs.writeFile(holdingsPath, '{"holdings":[{"mutated":true}]}\n');
          }
        },
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "BUNDLE_UNSTABLE");
    }
  });
});
