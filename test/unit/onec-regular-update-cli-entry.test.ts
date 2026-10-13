import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

const cliPath = path.join(process.cwd(), "src/cli/onec-regular-update.ts");

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "",
      ONEC_FTP_HOST: "",
    },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function parseStdout(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>;
}

describe("onec-regular-update CLI entrypoint", () => {
  it("forwards --dry-run to parser (mode dry_run in result)", () => {
    const { status, stdout } = runCli(["--dry-run"]);
    assert.equal(status, 1);
    const body = parseStdout(stdout);
    assert.equal(body.mode, "dry_run");
  });

  it("forwards --apply with fingerprint (mode apply, no production apply without DB)", () => {
    const { status, stdout } = runCli(["--apply", "--expected-fingerprint", "deadbeef"]);
    assert.equal(status, 1);
    const body = parseStdout(stdout);
    assert.equal(body.mode, "apply");
    assert.equal(body.errorCode, "CONFIG_ERROR");
  });

  it("rejects unknown CLI arguments via forwarded argv", () => {
    const { status, stdout } = runCli(["--totally-unknown"]);
    assert.equal(status, 1);
    const body = parseStdout(stdout);
    assert.equal(body.errorCode, "UNKNOWN_ARGUMENT");
  });

  it("rejects --apply without fingerprint via forwarded argv", () => {
    const { status, stdout } = runCli(["--apply"]);
    assert.equal(status, 1);
    const body = parseStdout(stdout);
    assert.equal(body.errorCode, "APPLY_REQUIRES_EXPECTED_FINGERPRINT");
  });
});
