#!/usr/bin/env node
/**
 * Preflight: selected git commit must contain Dockerfile.tanbot-readonly-check.
 * Usage: node scripts/tanbot-readonly-packaging-preflight.mjs <PACKAGING_SHA>
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PACKAGING_DOCKERFILE_PATH,
  RUNTIME_STAGE1_SHA_EXAMPLE,
  packagingDockerfileExistsAtCommit,
} from "./lib/tanbot-readonly-verify.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = process.argv[2]?.trim();

if (!sha) {
  console.error("Usage: node scripts/tanbot-readonly-packaging-preflight.mjs <PACKAGING_SHA>");
  process.exit(2);
}

const check = packagingDockerfileExistsAtCommit(spawnSync, repoRoot, sha);
if (check.ok) {
  console.log(`PREFLIGHT_OK: ${PACKAGING_DOCKERFILE_PATH} exists at ${sha}`);
  process.exit(0);
}

console.error(`PREFLIGHT_FAIL: ${PACKAGING_DOCKERFILE_PATH} missing at ${sha} (git exit ${check.status})`);
console.error(
  `Note: runtime stage-1 acceptance (probe/transport only) may reference ${RUNTIME_STAGE1_SHA_EXAMPLE} without this file.`,
);
process.exit(1);
