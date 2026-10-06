import { tickNightlyExchangeScheduler } from "../onec-nightly-exchange/scheduler";

async function main(): Promise<void> {
  const result = await tickNightlyExchangeScheduler();
  console.log(JSON.stringify({ event: "onec_nightly_exchange_tick", ...result }));
  if (result.status === "database_unavailable") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});
