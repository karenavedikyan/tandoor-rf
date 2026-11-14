// Local synthetic evidence only. No database, FTP, credentials or production data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const self = fileURLToPath(import.meta.url);
const sharp = require("sharp");
const iterations = Number(process.argv.find(arg => arg.startsWith("--iterations="))?.split("=")[1] ?? 3);
assert.ok(Number.isInteger(iterations) && iterations >= 1 && iterations <= 20);

if (process.argv[2] === "--worker") {
  delete process.env.DATABASE_URL;
  process.env.NODE_ENV = "test";
  sharp.cache(false); sharp.concurrency(1);
  const mode = process.argv[4];
  const normalizer = require("../dist/catalog/jpeg-normalize");
  if (mode === "previous") normalizer.withNormalizedJpeg = async (bytes, _metadata, consume) => consume(bytes);
  require("../dist/internal-catalog/prepare-thumbnails");
  const { makeThumbnails } = require("../dist/internal-catalog/thumbnails");
  const source = await readFile(process.argv[3]);
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  const original = digest(source);
  for (let i = 0; i < iterations; i++) {
    global.gc();
    if (process.env.CATALOG_BENCH_TRACE) console.error(JSON.stringify({ iteration: i, ...process.memoryUsage() }));
    // Fresh allocation per image, approximating a new bounded FTP download.
    const file = Buffer.from(source);
    const result = await makeThumbnails(file); assert.ok(result);
    for (const [key, edge] of [["small", 240], ["list", 640]]) {
      const meta = await sharp(result[key]).metadata();
      assert.equal(meta.format, "webp");
      assert.equal(Math.max(meta.width, meta.height), edge);
      assert.equal(meta.exif, undefined);
    }
    assert.equal(digest(file), original);
  }
  assert.equal(digest(source), original);
  console.log(JSON.stringify({ prepared: iterations, kernelParentPeakMiB: process.resourceUsage().maxRSS / 1024 }));
} else {
  const root = await mkdtemp(path.join(os.tmpdir(), "tandor-jpeg-synthetic-"));
  const rss = pid => {
    try { return Number(readFileSync(`/proc/${pid}/status`, "utf8").match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) / 1024; }
    catch { return 0; }
  };
  const descendants = pid => {
    try {
      return readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/)
        .filter(Boolean).flatMap(id => [Number(id), ...descendants(Number(id))]);
    } catch { return []; }
  };
  async function measure(filename, mode) {
    const child = spawn(process.execPath, ["--expose-gc", "--max-old-space-size=64", "--max-semi-space-size=1",
      self, "--worker", filename, mode, `--iterations=${iterations}`],
      { stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, UV_THREADPOOL_SIZE: "1", MALLOC_ARENA_MAX: "2" } });
    let output = "", error = "", parentPeakMiB = 0, childPeakMiB = 0, combinedPeakMiB = 0;
    const sample = () => {
      const parent = rss(child.pid), children = descendants(child.pid).map(rss);
      parentPeakMiB = Math.max(parentPeakMiB, parent);
      childPeakMiB = Math.max(childPeakMiB, ...children);
      combinedPeakMiB = Math.max(combinedPeakMiB, parent + children.reduce((sum, value) => sum + value, 0));
    };
    const monitor = setInterval(sample, 5);
    const timeout = setTimeout(() => {
      for (const pid of descendants(child.pid)) { try { process.kill(pid, "SIGKILL"); } catch {} }
      child.kill("SIGKILL");
    }, 30_000);
    child.stdout.on("data", bytes => { output += bytes; });
    child.stderr.on("data", bytes => { error = (error + bytes).slice(-4000); });
    try {
      const code = await new Promise((resolve, reject) => { child.on("close", resolve); child.on("error", reject); });
      assert.equal(code, 0, error);
      const result = JSON.parse(output.trim());
      parentPeakMiB = Math.max(parentPeakMiB, result.kernelParentPeakMiB);
      if (mode === "fixed") {
        assert.ok(parentPeakMiB <= 160, `parent RSS ${parentPeakMiB}`);
        assert.ok(childPeakMiB <= 160, `native child RSS ${childPeakMiB}`);
      }
      return { runtime: process.version, mode, prepared: result.prepared, parentPeakMiB, childPeakMiB, combinedPeakMiB };
    } finally { clearInterval(monitor); clearTimeout(timeout); }
  }
  try {
    const cases = process.argv.includes("--large-only") ? [[4000, 6000]] : [[2438, 5813], [4000, 6000]];
    for (const [width, height] of cases) {
      const pixels = Buffer.alloc(width * height * 3);
      let state = 123456789;
      for (let i = 0; i < pixels.length; i += 3) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = state & 255;
      }
      let bytes;
      for (const quality of [50, 35, 20]) {
        bytes = await sharp(pixels, { raw: { width, height, channels: 3 } })
          .jpeg({ quality, progressive: true, chromaSubsampling: "4:4:4" }).toBuffer();
        if (bytes.length <= 8 * 1024 * 1024) break;
      }
      assert.ok(bytes.length <= 8 * 1024 * 1024);
      const filename = path.join(root, `${width}x${height}.jpg`); await writeFile(filename, bytes);
      for (const mode of process.argv.includes("--fixed-only") ? ["fixed"] : ["previous", "fixed"])
        console.log(JSON.stringify({ width, height, sourceBytes: bytes.length, ...await measure(filename, mode) }));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}
