import type { PoolClient } from "pg";

/** Consume open codes and supersede invitations / messenger sessions after route or version change. */
export async function invalidateOpenHandoffArtifacts(
  client: PoolClient,
  transferId: string,
  opts?: { supersedeInvitations?: boolean },
): Promise<void> {
  await client.query(
    `UPDATE tt_handoff_codes SET consumed_at = NOW()
     WHERE transfer_id = $1 AND consumed_at IS NULL`,
    [transferId],
  );
  if (opts?.supersedeInvitations !== false) {
    await client.query(
      `UPDATE tt_transfer_invitations SET superseded_at = NOW()
       WHERE transfer_id = $1 AND superseded_at IS NULL`,
      [transferId],
    );
  }
  await client.query(
    `UPDATE tt_external_messenger_sessions SET superseded_at = NOW()
     WHERE transfer_id = $1 AND superseded_at IS NULL`,
    [transferId],
  );
}
