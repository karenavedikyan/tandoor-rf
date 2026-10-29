import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SYNTH_TOKEN = "123456789:SYNTH_READONLY_PACK_TOKEN_MARKER_abcdefghijklmnopqrst";
export const MARKER = "SYNTH_READONLY_PACK_TOKEN_MARKER";
export const PACKAGING_DOCKERFILE_PATH = "Dockerfile.tanbot-readonly-check";
/** Accepted runtime stage-1 probe logic (no packaging Dockerfile). */
export const RUNTIME_STAGE1_SHA_EXAMPLE = "6fcb91805811782f56ff7c7468a4b83ae8ba1430";

export function parseProbeReport(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("probe stdout is empty");
  }
  let report;
  try {
    report = JSON.parse(trimmed);
  } catch {
    throw new Error("probe stdout is not valid JSON");
  }
  if (!report || typeof report !== "object" || typeof report.status !== "string") {
    throw new Error("probe JSON missing string status field");
  }
  return report;
}

export function assertNoLeak(text) {
  if (text.includes(MARKER) || /123456789:/.test(text)) {
    throw new Error("Synthetic token leaked in output");
  }
}

export function assertSpawnResult(label, res, { expectExit } = {}) {
  if (res.error) {
    throw new Error(`${label}: spawn failed (${res.error.message})`);
  }
  if (res.signal) {
    throw new Error(`${label}: terminated by signal ${res.signal}`);
  }
  if (expectExit !== undefined && res.status !== expectExit) {
    throw new Error(`${label}: exit code ${res.status}, expected ${expectExit}`);
  }
}

export function packagingDockerfileExistsAtCommit(spawnSync, repoRoot, commitSha) {
  const res = spawnSync("git", ["cat-file", "-e", `${commitSha}:${PACKAGING_DOCKERFILE_PATH}`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return {
    ok: res.status === 0 && !res.error && !res.signal,
    status: res.status,
    error: res.error?.message ?? null,
    signal: res.signal ?? null,
  };
}

export function runNodeProbe(spawnSync, repoRoot, extraEnv, args = []) {
  const env = { ...process.env, ...extraEnv };
  delete env.DATABASE_URL;
  delete env.TEST_DATABASE_URL;
  return spawnSync("node", ["dist/cli/tanbot-telegram-probe.js", ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
}

export function runNodeVerification(spawnSync, repoRoot, log = console.log) {
  log("== node: disabled (no DATABASE_URL) ==");
  const disabled = runNodeProbe(spawnSync, repoRoot, { TANBOT_TELEGRAM_ENABLED: "false" });
  assertSpawnResult("node disabled", disabled, { expectExit: 0 });
  assertNoLeak(disabled.stdout + disabled.stderr);
  if (parseProbeReport(disabled.stdout).status !== "DISABLED") {
    throw new Error("node disabled: expected status DISABLED");
  }

  log("== node: local ok (synthetic token, no --live) ==");
  const local = runNodeProbe(spawnSync, repoRoot, {
    TANBOT_TELEGRAM_ENABLED: "true",
    TANBOT_TELEGRAM_BOT_TOKEN: SYNTH_TOKEN,
  });
  assertSpawnResult("node local", local, { expectExit: 0 });
  assertNoLeak(local.stdout + local.stderr);
  if (parseProbeReport(local.stdout).status !== "LOCAL_OK") {
    throw new Error("node local: expected status LOCAL_OK");
  }

  log("== node: config error (enabled, empty token) ==");
  const cfg = runNodeProbe(spawnSync, repoRoot, {
    TANBOT_TELEGRAM_ENABLED: "true",
    TANBOT_TELEGRAM_BOT_TOKEN: "",
  });
  assertSpawnResult("node config error", cfg, { expectExit: 2 });
  assertNoLeak(cfg.stdout + cfg.stderr);
  if (parseProbeReport(cfg.stdout).status !== "CONFIG_ERROR") {
    throw new Error("node config error: expected status CONFIG_ERROR");
  }
}

function dockerDaemonReady(spawnSync) {
  const res = spawnSync("docker", ["info"], { encoding: "utf8" });
  if (res.error || res.signal) {
    return { ready: false, reason: res.error?.message ?? `signal ${res.signal}` };
  }
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || "").trim().slice(0, 200);
    return { ready: false, reason: detail || `docker info exit ${res.status}` };
  }
  return { ready: true, reason: null };
}

export function runDockerVerification(spawnSync, repoRoot, imageTag, log = console.log) {
  log("== docker build ==");
  const dockerBuild = spawnSync(
    "docker",
    ["build", "-f", PACKAGING_DOCKERFILE_PATH, "-t", imageTag, "."],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assertSpawnResult("docker build", dockerBuild, { expectExit: 0 });
  if ((dockerBuild.stderr || dockerBuild.stdout) && dockerBuild.status !== 0) {
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
    log("== docker run: disabled default image env ==");
    const dDisabled = spawnSync("docker", ["run", "--rm", imageTag], { encoding: "utf8" });
    assertSpawnResult("docker disabled", dDisabled, { expectExit: 0 });
    assertNoLeak(dDisabled.stdout + dDisabled.stderr);
    if (parseProbeReport(dDisabled.stdout).status !== "DISABLED") {
      throw new Error("docker disabled: expected status DISABLED");
    }

    log("== docker run: local via --env-file ==");
    const dLocal = spawnSync(
      "docker",
      ["run", "--rm", "--env-file", envFile, imageTag],
      { encoding: "utf8" },
    );
    assertSpawnResult("docker local", dLocal, { expectExit: 0 });
    assertNoLeak(dLocal.stdout + dLocal.stderr);
    if (parseProbeReport(dLocal.stdout).status !== "LOCAL_OK") {
      throw new Error("docker local: expected status LOCAL_OK");
    }

    log("== docker history (no token marker) ==");
    const history = spawnSync("docker", ["history", "--no-trunc", imageTag], { encoding: "utf8" });
    assertSpawnResult("docker history", history, { expectExit: 0 });
    if (history.stdout.includes(MARKER) || (history.stderr && history.stderr.includes(MARKER))) {
      throw new Error("token marker found in image history");
    }
  } finally {
    fs.unlinkSync(envFile);
  }
}

/**
 * @returns {{ node: "PASS"|"FAIL", docker: "PASS"|"FAIL"|"NOT_RUN", dockerReason?: string }}
 */
export function runFullVerification(deps) {
  const {
    spawnSync,
    repoRoot,
    imageTag,
    log = console.log,
    skipBuild = false,
    skipDocker = false,
  } = deps;

  if (!skipBuild) {
    const build = spawnSync("npm", ["run", "build"], { cwd: repoRoot, encoding: "utf8" });
    assertSpawnResult("npm run build", build, { expectExit: 0 });
  }

  runNodeVerification(spawnSync, repoRoot, log);

  if (skipDocker) {
    return { node: "PASS", docker: "NOT_RUN", dockerReason: "skipDocker flag" };
  }

  const daemon = dockerDaemonReady(spawnSync);
  if (!daemon.ready) {
    return { node: "PASS", docker: "NOT_RUN", dockerReason: daemon.reason ?? "docker unavailable" };
  }

  runDockerVerification(spawnSync, repoRoot, imageTag, log);
  return { node: "PASS", docker: "PASS" };
}

export function formatVerificationSummary(result) {
  if (result.node !== "PASS") {
    return "VERIFY_TANBOT_READONLY: node=FAIL";
  }
  if (result.docker === "PASS") {
    return "VERIFY_TANBOT_READONLY: node=PASS docker=PASS";
  }
  if (result.docker === "NOT_RUN") {
    const reason = result.dockerReason ? ` reason=${result.dockerReason}` : "";
    return `VERIFY_TANBOT_READONLY: node=PASS docker=NOT_RUN${reason}`;
  }
  return "VERIFY_TANBOT_READONLY: node=PASS docker=FAIL";
}
