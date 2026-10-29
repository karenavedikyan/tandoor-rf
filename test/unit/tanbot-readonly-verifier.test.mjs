import assert from "node:assert/strict";
import { spawnSync as realSpawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  MARKER,
  PACKAGING_DOCKERFILE_PATH,
  RUNTIME_STAGE1_SHA_EXAMPLE,
  formatVerificationSummary,
  packagingDockerfileExistsAtCommit,
  parseProbeReport,
  runDockerVerification,
  runFullVerification,
} from "../../scripts/lib/tanbot-readonly-verify.mjs";

function makeProbeSpawnSync() {
  let probeCall = 0;
  return (cmd, args) => {
    if (cmd === "npm") return { status: 0 };
    if (cmd === "node") {
      probeCall += 1;
      if (probeCall === 1) {
        return { status: 0, stdout: JSON.stringify({ status: "DISABLED" }), stderr: "" };
      }
      if (probeCall === 2) {
        return { status: 0, stdout: JSON.stringify({ status: "LOCAL_OK" }), stderr: "" };
      }
      return { status: 2, stdout: JSON.stringify({ status: "CONFIG_ERROR" }), stderr: "" };
    }
    return realSpawnSync(cmd, args, { encoding: "utf8" });
  };
}

describe("tanbot readonly verifier library", () => {
  it("parseProbeReport rejects malformed and empty JSON", () => {
    assert.throws(() => parseProbeReport(""), /empty/);
    assert.throws(() => parseProbeReport("not-json"), /not valid JSON/);
    assert.throws(() => parseProbeReport("{}"), /missing string status/);
    assert.throws(() => parseProbeReport('{"status":1}'), /missing string status/);
    assert.equal(parseProbeReport('{"status":"DISABLED"}').status, "DISABLED");
  });

  it("packaging preflight: runtime-only SHA lacks Dockerfile", () => {
    const runtimeOnly = packagingDockerfileExistsAtCommit(
      realSpawnSync,
      process.cwd(),
      RUNTIME_STAGE1_SHA_EXAMPLE,
    );
    assert.equal(runtimeOnly.ok, false);
  });

  it("packaging preflight: current HEAD contains packaging Dockerfile", () => {
    const head = realSpawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    const atHead = packagingDockerfileExistsAtCommit(realSpawnSync, process.cwd(), head);
    assert.equal(atHead.ok, true, `expected ${PACKAGING_DOCKERFILE_PATH} at HEAD ${head}`);
  });

  it("runFullVerification: docker history command failure fails verification", () => {
    let dockerRuns = 0;
    const probeSpawn = makeProbeSpawnSync();
    const spawnSync = (cmd, args) => {
      if (cmd === "npm") return { status: 0 };
      if (cmd === "node") return probeSpawn(cmd, args);
      const key = [cmd, ...(args ?? [])].join(" ");
      if (key.startsWith("docker info")) return { status: 0, stdout: "", stderr: "" };
      if (key.startsWith("docker build")) return { status: 0, stdout: "", stderr: "" };
      if (key.startsWith("docker run")) {
        dockerRuns += 1;
        const status = dockerRuns === 1 ? "DISABLED" : "LOCAL_OK";
        return { status: 0, stdout: JSON.stringify({ status }), stderr: "" };
      }
      if (key.startsWith("docker history")) {
        return { status: 1, stdout: "", stderr: "history failed" };
      }
      throw new Error(`unexpected: ${key}`);
    };

    assert.throws(
      () =>
        runFullVerification({
          spawnSync,
          repoRoot: process.cwd(),
          imageTag: "test:tag",
          skipBuild: true,
          log: () => {},
        }),
      /docker history/,
    );
  });

  it("runDockerVerification: wrong DISABLED status fails", () => {
    const spawnSync = (cmd, args) => {
      const key = [cmd, ...(args ?? [])].join(" ");
      if (key.startsWith("docker build")) return { status: 0, stdout: "", stderr: "" };
      if (key.startsWith("docker run")) {
        return { status: 0, stdout: JSON.stringify({ status: "SUCCESS" }), stderr: "" };
      }
      throw new Error(key);
    };
    assert.throws(
      () => runDockerVerification(spawnSync, process.cwd(), "x:y", () => {}),
      /expected status DISABLED/,
    );
  });

  it("runDockerVerification: NOT_LOCAL_OK does not pass as LOCAL_OK", () => {
    let runs = 0;
    const spawnSync = (cmd, args) => {
      const key = [cmd, ...(args ?? [])].join(" ");
      if (key.startsWith("docker build")) return { status: 0, stdout: "", stderr: "" };
      if (key.startsWith("docker run")) {
        runs += 1;
        if (runs === 1) {
          return { status: 0, stdout: JSON.stringify({ status: "DISABLED" }), stderr: "" };
        }
        return { status: 0, stdout: JSON.stringify({ status: "NOT_LOCAL_OK" }), stderr: "" };
      }
      if (key.startsWith("docker history")) return { status: 0, stdout: "clean", stderr: "" };
      throw new Error(key);
    };
    assert.throws(
      () => runDockerVerification(spawnSync, process.cwd(), "x:y", () => {}),
      /expected status LOCAL_OK/,
    );
  });

  it("runDockerVerification: marker in history fails", () => {
    let runs = 0;
    const spawnSync = (cmd, args) => {
      const key = [cmd, ...(args ?? [])].join(" ");
      if (key.startsWith("docker build")) return { status: 0, stdout: "", stderr: "" };
      if (key.startsWith("docker run")) {
        runs += 1;
        const status = runs === 1 ? "DISABLED" : "LOCAL_OK";
        return { status: 0, stdout: JSON.stringify({ status }), stderr: "" };
      }
      if (key.startsWith("docker history")) {
        return { status: 0, stdout: `layer ${MARKER}`, stderr: "" };
      }
      throw new Error(key);
    };
    assert.throws(
      () => runDockerVerification(spawnSync, process.cwd(), "x:y", () => {}),
      /marker found/,
    );
  });

  it("formatVerificationSummary distinguishes NOT_RUN from docker PASS", () => {
    const notRun = formatVerificationSummary({
      node: "PASS",
      docker: "NOT_RUN",
      dockerReason: "no daemon",
    });
    assert.match(notRun, /docker=NOT_RUN/);
    assert.doesNotMatch(notRun, /docker=PASS/);
    assert.equal(
      formatVerificationSummary({ node: "PASS", docker: "PASS" }),
      "VERIFY_TANBOT_READONLY: node=PASS docker=PASS",
    );
  });

  it("runFullVerification with skipDocker reports NOT_RUN", () => {
    const result = runFullVerification({
      spawnSync: makeProbeSpawnSync(),
      repoRoot: process.cwd(),
      imageTag: "t",
      skipBuild: true,
      skipDocker: true,
      log: () => {},
    });
    assert.equal(result.docker, "NOT_RUN");
    assert.equal(result.node, "PASS");
  });
});
