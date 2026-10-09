#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DEBIAN_FRONTEND=noninteractive

if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y postgresql postgresql-contrib
fi

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
    echo "Created database ${db_name}."
  fi
done

npm ci
npx playwright install --with-deps chromium
npm run build

sudo service postgresql stop
