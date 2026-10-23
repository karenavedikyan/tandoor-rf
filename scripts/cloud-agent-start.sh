#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

sudo service postgresql start
ready=0
for _ in $(seq 1 60); do
  if pg_isready -q; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "PostgreSQL did not become ready" >&2
  exit 1
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER USER postgres WITH PASSWORD 'postgres';"
for db_name in tandoor_rf_dev tandoor_rf_test; do
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'" | grep -q 1; then
    sudo -u postgres createdb "${db_name}"
  fi
done

export PGSSLMODE=disable
export NODE_ENV=development
export ONEC_FTP_ENABLED=false
export BITRIX24_ENABLED=false
export BITRIX24_CACHE_PUBLISH_ENABLED=false
export BITRIX24_WEBHOOK_URL=
unset ONEC_FTP_PASSWORD || true

export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_dev"
node dist/cli/migrate.js
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test"
node dist/cli/migrate.js

export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_dev"
if [[ -f dist/cli/seed-dev-demo.js ]]; then
  node dist/cli/seed-dev-demo.js
fi

export APP_ORIGIN="${APP_ORIGIN:-http://127.0.0.1:3000}"
export PORT="${PORT:-3000}"
export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test"
exec node dist/server.js
