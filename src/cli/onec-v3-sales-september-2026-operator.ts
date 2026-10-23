import { runSeptember2026Preflight } from "../onec-sales/september-2026-one-shot/preflight";
import { computeSeptember2026OperatorCodeBundleSha256 } from "../onec-sales/september-2026-one-shot/code-bundle-manifest";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--code-bundle-sha")) {
    const sha = await computeSeptember2026OperatorCodeBundleSha256(process.cwd());
    console.log(JSON.stringify({ ok: true, codeBundleSha256: sha }, null, 2));
    return;
  }
  const preflight = args.includes("--preflight") || args.length === 0;
  if (!preflight) {
    console.error(
      JSON.stringify({
        ok: false,
        code: "WRITE_OPERATIONS_NOT_IN_THIS_CLI",
        message:
          "Backup/apply/rollback are separate operator entrypoints in code; require SEPTEMBER_2026_EXTERNAL_AUTHORIZATION_REF and are not invoked from this default CLI.",
      }),
    );
    process.exit(1);
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error(JSON.stringify({ ok: false, code: "DATABASE_URL_MISSING", message: "DATABASE_URL required." }));
    process.exit(1);
  }
  const paths = {
    saleAggregate: process.env.SEPTEMBER_2026_SOURCE_SALE_AGGREGATE?.trim(),
    saleItems: process.env.SEPTEMBER_2026_SOURCE_SALE_ITEMS?.trim(),
    returnsAggregate: process.env.SEPTEMBER_2026_SOURCE_RETURNS_AGGREGATE?.trim(),
    returnItems: process.env.SEPTEMBER_2026_SOURCE_RETURN_ITEMS?.trim(),
  };
  const localSourcePaths =
    paths.saleAggregate && paths.saleItems && paths.returnsAggregate && paths.returnItems
      ? {
          saleAggregate: paths.saleAggregate,
          saleItems: paths.saleItems,
          returnsAggregate: paths.returnsAggregate,
          returnItems: paths.returnItems,
        }
      : undefined;
  const result = await runSeptember2026Preflight({ databaseUrl, localSourcePaths });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: "FATAL", message: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
