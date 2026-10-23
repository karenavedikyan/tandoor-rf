import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const files = [
  "src/onec-sales/september-2026-one-shot/scope-pins.ts",
  "src/onec-sales/september-2026-one-shot/catalog-pin.ts",
  "src/onec-sales/september-2026-one-shot/schema-047-048.ts",
  "src/onec-sales/september-2026-one-shot/operator-guard.ts",
  "src/onec-sales/september-2026-one-shot/before-state-047-048.ts",
  "src/onec-sales/september-2026-one-shot/source-pins.ts",
  "src/onec-sales/september-2026-one-shot/preflight.ts",
  "src/onec-sales/september-2026-one-shot/backup.ts",
  "src/onec-sales/september-2026-one-shot/private-backup-publish.ts",
  "src/onec-sales/september-2026-one-shot/verify-047-048-metadata.ts",
  "src/onec-sales/september-2026-one-shot/execute-apply.ts",
  "src/cli/onec-v3-sales-september-2026-operator.ts",
];

const root = process.cwd();
const h = createHash("sha256");
for (const rel of files) {
  const bytes = await readFile(join(root, rel));
  h.update(rel);
  h.update("\0");
  h.update(bytes);
  h.update("\0");
}
console.log(h.digest("hex"));
