import fs from "fs";
import path from "path";

const sourceDir = path.resolve("public");
const targetDir = path.resolve("dist/public");

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
  const from = path.join(sourceDir, entry.name);
  const to = path.join(targetDir, entry.name);
  if (entry.isDirectory()) {
    fs.cpSync(from, to, { recursive: true });
  } else {
    fs.copyFileSync(from, to);
  }
}
