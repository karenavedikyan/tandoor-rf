async function main(): Promise<void> {
  process.stderr.write(
    "Legacy 2-file clients import removed. Use: node --import tsx src/cli/onec-regular-update.ts (exchange v3, 4 files).\n",
  );
  process.exit(2);
}

main();
