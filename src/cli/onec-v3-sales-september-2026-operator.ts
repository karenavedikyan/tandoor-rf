import { runSeptember2026ReadOnlyPreflight } from "../onec-sales/september-2026-one-shot/read-only-preflight-core";
import { parseSeptemberReadOnlyRuntimeConfig } from "../onec-sales/september-2026-one-shot/read-only-preflight-runtime-config";
import { readFileSync } from "node:fs";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--code-bundle-sha")) {
    console.error(
      JSON.stringify({
        ok: false,
        code: "USE_READ_ONLY_BUNDLE_SHA",
        message: "Use npm run september-2026-read-only-preflight:sha for executable .cjs SHA.",
      }),
    );
    process.exit(1);
  }
  const preflight = args.includes("--preflight") || args.length === 0;
  if (!preflight) {
    console.error(
      JSON.stringify({
        ok: false,
        code: "WRITE_OPERATIONS_NOT_IN_THIS_CLI",
        message:
          "Backup/apply/rollback are separate operator entrypoints in code; require SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF and are not invoked from this default CLI.",
      }),
    );
    process.exit(1);
  }
  const configPath = process.env.SEPTEMBER_2026_READ_ONLY_RUNTIME_CONFIG_PATH?.trim();
  const inline = process.env.SEPTEMBER_2026_READ_ONLY_RUNTIME_CONFIG_JSON?.trim();
  let raw: unknown;
  if (configPath) {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } else if (inline) {
    raw = JSON.parse(inline);
  } else {
    console.error(
      JSON.stringify({
        ok: false,
        code: "RUNTIME_CONFIG_REQUIRED",
        message:
          "Set SEPTEMBER_2026_READ_ONLY_RUNTIME_CONFIG_JSON or SEPTEMBER_2026_READ_ONLY_RUNTIME_CONFIG_PATH with all four in-memory FTP sources (contentBase64).",
      }),
    );
    process.exit(1);
  }
  const parsed = parseSeptemberReadOnlyRuntimeConfig(raw);
  if (!parsed.ok) {
    console.error(JSON.stringify({ ok: false, code: parsed.code, message: parsed.message }));
    process.exit(1);
  }
  const result = await runSeptember2026ReadOnlyPreflight({
    databaseUrl: parsed.config.databaseUrl,
    sources: parsed.buffers,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: "FATAL", message: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
