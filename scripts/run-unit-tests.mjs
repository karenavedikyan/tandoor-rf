import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Expand recursively in Node, not the shell: ** is not portable across shells/Node versions.
function discover(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(dir, entry.name);
    return entry.isDirectory()
      ? discover(filename)
      : filename.endsWith(".test.ts") || filename.endsWith(".test.mjs")
        ? [filename]
        : [];
  });
}
const tests = ["test/server.test.ts", ...discover("test/unit").sort()];
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...tests], { stdio: "inherit", env: process.env });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
