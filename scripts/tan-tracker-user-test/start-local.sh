#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${TT56_USER_TEST_ENV_FILE:-$ROOT/.env.tan-tracker-user-test.local}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy from .env.tan-tracker-user-test.example" >&2
  exit 2
fi

# Fail-closed: do not inherit production/integration flags from the parent shell.
cd "$ROOT"
node --env-file="$ENV_FILE" --input-type=module -e "
import { assertTanTrackerUserTestStartup } from './dist/shared/tan-tracker-user-test-runtime.js';
if (process.env.TT_USER_TEST_ENV !== 'true') throw new Error('TT_USER_TEST_ENV must be true');
assertTanTrackerUserTestStartup(process.env);
"

exec env -i \
  HOME="${HOME:-/tmp}" \
  PATH="${PATH:-/usr/bin:/bin}" \
  LANG="${LANG:-C.UTF-8}" \
  NODE_ENV=development \
  node --env-file="$ENV_FILE" dist/server.js
