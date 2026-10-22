import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { getDatabaseUrl } from "../config";
import { createImportPool } from "../onec-clients/apply";
import { analyzeSalesBundle } from "./bundle-analyze";
import { parseLegalReturnItemsJsonBytes } from "./parse-returne-items-json";
import { parseLegalReturnsJsonBytes } from "./parse-returne-json";
import { parseLegalSaleItemsJsonBytes } from "./parse-sale-items-json";
import { parseLegalSalesJsonBytes } from "./parse-sale-json";
import { applyLegalSalesImport, planLegalSalesImport } from "./plan-apply";

export type SalesBundleFiles = {
  saleAggregate?: Buffer;
  saleItems?: Buffer;
  returnsAggregate?: Buffer;
  returnItems?: Buffer;
};

export type SalesBundleDryRunResult = {
  status: "OK" | "PARSE_FAILED" | "ERROR";
  message: string;
  report?: ReturnType<typeof analyzeSalesBundle>;
  aggregatePlan?: Awaited<ReturnType<typeof planLegalSalesImport>>;
};

async function loadKnownLegalGuids(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ guid_client: string }>(
    `SELECT lower(guid_client::text) AS guid_client FROM onec_v3_legal_entities`,
  );
  return new Set(result.rows.map((row) => row.guid_client));
}

export async function runSalesBundleDryRun(
  files: SalesBundleFiles,
  databaseUrl?: string,
): Promise<SalesBundleDryRunResult> {
  if (!files.saleAggregate || !files.saleItems || !files.returnsAggregate || !files.returnItems) {
    return { status: "ERROR", message: "All four bundle files are required for dry-run." };
  }
  const aggregateParsed = parseLegalSalesJsonBytes(files.saleAggregate);
  if (!aggregateParsed.ok) {
    return { status: "PARSE_FAILED", message: aggregateParsed.message };
  }
  const itemsParsed = parseLegalSaleItemsJsonBytes(files.saleItems);
  if (!itemsParsed.ok) {
    return { status: "PARSE_FAILED", message: itemsParsed.message };
  }
  const returnsParsed = parseLegalReturnsJsonBytes(files.returnsAggregate);
  if (!returnsParsed.ok) {
    return { status: "PARSE_FAILED", message: returnsParsed.message };
  }
  const returnItemsParsed = parseLegalReturnItemsJsonBytes(files.returnItems);
  if (!returnItemsParsed.ok) {
    return { status: "PARSE_FAILED", message: returnItemsParsed.message };
  }

  const pool = createImportPool(databaseUrl ?? getDatabaseUrl() ?? "");
  const client = await pool.connect();
  try {
    const known = await loadKnownLegalGuids(client);
    const report = analyzeSalesBundle({
      salesAggregate: aggregateParsed.roster,
      salesItems: itemsParsed.roster,
      returnsAggregate: returnsParsed.roster,
      returnsItems: returnItemsParsed.roster,
      knownCatalogLegalGuids: known,
    });
    const aggregatePlan = await planLegalSalesImport(client, aggregateParsed.roster);
    return { status: "OK", message: "Dry-run complete.", report, aggregatePlan };
  } finally {
    client.release();
    await pool.end();
  }
}

export async function readSalesBundleFilesFromPaths(paths: {
  saleAggregate: string;
  saleItems: string;
  returnsAggregate: string;
  returnItems: string;
}): Promise<SalesBundleFiles> {
  const [saleAggregate, saleItems, returnsAggregate, returnItems] = await Promise.all([
    readFile(paths.saleAggregate),
    readFile(paths.saleItems),
    readFile(paths.returnsAggregate),
    readFile(paths.returnItems),
  ]);
  return { saleAggregate, saleItems, returnsAggregate, returnItems };
}

export async function runSalesBundleApplyAggregateOnly(
  saleAggregate: Buffer,
  databaseUrl?: string,
): Promise<void> {
  const parsed = parseLegalSalesJsonBytes(saleAggregate);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  const pool = createImportPool(databaseUrl ?? getDatabaseUrl() ?? "");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await applyLegalSalesImport(client, parsed.roster);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
