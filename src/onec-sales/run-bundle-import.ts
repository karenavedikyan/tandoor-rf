import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { getDatabaseUrl } from "../config";
import { createImportPool } from "../onec-clients/apply";
import { analyzeSalesBundle } from "./bundle-analyze";
import { parseLegalReturnItemsJsonBytes } from "./parse-returne-items-json";
import { parseLegalReturnsJsonBytes } from "./parse-returne-json";
import { parseLegalSaleItemsJsonBytes } from "./parse-sale-items-json";
import { parseLegalSalesJsonBytes } from "./parse-sale-json";
import { applySalesBundle } from "./plan-apply-bundle";
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

export async function runSalesBundleApply(
  files: SalesBundleFiles,
  databaseUrl: string,
): Promise<{ status: "OK" | "PARSE_FAILED" | "ERROR"; message: string; plan?: Awaited<ReturnType<typeof applySalesBundle>> }> {
  if (!process.env.TEST_DATABASE_URL || databaseUrl !== process.env.TEST_DATABASE_URL) {
    return { status: "ERROR", message: "Bundle apply requires TEST_DATABASE_URL and must not target production DATABASE_URL." };
  }
  if (!files.saleAggregate || !files.saleItems || !files.returnsAggregate || !files.returnItems) {
    return { status: "ERROR", message: "All four bundle files are required for apply." };
  }
  const aggregateParsed = parseLegalSalesJsonBytes(files.saleAggregate);
  const itemsParsed = parseLegalSaleItemsJsonBytes(files.saleItems);
  const returnsParsed = parseLegalReturnsJsonBytes(files.returnsAggregate);
  const returnItemsParsed = parseLegalReturnItemsJsonBytes(files.returnItems);
  if (!aggregateParsed.ok) {
    return { status: "PARSE_FAILED", message: aggregateParsed.message };
  }
  if (!itemsParsed.ok) {
    return { status: "PARSE_FAILED", message: itemsParsed.message };
  }
  if (!returnsParsed.ok) {
    return { status: "PARSE_FAILED", message: returnsParsed.message };
  }
  if (!returnItemsParsed.ok) {
    return { status: "PARSE_FAILED", message: returnItemsParsed.message };
  }
  const pool = createImportPool(databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const known = await loadKnownLegalGuids(client);
    const plan = await applySalesBundle(
      client,
      {
        saleAggregate: aggregateParsed.roster,
        saleItems: itemsParsed.roster,
        returnsAggregate: returnsParsed.roster,
        returnItems: returnItemsParsed.roster,
      },
      known,
    );
    await client.query("COMMIT");
    return { status: "OK", message: "Bundle apply complete.", plan };
  } catch (error) {
    await client.query("ROLLBACK");
    return { status: "ERROR", message: error instanceof Error ? error.message : "Apply failed." };
  } finally {
    client.release();
    await pool.end();
  }
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
