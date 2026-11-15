// Local synthetic benchmark only. No database, FTP, production credentials or writes.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const MiB = 1024 ** 2;
const read = file => { try { return readFileSync(file, "utf8"); } catch { return ""; } };
const rss = pid => Number(read(`/proc/${pid}/status`).match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) / 1024;
const children = pid => read(`/proc/${pid}/task/${pid}/children`).trim().split(/\s+/).filter(Boolean)
  .flatMap(pid => [Number(pid), ...children(Number(pid))]);
async function sha(file) {
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest("hex");
}
const worker = `
const fs=require('fs'),{pipeline}=require('stream/promises'),sharp=require('sharp');
sharp.cache(false);sharp.concurrency(1);
const {withTemporaryCatalogSource}=require('./dist/catalog/temporary-source');
const {processCatalogReferenceFileToPreview}=require('./dist/catalog/image-storage');
const {makeThumbnails}=require('./dist/internal-catalog/thumbnails');
(async()=>{
const file=process.argv[1],size=fs.statSync(file).size;
const result=await withTemporaryCatalogSource(size,target=>pipeline(fs.createReadStream(file),target),processCatalogReferenceFileToPreview);
if(!result.ok)throw Error(result.message);
const thumbs=await makeThumbnails(result.previewBuffer);if(!thumbs)throw Error('THUMBNAILS_FAILED');
const meta=await sharp(result.previewBuffer).metadata();
console.log(JSON.stringify({ok:true,width:result.width,height:result.height,bytes:result.byteSize,
format:meta.format,edge:Math.max(meta.width,meta.height),exif:!!meta.exif,small:thumbs.small.length,list:thumbs.list.length}));
})().catch(e=>{console.log(JSON.stringify({ok:false,message:e.message}));process.exitCode=1});
`;
async function measure(file) {
  const child = spawn(process.execPath, ["--expose-gc", "--max-old-space-size=64", "--max-semi-space-size=1", "-e", worker, file], {
    env: { PATH: process.env.PATH, NODE_ENV: "test", MALLOC_ARENA_MAX: "2", UV_THREADPOOL_SIZE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let node = 0, native = 0, combined = 0, stopped = false, stdout = "", stderr = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const pid of children(child.pid).reverse()) try { process.kill(pid, "SIGKILL"); } catch {}
    child.kill("SIGKILL");
  };
  const monitor = setInterval(() => {
    const parent = rss(child.pid), descendants = children(child.pid).map(rss);
    node = Math.max(node, parent);
    native = Math.max(native, 0, ...descendants);
    combined = Math.max(combined, parent + descendants.reduce((a, b) => a + b, 0));
    if (parent > 160 || Math.max(0, ...descendants) > 192 || parent + descendants.reduce((a, b) => a + b, 0) > 288) stop();
  }, 10);
  const timer = setTimeout(stop, 60_000);
  child.stdout.on("data", bytes => { stdout += bytes.toString(); });
  child.stderr.on("data", () => { stderr = true; });
  const code = await new Promise(resolve => child.on("close", resolve));
  clearInterval(monitor); clearTimeout(timer);
  const leftovers = (await readdir(os.tmpdir())).filter(name =>
    name.startsWith(`catalog-source-${child.pid}-`) || name.startsWith(`catalog-normalized-${child.pid}-`));
  let result;
  try { result = JSON.parse(stdout.trim()); } catch { result = { ok: false }; }
  return { code, stopped, node, native, combined, stderr, leftovers: leftovers.length, result };
}

const directory = await mkdtemp(path.join(os.tmpdir(), "catalog-file-benchmark-"));
let failed = false;
try {
  sharp.cache(false); sharp.concurrency(1);
  const profiles = process.argv.includes("--largest-only") ? [[4000, 8000]] :
    [[2438, 5813], [3795, 6882], [4060, 7022], [4000, 8000]];
  for (const [width, height] of profiles) {
    const file = path.join(directory, `${width}x${height}.jpg`);
    await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 50, progressive: true, chromaSubsampling: "4:4:4" }).toFile(file);
    const size = (await stat(file)).size, before = await sha(file);
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const sample = await measure(file);
      samples.push(sample);
      if (sample.code || sample.stopped || !sample.result.ok || sample.leftovers || sample.stderr ||
          sample.result.format !== "webp" || sample.result.edge > 1200 || sample.result.exif ||
          sample.result.small > 32768 || sample.result.list > 131072) {
        failed = true; break;
      }
    }
    const unchanged = before === await sha(file);
    failed ||= !unchanged;
    console.log(JSON.stringify({ width, height, sourceMiB: size / MiB, originalUnchanged: unchanged, samples }));
    if (failed) break;
    await rm(file);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
process.exitCode = failed ? 1 : 0;
