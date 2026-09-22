#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${TEST_DB_NAME:-tandoor_rf_test}"

if command -v psql >/dev/null 2>&1; then
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    echo "Database ${DB_NAME} already exists."
  else
    sudo -u postgres createdb "${DB_NAME}"
    echo "Created database ${DB_NAME}."
  fi
else
  echo "psql is not installed. Install PostgreSQL locally before running integration tests." >&2
  exit 1
fi

echo "Suggested TEST_DATABASE_URL:"
echo "postgresql://postgres:postgres@127.0.0.1:5432/${DB_NAME}"
