import { runSeptember2026OneShotApply } from "./one-shot-apply-core";
import { EXPECTED_OPERATOR_DATA_SCOPE_SHA256 } from "./scope-pins";

/** Production apply entry — fail-closed until separate human grant and scope flags change. */
export async function executeSeptember2026Apply(input: {
  databaseUrl: string;
  operatorDataScopePath: string;
  operatorDataScopeSha256: string;
  applyGrantRef: string;
  backupReceiptSha256?: string | null;
  snapshotDirectory?: string;
}): Promise<{ ok: true; receipt: unknown } | { ok: false; code: string; message: string }> {
  return runSeptember2026OneShotApply({
    databaseUrl: input.databaseUrl,
    operatorDataScopePath: input.operatorDataScopePath,
    operatorDataScopeSha256: input.operatorDataScopeSha256 ?? EXPECTED_OPERATOR_DATA_SCOPE_SHA256,
    applyGrantRef: input.applyGrantRef,
    backupReceiptSha256: input.backupReceiptSha256,
    snapshotDirectory: input.snapshotDirectory,
  });
}
