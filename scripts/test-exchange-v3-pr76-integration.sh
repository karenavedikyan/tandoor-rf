#!/usr/bin/env bash
# Sequential PR #76 integration tests on isolated *_test DB (avoids migration lock).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  if [[ -f scripts/setup-test-db.sh ]]; then
    bash scripts/setup-test-db.sh >/dev/null
  fi
  export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test}"
fi

FILES=(
  test/integration/clients-v3-api.test.ts
  test/integration/clients-v3-teams.test.ts
  test/integration/clients-v3-rop-branch.test.ts
  test/integration/onec-exchange-v3-import.test.ts
  test/integration/onec-exchange-v3-target-db-identity.test.ts
  test/integration/onec-exchange-v3-clean-start.test.ts
  test/integration/onec-exchange-v3-bitrix-labels.test.ts
)

for f in "${FILES[@]}"; do
  echo "==> $f"
  node --import tsx --test --test-concurrency=1 "$f"
done

DB_NAME="$(node -e "try{const u=new URL(process.env.TEST_DATABASE_URL.replace(/^postgresql:/i,'postgres:'));process.stdout.write(decodeURIComponent(u.pathname.replace(/^\\//,'').split('/')[0]||''));}catch{process.stdout.write('unknown');}")"
echo "OK: ${#FILES[@]} integration files passed (database: ${DB_NAME})"
