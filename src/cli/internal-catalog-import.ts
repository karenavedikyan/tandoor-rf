import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Pool } from "pg";
import { getDatabaseUrl } from "../config";
import { createPgPoolOptions } from "../config/pg-ssl";
import { MAX_JSON_BYTES, parseProductsJson } from "../internal-catalog/model";
import { importSnapshot } from "../internal-catalog/repository";
import { stat } from "node:fs/promises";

async function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  const allowed = new Set(["--apply", "--dry-run", "--expected-sha256"]);
  if (!file || file.startsWith("--")) throw new Error("FILE_REQUIRED");
  let apply = false, expected = "";
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (!allowed.has(arg)) throw new Error("INVALID_ARGUMENT");
    if (arg === "--apply") apply = true;
    if (arg === "--expected-sha256") {
      expected = args[++i] ?? "";
      if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error("INVALID_EXPECTED_SHA256");
    }
  }
  if (args.includes("--apply") && args.includes("--dry-run")) throw new Error("CONFLICTING_MODES");
  if (apply && !expected) throw new Error("EXPECTED_SHA256_REQUIRED");
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX_JSON_BYTES) throw new Error("INVALID_FILE_SIZE");
  const parsed = parseProductsJson(await readFile(file));
  if (expected && expected !== parsed.sha256) throw new Error("HASH_MISMATCH");
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry_run", sha256: parsed.sha256, summary: parsed.summary }));
  if (!apply) return; // Does not open or require a database in dry-run mode.
  const url = getDatabaseUrl();
  if (!url) throw new Error("DATABASE_URL_REQUIRED");
  const pool = new Pool({ ...createPgPoolOptions(url), max: 1 });
  try { console.log(JSON.stringify(await importSnapshot(pool, parsed, basename(file), expected))); }
  finally { await pool.end(); }
}
main().catch(error => {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "IMPORT_FAILED";
  console.error(JSON.stringify({ error: code }));
  process.exitCode = 1;
});
