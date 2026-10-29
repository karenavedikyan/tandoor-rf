#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${TT56_USER_TEST_ENV_FILE:-$ROOT/.env.tan-tracker-user-test.local}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy from .env.tan-tracker-user-test.example" >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

node --input-type=module -e "
import { assertTanTrackerUserTestDatabaseUrl } from './dist/shared/tan-tracker-user-test-env.js';
assertTanTrackerUserTestDatabaseUrl(process.env.DATABASE_URL, 'start-local');
if (process.env.NODE_ENV === 'production') throw new Error('Refusing production NODE_ENV');
if (process.env.TT_USER_TEST_ENV !== 'true') throw new Error('TT_USER_TEST_ENV must be true');
"

cd "$ROOT"
exec node dist/server.js
