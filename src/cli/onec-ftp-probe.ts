import { getProbeExitCode, runOnecFtpProbe } from "../onec-ftp/probe";

async function main(): Promise<void> {
  const result = await runOnecFtpProbe();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(getProbeExitCode(result.status));
}

main().catch(() => {
  process.stderr.write("1C FTP probe failed unexpectedly.\n");
  process.exit(1);
});
