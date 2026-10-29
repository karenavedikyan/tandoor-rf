#!/usr/bin/env bash
set -euo pipefail

DB_NAME="tandoor_rf_tt56_user_test"
DB_USER="${TT56_USER_TEST_DB_USER:-tt56_user_test}"
DB_PASSWORD="${TT56_USER_TEST_DB_PASSWORD:-}"

if [[ -z "${DB_PASSWORD}" ]]; then
  echo "Set TT56_USER_TEST_DB_PASSWORD for init-db (not stored in git)." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required." >&2
  exit 1
fi

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"

echo "INIT_DB_OK: ${DB_NAME} (user ${DB_USER})"
