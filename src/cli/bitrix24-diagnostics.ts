import { loadBitrix24Config } from "../bitrix24/config";
import { listBindingDiagnostics, findLatestSyncJournalEntry } from "../bitrix24/tasks/repository";

async function main(): Promise<void> {
  const loaded = loadBitrix24Config();
  if (!loaded.ok) {
    console.log(JSON.stringify({ ok: false, message: "Bitrix24 is not configured." }));
    process.exit(1);
  }

  const portalId = loaded.config.portalId;
  const diagnostics = await listBindingDiagnostics(portalId, 50);
  const latest = await findLatestSyncJournalEntry(portalId);

  console.log(
    JSON.stringify(
      {
        ok: true,
        portalId,
        latestSync: latest,
        bindingDiagnostics: diagnostics.map((entry) => ({
          taskId: entry.taskId,
          reason: entry.reason,
          detail: entry.detail,
          recordedAt: entry.recordedAt,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch(() => {
  console.error("Bitrix24 diagnostics failed.");
  process.exit(1);
});
