import type { PoolClient } from "pg";
import { captureSeptember047048BeforeState } from "./before-state-047-048";
import { EXPECTED_EMPTY_BEFORE_STATE_DIGEST } from "./scope-pins";

function pgJsonArrayLength(jsonText: string): number {
  const parsed = JSON.parse(jsonText) as unknown;
  return Array.isArray(parsed) ? parsed.length : 0;
}

export async function assertSeptember047048EmptyBeforeState(
  client: PoolClient,
  expectedDigest: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const before = await captureSeptember047048BeforeState(client);
  if (before.digest !== expectedDigest) {
    return { ok: false, code: "BEFORE_STATE_DIGEST_MISMATCH", message: "Before-state digest mismatch." };
  }
  const counts = {
    saleAggregateLines: pgJsonArrayLength(before.snapshot.saleAggregateLinesJson),
    saleItemLines: pgJsonArrayLength(before.snapshot.saleItemLinesJson),
    returnLines: pgJsonArrayLength(before.snapshot.returnLinesJson),
    returnItemLines: pgJsonArrayLength(before.snapshot.returnItemLinesJson),
    importStates: pgJsonArrayLength(before.snapshot.importStatesJson),
    monthActivations: pgJsonArrayLength(before.snapshot.monthActivationsJson),
  };
  if (
    counts.saleAggregateLines !== 0 ||
    counts.saleItemLines !== 0 ||
    counts.returnLines !== 0 ||
    counts.returnItemLines !== 0 ||
    counts.monthActivations !== 0
  ) {
    return { ok: false, code: "BEFORE_STATE_NOT_EMPTY", message: "September line tables must be empty before apply." };
  }
  if (counts.importStates !== 0) {
    return { ok: false, code: "BEFORE_IMPORT_STATE_PRESENT", message: "Import state id=1 rows must be absent." };
  }
  return { ok: true };
}
