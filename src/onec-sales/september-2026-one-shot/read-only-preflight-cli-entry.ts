#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runSeptember2026ReadOnlyPreflight } from "./read-only-preflight-core";
import { parseSeptemberReadOnlyRuntimeConfig } from "./read-only-preflight-runtime-config";

function loadRuntimeConfigFromArgv(): unknown {
  const jsonFlag = process.argv.indexOf("--runtime-config-json");
  if (jsonFlag >= 0) {
    const path = process.argv[jsonFlag + 1];
    if (!path) {
      throw new Error("Missing path after --runtime-config-json");
    }
    return JSON.parse(readFileSync(path, "utf8"));
  }
  const inline = process.env.SEPTEMBER_2026_READ_ONLY_RUNTIME_CONFIG_JSON?.trim();
  if (inline) {
    return JSON.parse(inline);
  }
  throw new Error("Provide --runtime-config-json <path> or SEPTEMBER_2026_READ_ONLY_RUNTIME_CONFIG_JSON");
}

async function main(): Promise<void> {
  if (process.env.SEPTEMBER_2026_SYNTHETIC_HARNESS) {
    console.error(
      JSON.stringify({
        ok: false,
        code: "OPERATOR_BYPASS_FORBIDDEN",
        message: "Production read-only bundle does not accept SEPTEMBER_2026_SYNTHETIC_HARNESS.",
      }),
    );
    process.exit(1);
  }
  const parsed = parseSeptemberReadOnlyRuntimeConfig(loadRuntimeConfigFromArgv());
  if (!parsed.ok) {
    console.error(JSON.stringify({ ok: false, code: parsed.code, message: parsed.message }));
    process.exit(1);
  }
  const result = await runSeptember2026ReadOnlyPreflight({
    databaseUrl: parsed.config.databaseUrl,
    sources: parsed.buffers,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      code: "FATAL",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
