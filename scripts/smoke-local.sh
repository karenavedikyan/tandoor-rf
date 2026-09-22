#!/usr/bin/env bash
set -euo pipefail

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test}"
export APP_ORIGIN="${APP_ORIGIN:-http://127.0.0.1:3456}"
export PORT="${PORT:-3456}"

npm run migrate >/dev/null

node <<'NODE'
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const { execSync } = require("child_process");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
  console.log(execSync(`curl -s -i http://127.0.0.1:${process.env.PORT}/api/health`).toString());

  console.log("=== GET /api/ready ===");
  console.log(execSync(`curl -s http://127.0.0.1:${process.env.PORT}/api/ready`).toString());

  console.log("=== POST /api/auth/login ===");
  console.log(
    execSync(
      `curl -s -i -X POST http://127.0.0.1:${process.env.PORT}/api/auth/login -H 'Origin: ${process.env.APP_ORIGIN}' -H 'Content-Type: application/json' -d '{"email":"admin@test.local","password":"AdminPass12345"}'`,
    ).toString(),
  );

  srv.kill("SIGTERM");
})();
NODE
