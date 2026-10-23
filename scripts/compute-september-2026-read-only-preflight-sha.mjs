import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = join(root, "operator-bundles/september-2026-read-only-preflight.cjs");
const bytes = readFileSync(bundlePath);
const sha = createHash("sha256").update(bytes).digest("hex");
console.log(sha);
