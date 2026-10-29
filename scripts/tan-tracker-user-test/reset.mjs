#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

if (process.env.TT_USER_TEST_RESET_CONFIRM?.trim().toLowerCase() !== "yes") {
  console.error("Refusing reset: set TT_USER_TEST_RESET_CONFIRM=yes");
  process.exit(2);
}

const res = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    path.join(repoRoot, "scripts/tan-tracker-user-test/reset-runner.ts"),
  ],
  { cwd: repoRoot, env: process.env, stdio: "inherit" },
);

process.exit(res.status ?? 1);
