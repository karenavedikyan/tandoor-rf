import { applyClientsImport } from "../../src/onec-clients/apply";
import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import { buildClientsFileBytes, sampleClient, sampleClientTwo } from "./onec-clients-fixtures";

process.on("uncaughtException", () => {
  process.exit(2);
});

process.on("unhandledRejection", () => {
  process.exit(3);
});

function destroyClientSocket(client: unknown): void {
  const connection = (client as { connection?: { stream?: { destroy: () => void } } }).connection;
  connection?.stream?.destroy();
}

async function main(): Promise<void> {
  const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!databaseUrl) {
    process.exit(4);
  }

  const validated = validateClientsFileBytes(
    buildClientsFileBytes([sampleClient(), sampleClientTwo()]),
  );
  if (!validated.ok) {
    process.exit(5);
  }

  const result = await applyClientsImport({
    databaseUrl,
    payload: validated.payload,
    testHooks: {
      onClientReady(client) {
        setImmediate(() => {
          destroyClientSocket(client);
        });
      },
    },
  });

  process.stdout.write(
    JSON.stringify({
      ok: result.ok,
      code: result.ok ? undefined : result.code,
    }),
  );
  process.exit(0);
}

main().catch(() => {
  process.exit(6);
});
