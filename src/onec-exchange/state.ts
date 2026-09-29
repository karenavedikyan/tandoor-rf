import type { PoolClient } from "pg";

export type ExchangeStateRow = {
  last_attempt_at: Date | null;
  last_verified_at: Date | null;
  last_verified_sha256: string | null;
  last_checked_at: Date | null;
  last_checked_sha256: string | null;
  last_successful_apply_at: Date | null;
  last_successful_apply_sha256: string | null;
  accepted_baseline_sha256: string | null;
  last_source_modified_at: Date | null;
  apply_blocked: boolean;
  apply_blocked_reason: string | null;
};

export async function loadExchangeState(client: PoolClient): Promise<ExchangeStateRow> {
  const result = await client.query<ExchangeStateRow>(
    `
      SELECT
        last_attempt_at,
        last_verified_at,
        last_verified_sha256,
        last_checked_at,
        last_checked_sha256,
        last_successful_apply_at,
        last_successful_apply_sha256,
        accepted_baseline_sha256,
        last_source_modified_at,
        apply_blocked,
        apply_blocked_reason
      FROM onec_exchange_state
      WHERE id = 1
    `,
  );
  return (
    result.rows[0] ?? {
      last_attempt_at: null,
      last_verified_at: null,
      last_verified_sha256: null,
      last_checked_at: null,
      last_checked_sha256: null,
      last_successful_apply_at: null,
      last_successful_apply_sha256: null,
      accepted_baseline_sha256: null,
      last_source_modified_at: null,
      apply_blocked: false,
      apply_blocked_reason: null,
    }
  );
}

export async function markExchangeAttempt(client: PoolClient): Promise<void> {
  await client.query(
    `
      UPDATE onec_exchange_state
      SET last_attempt_at = NOW(), updated_at = NOW()
      WHERE id = 1
    `,
  );
}

export async function markExchangeVerified(
  client: PoolClient,
  input: { sha256: string; verifiedAt?: Date },
): Promise<void> {
  const verifiedAt = input.verifiedAt ?? new Date();
  await client.query(
    `
      UPDATE onec_exchange_state
      SET
        last_attempt_at = $1,
        last_verified_at = $1,
        last_verified_sha256 = $2,
        last_checked_at = $1,
        last_checked_sha256 = $2,
        updated_at = NOW()
      WHERE id = 1
    `,
    [verifiedAt, input.sha256],
  );
}

export async function markExchangeApplied(
  client: PoolClient,
  input: {
    sha256: string;
    appliedAt?: Date;
    acceptedBaselineSha256?: string | null;
  },
): Promise<void> {
  const appliedAt = input.appliedAt ?? new Date();
  await client.query(
    `
      UPDATE onec_exchange_state
      SET
        last_successful_apply_at = $1,
        last_successful_apply_sha256 = $2,
        last_verified_at = $1,
        last_verified_sha256 = $2,
        last_checked_at = $1,
        last_checked_sha256 = $2,
        accepted_baseline_sha256 = COALESCE($3, accepted_baseline_sha256, $2),
        apply_blocked = false,
        apply_blocked_reason = NULL,
        updated_at = NOW()
      WHERE id = 1
    `,
    [appliedAt, input.sha256, input.acceptedBaselineSha256 ?? null],
  );
}

export async function blockExchangeApply(
  client: PoolClient,
  reason: string,
): Promise<void> {
  await client.query(
    `
      UPDATE onec_exchange_state
      SET apply_blocked = true, apply_blocked_reason = $1, updated_at = NOW()
      WHERE id = 1
    `,
    [reason],
  );
}

export async function getDbCommittedSnapshotSha(client: PoolClient): Promise<string | null> {
  const state = await loadExchangeState(client);
  if (state.last_successful_apply_sha256) {
    return state.last_successful_apply_sha256;
  }
  const fallback = await client.query<{ source_sha256: string | null }>(
    `
      SELECT source_sha256
      FROM onec_client_import_runs
      WHERE status = 'success' AND mode = 'apply'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `,
  );
  return fallback.rows[0]?.source_sha256 ?? null;
}
