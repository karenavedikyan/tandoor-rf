import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "operator-bundles/september-2026-read-only-preflight.cjs");

mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "src/onec-sales/september-2026-one-shot/read-only-preflight-cli-entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile,
  sourcemap: false,
  legalComments: "none",
  external: ["pg", "pg-native"],
  logLevel: "info",
});

console.log(outfile);
