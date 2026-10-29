#!/usr/bin/env node
/**
 * Regression: production image installs only runtime deps (npm ci --omit=dev).
 * Stages outside the repository (OS temp), installs prod deps only, starts dist/server.js,
 * expects GET /api/health → 200. Fails if a runtime import is missing from prod dependencies
 * or if a parent node_modules could satisfy imports instead of the staged tree.
 *
 * Usage: npm run build && node scripts/verify-production-omit-dev-startup.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveReal(dir) {
  return fs.realpathSync(dir);
}

/** Stage directory must not live under the repo (avoids walking up into repo/node_modules). */
export function assertProductionStageIsolation(stageDir, repo) {
  const stage = resolveReal(stageDir);
  const repoRootResolved = resolveReal(repo);
  const rel = path.relative(repoRootResolved, stage);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error(
      `Production stage must be outside the repository (stage=${stage}, repo=${repoRootResolved}).`,
    );
  }

  let cursor = path.dirname(stage);
  for (;;) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    const foreignNm = path.join(cursor, "node_modules");
    if (fs.existsSync(foreignNm)) {
      throw new Error(
        `Parent node_modules on module resolution path would mask missing prod deps: ${foreignNm}`,
      );
    }
    cursor = parent;
  }
}

function createIsolatedStageDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tandoor-prod-omit-dev-"));
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

function copyProductionArtifacts(stageDir, repo) {
  fs.cpSync(path.join(repo, "package.json"), path.join(stageDir, "package.json"));
  fs.cpSync(path.join(repo, "package-lock.json"), path.join(stageDir, "package-lock.json"));
  fs.cpSync(path.join(repo, "dist"), path.join(stageDir, "dist"), { recursive: true });
  const serverDir = path.join(repo, "server");
  if (fs.existsSync(serverDir)) {
    fs.cpSync(serverDir, path.join(stageDir, "server"), { recursive: true });
  }
}

function npmCiOmitDev(stageDir) {
  const env = { ...process.env };
  delete env.NODE_PATH;
  const result = spawnSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: stageDir,
    env,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `npm ci --omit=dev failed (exit ${result.status}):\n${result.stderr || result.stdout}`,
    );
  }
}

/** Same resolution path as dist/tanbot-max/tls-fetch.js — must stay inside staged node_modules. */
function assertRuntimeResolveFromStagedTree(stageDir, nodeBin) {
  const probe = `
    const path = require("path");
    const cwd = process.cwd();
    const entryDir = path.join(cwd, "dist", "tanbot-max");
    let resolved;
    try {
      resolved = require.resolve("undici", { paths: [entryDir] });
    } catch (err) {
      console.error(err && err.message ? err.message : err);
      process.exit(2);
    }
    const nmRoot = path.join(cwd, "node_modules") + path.sep;
    if (!resolved.startsWith(nmRoot)) {
      console.error("resolve left staged node_modules:", resolved);
      process.exit(3);
    }
  `;
  const env = { PATH: process.env.PATH ?? "" };
  delete env.NODE_PATH;
  const result = spawnSync(nodeBin, ["-e", probe], {
    cwd: stageDir,
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Runtime resolve probe failed (exit ${result.status}): ${result.stderr || result.stdout}`,
    );
  }
}

function serverChildEnv(port) {
  return {
    NODE_ENV: "production",
    PORT: String(port),
    TT_ATTACHMENTS_BACKEND: "postgres",
    TANBOT_TELEGRAM_ENABLED: "false",
    TANBOT_TELEGRAM_OUTBOX_WORKER_ENABLED: "false",
    TANBOT_MAX_ENABLED: "false",
    TANBOT_MAX_OUTBOX_WORKER_ENABLED: "false",
    ONEC_NIGHTLY_EXCHANGE_ENABLED: "false",
    ONEC_FTP_ENABLED: "false",
    BITRIX24_ENABLED: "false",
    PATH: process.env.PATH ?? "",
  };
}

async function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) {
        const body = await res.json();
        if (body?.status === "ok") return;
        lastError = `unexpected body: ${JSON.stringify(body)}`;
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for /api/health: ${lastError}`);
}

export async function runProductionOmitDevStartupVerify(options = {}) {
  const repo = options.repoRoot ?? repoRoot;
  const dist = path.join(repo, "dist", "server.js");
  if (!fs.existsSync(dist)) {
    throw new Error("dist/server.js missing — run npm run build first.");
  }

  const stageDir = createIsolatedStageDir();
  assertProductionStageIsolation(stageDir, repo);
  const port = options.port ?? (await pickFreePort());

  let child;
  try {
    copyProductionArtifacts(stageDir, repo);
    npmCiOmitDev(stageDir);
    const nodeBin = options.nodeBin ?? process.execPath;
    assertRuntimeResolveFromStagedTree(stageDir, nodeBin);

    child = spawn(nodeBin, ["dist/server.js"], {
      cwd: stageDir,
      env: serverChildEnv(port),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let bootLog = "";
    child.stdout?.on("data", (chunk) => {
      bootLog += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      bootLog += chunk.toString();
    });

    const exitedEarly = await Promise.race([
      new Promise((resolve) => {
        child.on("exit", (code, signal) => resolve({ code, signal }));
      }),
      waitForHealth(port, options.healthTimeoutMs ?? 45_000).then(() => null),
    ]);

    if (exitedEarly) {
      throw new Error(
        `dist/server.js exited before health (code=${exitedEarly.code}, signal=${exitedEarly.signal}):\n${bootLog.slice(-4000)}`,
      );
    }

    assertProductionStageIsolation(stageDir, repo);
    return { ok: true, stageDir, port, repoRoot: repo };
  } finally {
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      if (!child.killed) child.kill("SIGKILL");
    }
    if (!options.keepStageDir) {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  }
}

const scriptPath = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === scriptPath) {
  runProductionOmitDevStartupVerify()
    .then(() => {
      console.log("PRODUCTION_OMIT_DEV_STARTUP_OK");
      process.exit(0);
    })
    .catch((err) => {
      console.error(String(err?.message ?? err));
      process.exit(1);
    });
}
