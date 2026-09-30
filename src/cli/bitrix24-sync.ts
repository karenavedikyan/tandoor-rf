import { parseArgs } from "node:util";
import { runBitrix24TaskSync } from "../bitrix24/sync/run-sync";

async function main(): Promise<void> {
  const parsed = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      "bitrix-user-id": { type: "string" },
      "max-pages": { type: "string" },
    },
    allowPositionals: false,
  });

  const bitrixUserId = parsed.values["bitrix-user-id"]?.trim();
  if (!bitrixUserId) {
    console.error("Usage: bitrix24-sync --bitrix-user-id <ID> [--apply] [--max-pages N]");
    process.exit(1);
  }

  const maxPagesRaw = parsed.values["max-pages"];
  const maxPages = maxPagesRaw ? Number(maxPagesRaw) : undefined;

  const result = await runBitrix24TaskSync({
    bitrixUserId,
    apply: parsed.values.apply ?? false,
    maxPages: Number.isInteger(maxPages) ? maxPages : undefined,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Bitrix24 sync failed.");
  process.exit(1);
});
