/** Blocks mutating handoff/receipt/edit paths on deleted or admin general-archived transfers. */
export type TransferWriteGuardRow = {
  deleted_at?: Date | null;
  general_archived_at?: Date | null;
};

export function transferWriteBlocked(row: TransferWriteGuardRow | null | undefined): boolean {
  if (!row) return true;
  return row.deleted_at != null || row.general_archived_at != null;
}

export const TRANSFER_WRITE_BLOCKED_MESSAGE =
  "Передача в общем архиве или удалена — изменения недоступны.";
