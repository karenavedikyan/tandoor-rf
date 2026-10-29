#!/usr/bin/env node
/**
 * Sandbox verification for isolated Tanbot readonly check packaging.
 * Uses synthetic token only; no real Telegram calls (disabled/local paths).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const SYNTH_TOKEN = "123456789:SYNTH_READONLY_PACK_TOKEN_MARKER_abcdefghijklmnopqrst";
const MARKER = "SYNTH_READONLY_PACK_TOKEN_MARKER";
const IMAGE_TAG = process.env.TANBOT_READONLY_IMAGE_TAG ?? "tanbot-readonly-check:local-verify";

function runNodeProbe(extraEnv, args = []) {
  const env = {
    ...process.env,
    ...extraEnv,
  };
  delete env.DATABASE_URL;
  delete env.TEST_DATABASE_URL;
  const res = spawnSync("node", ["dist/cli/tanbot-telegram-probe.js", ...args], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  return res;
}

function assertNoLeak(text) {
  if (text.includes(MARKER) || /123456789:/.test(text)) {
    throw new Error("Synthetic token leaked in output");
  }
}

function main() {
  const build = spawnSync("npm", ["run", "build"], { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }

  console.log("== node: disabled (no DATABASE_URL) ==");
  const disabled = runNodeProbe({ TANBOT_TELEGRAM_ENABLED: "false" });
  assertNoLeak(disabled.stdout + disabled.stderr);
  if (disabled.status !== 0) throw new Error(`disabled exit ${disabled.status}`);
  if (!disabled.stdout.includes('"status": "DISABLED"')) throw new Error("expected DISABLED");

  console.log("== node: local ok (synthetic token, no --live) ==");
  const local = runNodeProbe({
    TANBOT_TELEGRAM_ENABLED: "true",
    TANBOT_TELEGRAM_BOT_TOKEN: SYNTH_TOKEN,
  });
  assertNoLeak(local.stdout + local.stderr);
  if (local.status !== 0) throw new Error(`local exit ${local.status}`);
  if (!local.stdout.includes('"status": "LOCAL_OK"')) throw new Error("expected LOCAL_OK");

  console.log("== node: config error (enabled, empty token) ==");
  const cfg = runNodeProbe({
    TANBOT_TELEGRAM_ENABLED: "true",
    TANBOT_TELEGRAM_BOT_TOKEN: "",
  });
  assertNoLeak(cfg.stdout + cfg.stderr);
  if (cfg.status !== 2) throw new Error(`config error exit ${cfg.status}`);

  const dockerCheck = spawnSync("docker", ["version"], { encoding: "utf8" });
  if (dockerCheck.status !== 0) {
    console.log("Docker unavailable; node-only checks passed.");
    console.log("VERIFY_TANBOT_READONLY: PASS (node paths only)");
    return;
  }

  console.log("== docker build ==");
  const dockerBuild = spawnSync(
    "docker",
    ["build", "-f", "Dockerfile.tanbot-readonly-check", "-t", IMAGE_TAG, "."],
    { cwd: root, stdio: "inherit" },
  );
  if (dockerBuild.status !== 0) {
    throw new Error("docker build failed");
  }

  const envFile = path.join(os.tmpdir(), `tanbot-readonly-${process.pid}.env`);
  fs.writeFileSync(
    envFile,
    [
      "TANBOT_TELEGRAM_ENABLED=true",
      `TANBOT_TELEGRAM_BOT_TOKEN=${SYNTH_TOKEN}`,
      "TANBOT_TELEGRAM_EXPECTED_USERNAME=TANDOOR_IBOT",
    ].join("\n"),
    { mode: 0o600 },
  );

  try {
    console.log("== docker run: disabled default image env ==");
    const dDisabled = spawnSync(
      "docker",
      ["run", "--rm", IMAGE_TAG],
      { encoding: "utf8" },
    );
    assertNoLeak(dDisabled.stdout + dDisabled.stderr);
    if (dDisabled.status !== 0) throw new Error(`docker disabled exit ${dDisabled.status}`);

    console.log("== docker run: local via --env-file ==");
    const dLocal = spawnSync(
      "docker",
      ["run", "--rm", "--env-file", envFile, IMAGE_TAG],
      { encoding: "utf8" },
    );
    assertNoLeak(dLocal.stdout + dLocal.stderr);
    if (dLocal.status !== 0) throw new Error(`docker local exit ${dLocal.status}`);
    if (!dLocal.stdout.includes("LOCAL_OK")) throw new Error("docker expected LOCAL_OK");

    const history = spawnSync("docker", ["history", "--no-trunc", IMAGE_TAG], { encoding: "utf8" });
    if (history.stdout.includes(MARKER)) {
      throw new Error("token marker found in image history");
    }
  } finally {
    fs.unlinkSync(envFile);
  }

  console.log("VERIFY_TANBOT_READONLY: PASS (node + docker)");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
