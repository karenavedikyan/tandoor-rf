#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  echo "TEST_DATABASE_URL is required for smoke-local.sh" >&2
  exit 1
fi

node --input-type=module -e "
import { assertTestDatabaseUrl } from './dist/shared/test-database-guard.js';
assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, 'smoke-local.sh');
"

export DATABASE_URL="${TEST_DATABASE_URL}"
export APP_ORIGIN="${APP_ORIGIN:-http://127.0.0.1:3456}"
export PORT="${PORT:-3456}"
export NODE_ENV="${NODE_ENV:-test}"
export PGSSLMODE="${PGSSLMODE:-disable}"

npm run migrate >/dev/null

node <<'NODE'
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const { execSync } = require("child_process");
const { assertTestDatabaseUrl } = require("./dist/shared/test-database-guard");

assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, "smoke-local.sh");

function redactSensitiveHeaders(output) {
  return output
    .split("\n")
    .map((line) =>
      /^set-cookie:/i.test(line) ? "set-cookie: [redacted]" : line,
    )
    .join("\n");
}

(async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const hash = await bcrypt.hash("AdminPass12345", 12);
  await pool.query("DELETE FROM users");
  await pool.query(
    "INSERT INTO users (email, password_hash, full_name, role, status) VALUES ($1, $2, $3, 'admin', 'active')",
    ["admin@test.local", hash, "Admin Test"],
  );
  await pool.end();

  const srv = spawn("node", ["dist/server.js"], {
    env: process.env,
    stdio: "inherit",
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log("=== GET /api/health ===");
  console.log(
    execSync(`curl -s -i http://127.0.0.1:${process.env.PORT}/api/health`).toString(),
  );

  console.log("=== GET /api/ready ===");
  console.log(
    execSync(`curl -s http://127.0.0.1:${process.env.PORT}/api/ready`).toString(),
  );

  console.log("=== POST /api/auth/login ===");
  console.log(
    redactSensitiveHeaders(
      execSync(
        `curl -s -i -X POST http://127.0.0.1:${process.env.PORT}/api/auth/login -H 'Origin: ${process.env.APP_ORIGIN}' -H 'Content-Type: application/json' -d '{"email":"admin@test.local","password":"AdminPass12345"}'`,
      ).toString(),
    ),
  );

  srv.kill("SIGTERM");
})();
NODE
