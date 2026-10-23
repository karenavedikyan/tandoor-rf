#!/usr/bin/env node
import {
  readSalesBundleFilesFromPaths,
  runSalesBundleApply,
  runSalesBundleDryRun,
} from "../onec-sales/run-bundle-import";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--apply");
  const paths = {
    saleAggregate: "",
    saleItems: "",
    returnsAggregate: "",
    returnItems: "",
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--sale") {
      paths.saleAggregate = args[++i] ?? "";
    } else if (arg === "--sale-items") {
      paths.saleItems = args[++i] ?? "";
    } else if (arg === "--returns") {
      paths.returnsAggregate = args[++i] ?? "";
    } else if (arg === "--return-items") {
      paths.returnItems = args[++i] ?? "";
    }
  }
  if (!paths.saleAggregate || !paths.saleItems || !paths.returnsAggregate || !paths.returnItems) {
    console.error(
      "Usage: onec-v3-sales-bundle-import [--apply] --sale <path> --sale-items <path> --returns <path> --return-items <path>",
    );
    process.exit(2);
  }
  const files = await readSalesBundleFilesFromPaths(paths);
  const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("TEST_DATABASE_URL or DATABASE_URL required.");
    process.exit(2);
  }
  const result = dryRun
    ? await runSalesBundleDryRun(files, dbUrl)
    : await runSalesBundleApply(files, dbUrl);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "OK" ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
