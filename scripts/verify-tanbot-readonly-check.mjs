#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatVerificationSummary,
  runFullVerification,
} from "./lib/tanbot-readonly-verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const IMAGE_TAG = process.env.TANBOT_READONLY_IMAGE_TAG ?? "tanbot-readonly-check:local-verify";

try {
  const result = runFullVerification({ spawnSync, repoRoot: root, imageTag: IMAGE_TAG });
  console.log(formatVerificationSummary(result));
  if (result.node !== "PASS") {
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.log("VERIFY_TANBOT_READONLY: node=FAIL");
  process.exit(1);
}
