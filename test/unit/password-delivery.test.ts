import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  deliverTemporaryPasswordToChannel,
  verifyPasswordDeliveryChannel,
} from "../../src/access/password-delivery";

describe("password delivery", () => {
  let tempDir = "";

  after(async () => {
    if (tempDir) {
      await import("node:fs/promises").then((fs) => fs.rm(tempDir, { recursive: true, force: true }));
    }
  });

  it("refuses to overwrite an existing delivery file", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "tandoor-delivery-"));
    const target = path.join(tempDir, "password.txt");
    await writeFile(target, "existing", { mode: 0o600 });
    await assert.rejects(
      () => verifyPasswordDeliveryChannel({ kind: "file", filePath: target }),
      /already exists/,
    );
  });

  it("writes delivery file exclusively with mode 0600", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "tandoor-delivery-"));
    const target = path.join(tempDir, "new-password.txt");
    await verifyPasswordDeliveryChannel({ kind: "file", filePath: target });
    await deliverTemporaryPasswordToChannel("TempPass123!XY", { kind: "file", filePath: target });
    const content = await readFile(target, "utf8");
    assert.match(content, /TempPass123!XY/);
    await assert.rejects(
      () => verifyPasswordDeliveryChannel({ kind: "file", filePath: target }),
      /already exists/,
    );
  });
});
