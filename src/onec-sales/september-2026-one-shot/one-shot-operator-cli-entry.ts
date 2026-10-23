#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runSeptember2026ReadOnlyPreflight } from "./read-only-preflight-core";
import { parseSeptemberReadOnlyRuntimeConfig } from "./read-only-preflight-runtime-config";
import { runSeptember2026OneShotApply } from "./one-shot-apply-core";
import { EXPECTED_OPERATOR_DATA_SCOPE_SHA256 } from "./scope-pins";

async function main(): Promise<void> {
  if (process.env.SEPTEMBER_2026_SYNTHETIC_HARNESS) {
    fail("OPERATOR_BYPASS_FORBIDDEN", "SYNTHETIC_HARNESS not accepted.");
  }
  const mode = process.argv.includes("--apply") ? "apply" : "read-only-preflight";
  if (mode === "apply") {
    const scopePath = process.env.SEPTEMBER_2026_OPERATOR_DATA_SCOPE_PATH?.trim();
    const grant = process.env.SEPTEMBER_2026_APPLY_GRANT_REF?.trim();
    const backupReceipt = process.env.SEPTEMBER_2026_BACKUP_RECEIPT_SHA256?.trim() ?? null;
    const backupReceiptPath = process.env.SEPTEMBER_2026_BACKUP_RECEIPT_PATH?.trim();
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!scopePath || !grant || !databaseUrl) {
      fail("APPLY_CONFIG_INCOMPLETE", "DATABASE_URL, SEPTEMBER_2026_OPERATOR_DATA_SCOPE_PATH, SEPTEMBER_2026_APPLY_GRANT_REF required.");
    }
    const result = await runSeptember2026OneShotApply({
      databaseUrl,
      operatorDataScopePath: scopePath,
      operatorDataScopeSha256: EXPECTED_OPERATOR_DATA_SCOPE_SHA256,
      applyGrantRef: grant,
      backupReceiptSha256: backupReceipt,
      backupReceiptFilePath: backupReceiptPath,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }
  const configPath = process.env.SEPTEMBER_2026_READ_ONLY_RUNTIME_CONFIG_PATH?.trim();
  const inline = process.env.SEPTEMBER_2026_READ_ONLY_RUNTIME_CONFIG_JSON?.trim();
  let raw: unknown;
  if (process.argv.includes("--runtime-config-json")) {
    const idx = process.argv.indexOf("--runtime-config-json");
    const path = process.argv[idx + 1];
    if (!path) fail("RUNTIME_CONFIG_MISSING", "Path required after --runtime-config-json");
    raw = JSON.parse(readFileSync(path, "utf8"));
  } else if (configPath) {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } else if (inline) {
    raw = JSON.parse(inline);
  } else {
    fail("RUNTIME_CONFIG_REQUIRED", "Read-only mode requires runtime config JSON.");
  }
  const parsed = parseSeptemberReadOnlyRuntimeConfig(raw);
  if (!parsed.ok) fail(parsed.code, parsed.message);
  const result = await runSeptember2026ReadOnlyPreflight({
    databaseUrl: parsed.config.databaseUrl,
    sources: parsed.buffers,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

function fail(code: string, message: string): never {
  console.error(JSON.stringify({ ok: false, code, message }));
  process.exit(1);
}

main().catch((error) => {
  fail("FATAL", error instanceof Error ? error.message : String(error));
});
