import {
  BITRIX24_SYNC_ARGUMENT_ERROR_MESSAGES,
  parseBitrix24SyncCliArgs,
} from "../bitrix24/sync-cli-args";
import { runBitrix24TaskSync } from "../bitrix24/sync/run-sync";

async function main(): Promise<void> {
  const parsed = parseBitrix24SyncCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(BITRIX24_SYNC_ARGUMENT_ERROR_MESSAGES[parsed.code]);
    process.exit(2);
  }

  const result = await runBitrix24TaskSync({
    bitrixUserId: parsed.options.bitrixUserId,
    apply: parsed.options.apply,
    maxPages: parsed.options.maxPages,
    taskId: parsed.options.taskId,
  });

  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed") {
    process.exit(1);
  }
  if (result.status === "partial") {
    process.exit(3);
  }
  process.exit(0);
}

main().catch(() => {
  console.error("Bitrix24 sync failed.");
  process.exit(1);
});
