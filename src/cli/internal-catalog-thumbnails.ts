import { requirePool } from "../db/pool";
import { prepareThumbnails } from "../internal-catalog/prepare-thumbnails";

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--apply", "--retry-failed"].includes(arg) && !/^--max-files=[1-9]\d*$/.test(arg)))
    throw new Error("INVALID_ARGUMENT");
  const pool = requirePool();
  try {
    const result = await prepareThumbnails(pool, {
      apply: args.includes("--apply"), retryFailed: args.includes("--retry-failed"),
      maxFiles: Number(args.find(x => x.startsWith("--max-files="))?.split("=")[1] ?? 250),
      progress: value => console.log(JSON.stringify({ progress: true, ...value })),
    });
    console.log(JSON.stringify({ apply: args.includes("--apply"), ...result }));
    if (!result.visitedAll || result.snapshotChanged || result.unavailable) process.exitCode = 2;
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(() => {
  console.error(JSON.stringify({ ok: false, message: "Thumbnail preparation stopped; secrets suppressed." }));
  process.exitCode = 1;
});
