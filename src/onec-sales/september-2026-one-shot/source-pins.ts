import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { EXPECTED_SOURCE_FILES } from "./scope-pins";
import { parseLegalSalesJsonBytes } from "../parse-sale-json";
import { parseLegalSaleItemsJsonBytes } from "../parse-sale-items-json";
import { parseLegalReturnsJsonBytes } from "../parse-returne-json";
import { parseLegalReturnItemsJsonBytes } from "../parse-returne-items-json";
import type { PoolClient } from "pg";
import { loadKnownLegalGuidSet, isKnownGuid } from "../matched-only/catalog";
import { EXPECTED_UNKNOWN_CATALOG_GUID_COUNT, SEPTEMBER_2026_SALE_MONTH_ISO } from "./scope-pins";

function sha256File(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function verifySourceFilePin(
  key: keyof typeof EXPECTED_SOURCE_FILES,
  localPath: string,
): Promise<{ ok: true; full: number } | { ok: false; code: string; message: string }> {
  const pin = EXPECTED_SOURCE_FILES[key];
  const bytes = await readFile(localPath);
  const sha = sha256File(bytes);
  if (sha !== pin.sha256) {
    return { ok: false, code: "SOURCE_SHA_MISMATCH", message: `${pin.path} SHA mismatch.` };
  }
  const parsers = {
    saleAggregate: parseLegalSalesJsonBytes,
    saleItems: parseLegalSaleItemsJsonBytes,
    returnsAggregate: parseLegalReturnsJsonBytes,
    returnItems: parseLegalReturnItemsJsonBytes,
  } as const;
  const parsed = parsers[key](bytes);
  if (!parsed.ok || !parsed.roster) {
    return { ok: false, code: "SOURCE_PARSE_FAILED", message: `${pin.path} parse failed.` };
  }
  const lines = parsed.roster.lines;
  const full = lines.length;
  if (full !== pin.counts.full) {
    return { ok: false, code: "SOURCE_ROW_COUNT_MISMATCH", message: `${pin.path} full row count mismatch.` };
  }
  for (const line of lines) {
    if (line.saleMonthStartIso !== SEPTEMBER_2026_SALE_MONTH_ISO) {
      return { ok: false, code: "SOURCE_PERIOD_MISMATCH", message: `${pin.path} contains non-September rows.` };
    }
  }
  return { ok: true, full };
}

export async function verifyMatchedCountsFromSources(
  client: PoolClient,
  sources: Record<keyof typeof EXPECTED_SOURCE_FILES, Buffer>,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const known = await loadKnownLegalGuidSet(client);
  const unknown = new Set<string>();
  const entries = [
    ["saleAggregate", parseLegalSalesJsonBytes(sources.saleAggregate)],
    ["saleItems", parseLegalSaleItemsJsonBytes(sources.saleItems)],
    ["returnsAggregate", parseLegalReturnsJsonBytes(sources.returnsAggregate)],
    ["returnItems", parseLegalReturnItemsJsonBytes(sources.returnItems)],
  ] as const;
  for (const [key, parsed] of entries) {
    if (!parsed.ok || !parsed.roster) {
      return { ok: false, code: "SOURCE_PARSE_FAILED", message: String(key) };
    }
    let matched = 0;
    for (const line of parsed.roster.lines) {
      if (isKnownGuid(known, line.legalGuid)) matched += 1;
      else unknown.add(line.legalGuid.toLowerCase());
    }
    const pin = EXPECTED_SOURCE_FILES[key];
    if (matched !== pin.counts.matched || parsed.roster.lines.length - matched !== pin.counts.excluded) {
      return { ok: false, code: "SOURCE_MATCHED_COUNT_MISMATCH", message: `${key} matched/excluded mismatch.` };
    }
  }
  if (unknown.size !== EXPECTED_UNKNOWN_CATALOG_GUID_COUNT) {
    return {
      ok: false,
      code: "UNKNOWN_GUID_COUNT_MISMATCH",
      message: `Expected ${EXPECTED_UNKNOWN_CATALOG_GUID_COUNT} unknown GUIDs, found ${unknown.size}.`,
    };
  }
  return { ok: true };
}
