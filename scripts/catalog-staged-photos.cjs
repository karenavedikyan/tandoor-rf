/* Explicit manual operation, not an import, HTTP handler or scheduled worker.
 * Run through catalog-staged-photos.sh. Never print credentials or source paths.
 * Native JPEG normalization inherits the locked PostgreSQL socket, not Node RSS.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');
const MiB = 1048576;
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const cgroup = () => {
  const root = '/sys/fs/cgroup';
  if (fs.existsSync(root + '/memory.current')) return root;
  const relative = read('/proc/self/cgroup').match(/^0::(\/[^\n]*)/m)?.[1];
  const dir = relative && path.join(root, relative);
  if (!dir || !fs.existsSync(dir + '/memory.current')) throw Error('CGROUP_METRICS');
  return dir;
};
function available() {
  let n = Number(read('/proc/meminfo').match(/^MemAvailable:\s+(\d+)/m)?.[1]) * 1024;
  if (!Number.isFinite(n) || n <= 0) throw Error('MEMORY_METRICS');
  const dir = cgroup();
  for (const name of ['max', 'high']) {
    const raw = read(dir + '/memory.' + name).trim();
    if (/^\d+$/.test(raw)) {
      const used = Number(read(dir + '/memory.current').trim());
      if (!Number.isFinite(used)) throw Error('CGROUP_METRICS');
      n = Math.min(n, Number(raw) - used);
    } else if (raw !== 'max') throw Error('CGROUP_METRICS');
  }
  return n;
}
const oom = () => Number(read(cgroup() + '/memory.events').match(/^oom_kill\s+(\d+)/m)?.[1] ?? NaN);
const health = () => new Promise(resolve => {
  const q = http.get({ host: '127.0.0.1', port: Number(process.env.PORT || 3000),
    path: '/api/ready', timeout: 2000 }, r => { r.resume(); resolve(r.statusCode === 200); });
  q.on('timeout', () => q.destroy()); q.on('error', () => resolve(false));
});
async function sha(file) {
  const h = crypto.createHash('sha256');
  for await (const b of fs.createReadStream(file)) h.update(b);
  return h.digest('hex');
}
function validateMeta(m) {
  return ['jpeg', 'png', 'webp'].includes(m.format) && (m.pages ?? 1) === 1 &&
    m.width > 0 && m.height > 0 && Math.max(m.width, m.height) <= 8192 &&
    m.width * m.height <= 32000000;
}
const coefficientBytes = m => Math.ceil(m.width / 8) * 8 * Math.ceil(m.height / 8) * 8 * m.channels * 2;
module.exports = { available, validateMeta, coefficientBytes, digest };

async function main() {
  const [mode, directory, indexRaw] = process.argv.slice(2);
  if (!['init', 'fetch', 'publish', 'final'].includes(mode) || !directory ||
      fs.lstatSync(directory).isSymbolicLink() || (fs.statSync(directory).mode & 0o777) !== 0o700)
    throw Error('PRIVATE_DIRECTORY_REQUIRED');
  const file = name => path.join(directory, name);
  const json = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  const write = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value), { mode: 0o600 });
  const log = (kind, data = {}) => console.log('PHOTO_STAGED_' + kind, JSON.stringify(data));
  const config = json('config.json');
  if (!/^[a-f0-9-]{36}$/.test(config.snapshot) || !/^[a-f0-9]{32}$/.test(config.hash) ||
      !/^[a-f0-9]{64}$/.test(config.binarySha256) ||
      config.total !== 3847 || config.ready + config.unavailable !== config.total ||
      config.unavailable > 1000 || config.maxBytes !== 8 * 1024 ** 3) throw Error('CONFIG');
  const { requirePool, closePool } = require(path.join(process.cwd(), 'dist/db/pool'));
  const { loadSnapshot } = require(path.join(process.cwd(), 'dist/internal-catalog/repository'));
  const { thumbnailStatus, makeThumbnails, THUMBNAIL_RECIPE, readThumbnail } =
    require(path.join(process.cwd(), 'dist/internal-catalog/thumbnails'));
  const { safeImagePath } = require(path.join(process.cwd(), 'dist/internal-catalog/model'));
  const sharp = require(path.join(process.cwd(), 'node_modules/sharp'));
  sharp.cache(false); sharp.concurrency(1);
  const pool = requirePool();
  let client, timer, monitor, heartbeat, ftp;
  let peak = 0, minimum = Infinity, stopped = false;
  const initialOom = oom();
  const die = reason => {
    if (stopped) return;
    stopped = true; log('STOP', { mode, reason }); ftp?.close(); process.exit(90);
  };
  const observe = () => {
    try {
      const rss = process.memoryUsage().rss, a = available();
      peak = Math.max(peak, rss); minimum = Math.min(minimum, a);
      if (rss > 160 * MiB || a < 96 * MiB || oom() !== initialOom) die('MEMORY_OR_OOM');
    } catch { die('MEMORY_METRICS'); }
  };
  const fingerprint = async () => (await client.query(
    "SELECT md5(string_agg(md5(guid::text||record::text),'' ORDER BY guid)) h FROM internal_catalog_products"
  )).rows[0].h;
  const snapshot = async () => {
    if ((await loadSnapshot(client))?.id !== config.snapshot) throw Error('SNAPSHOT_CHANGED');
  };
  try {
    // Node stages do not contain a JPEG coefficient decoder. The unchanged
    // 96 MiB runtime reserve is guarded throughout; keep 32 MiB startup margin.
    if (initialOom !== 0 || !(await health()) || available() < 128 * MiB) throw Error('PREFLIGHT');
    monitor = setInterval(observe, 20);
    timer = setTimeout(() => die('STAGE_TIMEOUT'), 40000);
    heartbeat = setInterval(async () => { if (!(await health())) die('READINESS'); }, 3000);
    client = await pool.connect();
    // Both leases cover source staging and each publication; the native shell
    // inherits this session's socket so HTTP/other workers cannot overlap it.
    for (const key of [718332020, 718332021]) {
      if (!(await client.query('SELECT pg_try_advisory_lock($1) ok', [key])).rows[0]?.ok)
        throw Error('LEASE_BUSY');
    }
    await snapshot();
    if (mode === 'init') {
      const binary = file('jpegtran-disk-x86_64'), binaryStat = fs.lstatSync(binary);
      if (!binaryStat.isFile() || binaryStat.isSymbolicLink() || binaryStat.size > 5 * MiB ||
          await sha(binary) !== config.binarySha256) throw Error('NATIVE_BINARY_HASH');
      const status = await thumbnailStatus(client, config.snapshot);
      if (status.total !== config.total || status.ready !== config.ready ||
          status.unavailable !== config.unavailable || await fingerprint() !== config.hash)
        throw Error('BASELINE_CHANGED');
      const rows = (await client.query(
        `WITH paths AS (SELECT DISTINCT replace(f->>'path',chr(92),'/') AS path
         FROM internal_catalog_products p CROSS JOIN LATERAL jsonb_array_elements(p.record->'files') f
         WHERE p.snapshot_id=$1)
         SELECT t.source_path FROM internal_catalog_thumbnails t JOIN paths p ON p.path=t.source_path
         WHERE t.snapshot_id=$1 AND t.recipe=$2 AND t.status='unavailable'
         ORDER BY t.source_path COLLATE "C" LIMIT 1001`, [config.snapshot, THUMBNAIL_RECIPE])).rows;
      const paths = rows.map(r => r.source_path);
      if (paths.length !== config.unavailable || paths.some(p => safeImagePath(p) !== p))
        throw Error('MANIFEST');
      write('plan.json', { paths, started: new Date().toISOString(), sourceBytes: 0, prepared: 0, negatives: {} });
      fs.writeFileSync(file('count'), String(paths.length), { mode: 0o600 });
      log('BEGIN', { status, count: paths.length, snapshot: config.snapshot, hash: config.hash });
      return;
    }
    const plan = json('plan.json');
    if (mode === 'final') {
      const status = await thumbnailStatus(client, config.snapshot);
      const hash = await fingerprint();
      const rows = (await client.query(
        `SELECT source_path FROM internal_catalog_thumbnails WHERE snapshot_id=$1 AND recipe=$2
         AND source_path=ANY($3::text[]) AND status='ready'`,
        [config.snapshot, THUMBNAIL_RECIPE, plan.paths])).rows;
      let valid = 0;
      for (const r of rows) {
        const small = await readThumbnail(client, config.snapshot, r.source_path, 'small');
        const list = await readThumbnail(client, config.snapshot, r.source_path, 'list');
        if (!small || !list) throw Error('AFTERCHECK');
        for (const [bytes, edge] of [[small, 240], [list, 640]]) {
          const m = await sharp(bytes, { failOn: 'error' }).metadata();
          if (m.format !== 'webp' || Math.max(m.width, m.height) > edge || m.exif) throw Error('AFTERCHECK');
          await sharp(bytes, { failOn: 'error' }).raw().toBuffer();
        }
        valid++;
      }
      const safe = hash === config.hash && status.total === config.total &&
        status.ready === config.ready + plan.prepared && valid === plan.prepared &&
        status.ready + status.unavailable === config.total && await health() && oom() === 0;
      log('FINAL', { safe, status, prepared: plan.prepared, valid, negatives: plan.negatives,
        sourceBytes: plan.sourceBytes, hash, snapshot: config.snapshot });
      if (!safe) throw Error('AFTERCHECK');
      return;
    }
    const index = Number(indexRaw), relative = plan.paths[index];
    if (!Number.isInteger(index) || !relative || safeImagePath(relative) !== relative) throw Error('INDEX');
    const id = digest(relative).slice(0, 12);
    const current = (await client.query(
      `SELECT status FROM internal_catalog_thumbnails WHERE snapshot_id=$1 AND source_path=$2 AND recipe=$3`,
      [config.snapshot, relative, THUMBNAIL_RECIPE])).rows[0];
    if (current?.status !== 'unavailable') throw Error('SOURCE_STATE_CHANGED');
    if (mode === 'fetch') {
      const negative = reason => {
        plan.negatives[reason] = (plan.negatives[reason] || 0) + 1;
        write('plan.json', plan); write('item.json', { index, id, negative: reason });
        log('NEGATIVE', { index, id, reason });
      };
      const loaded = require(path.join(process.cwd(), 'dist/onec-ftp/config')).loadOnecFtpConfig();
      if (!loaded.ok) throw Error('FTP_CONFIG');
      const c = loaded.config;
      const { Client } = require(path.join(process.cwd(), 'node_modules/basic-ftp'));
      ftp = new Client(Math.min(c.timeoutMs, 15000));
      const timeout = setTimeout(() => { ftp.close(); die('FTP_DEADLINE'); }, 15000);
      try {
        await ftp.access({ host: c.host, port: c.port, user: c.user, password: c.password, secure: false });
        const remote = '/s3/IMG/' + relative, expected = await ftp.size(remote);
        if (!Number.isSafeInteger(expected) || expected <= 0) throw Error('FTP_SIZE');
        if (expected > 32 * MiB) { negative('SOURCE_OVER_32_MIB'); return; }
        if (plan.sourceBytes + expected > config.maxBytes) throw Error('SOURCE_BUDGET');
        const { Transform } = require('node:stream');
        const { pipeline } = require('node:stream/promises');
        let seen = 0;
        const bounded = new Transform({ transform(chunk, enc, done) {
          seen += chunk.length;
          if (seen > expected || seen > 32 * MiB) done(Error('SOURCE_BUDGET'));
          else done(null, chunk);
        } });
        const copied = pipeline(bounded, fs.createWriteStream(file('source'), { flags: 'wx', mode: 0o600 }))
          .then(() => null, error => error);
        try {
          await ftp.downloadTo(bounded, remote);
          if (!bounded.writableEnded) bounded.end();
          if (await copied || seen !== expected) throw Error('TRANSFER_SIZE');
        } finally { bounded.destroy(); await copied; }
        // Make the original's cache clean before native preflight. This affects
        // only our private temporary copy, never the upstream original.
        const sourceFd = fs.openSync(file('source'), 'r+');
        try { fs.fdatasyncSync(sourceFd); } finally { fs.closeSync(sourceFd); }
        plan.sourceBytes += seen; write('plan.json', plan);
      } catch (error) {
        if (error.code === 550) { negative('FTP_550'); return; }
        throw error;
      } finally { clearTimeout(timeout); ftp.close(); }
      const metadata = await sharp(file('source'), { failOn: 'error', limitInputPixels: 32000000 })
        .timeout({ seconds: 10 }).metadata();
      if (!validateMeta(metadata)) throw Error('SOURCE_METADATA');
      const item = { index, id, metadata, sha256: await sha(file('source')), normalized: false };
      // Only simple primitive metadata is persisted, not EXIF/ICC Buffer objects.
      item.metadata = Object.fromEntries(['format', 'width', 'height', 'channels', 'pages',
        'isProgressive', 'orientation'].filter(k => metadata[k] !== undefined).map(k => [k, metadata[k]]));
      write('item.json', item);
      if (metadata.format === 'jpeg' && metadata.isProgressive) {
        const fd = client.connection.stream._handle?.fd;
        if (!Number.isInteger(fd) || fd < 0) throw Error('LEASE_SOCKET');
        // The allocator ceiling covers all tracked JPEG allocations, including
        // saved markers, not only coefficients. Add 32 MiB for libc/16 MiB
        // dirty I/O, plus the unchanged 96 MiB available-memory floor.
        fs.writeFileSync(file('native.require'),
          String(192 * MiB), { mode: 0o600 });
        const child = spawn('/bin/sh', [path.join(__dirname, 'catalog-staged-native.sh'), directory, String(process.pid)],
          { stdio: ['ignore', 'inherit', 'inherit', fd], env: {
            PATH: '/usr/bin:/bin', LANG: 'C', PORT: String(process.env.PORT || 3000),
          } });
        await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); });
        child.unref();
        log('NATIVE_HANDOFF', { index, id, pid: child.pid, width: metadata.width, height: metadata.height });
        // Do NOT pool.end()/TLS shutdown: the native child owns an inherited
        // descriptor for this locked session until it finishes. No credentials
        // are written to disk or passed as process arguments.
        process.exit(0);
      }
      fs.writeFileSync(file('native.done'), '0', { mode: 0o600 });
      return;
    }
    const item = json('item.json');
    if (item.index !== index || item.id !== id || item.negative || !validateMeta(item.metadata) ||
        await sha(file('source')) !== item.sha256) throw Error('SOURCE_BINDING');
    const normalized = fs.existsSync(file('normalized'));
    const input = file(normalized ? 'normalized' : 'source');
    const m = await sharp(input, { failOn: 'error', limitInputPixels: 32000000 }).metadata();
    if (!validateMeta(m) || (m.format === 'jpeg' && m.isProgressive) ||
        m.width !== item.metadata.width || m.height !== item.metadata.height ||
        m.orientation !== item.metadata.orientation) throw Error('NORMALIZED_METADATA');
    const preview = await sharp(input, { failOn: 'error', limitInputPixels: 32000000 })
      .timeout({ seconds: 10 }).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer();
    const thumbs = await makeThumbnails(preview);
    if (!thumbs) throw Error('THUMBNAIL_ENCODING');
    for (const [bytes, edge] of [[thumbs.small, 240], [thumbs.list, 640]]) {
      const meta = await sharp(bytes).metadata();
      if (meta.format !== 'webp' || Math.max(meta.width, meta.height) > edge || meta.exif)
        throw Error('THUMBNAIL_VALIDATION');
      await sharp(bytes, { failOn: 'error' }).raw().toBuffer();
    }
    if (await sha(file('source')) !== item.sha256) throw Error('ORIGINAL_CHANGED');
    await client.query('BEGIN');
    await snapshot();
    const status = await thumbnailStatus(client, config.snapshot);
    if (status.bytes + thumbs.small.length + thumbs.list.length > 256 * MiB) throw Error('STORAGE_CAP');
    const result = await client.query(
      `UPDATE internal_catalog_thumbnails SET status='ready',small_bytes=$4,small_sha256=$5,
       list_bytes=$6,list_sha256=$7,prepared_at=NOW()
       WHERE snapshot_id=$1 AND source_path=$2 AND recipe=$3 AND status='unavailable'`,
      [config.snapshot, relative, THUMBNAIL_RECIPE, thumbs.small, thumbs.smallHash, thumbs.list, thumbs.listHash]);
    if (result.rowCount !== 1) throw Error('WRITE_STATE_CHANGED');
    await client.query('COMMIT');
    plan.prepared++; write('plan.json', plan);
    log('PREPARED', { index, id, prepared: plan.prepared, sourceBytes: plan.sourceBytes,
      nodePeakMiB: peak / MiB, minAvailableMiB: minimum / MiB });
  } finally {
    clearTimeout(timer); clearInterval(monitor); clearInterval(heartbeat);
    ftp?.close();
    if (client) { try { await client.query('ROLLBACK'); } catch {} client.release(); }
    await closePool();
  }
}
if (require.main === module) main().catch(error => {
  const reason = /^[A-Z_]+$/.test(String(error?.message)) ? error.message : 'OPERATION_FAILED';
  console.log('PHOTO_STAGED_ERROR', JSON.stringify({ mode: process.argv[2], reason }));
  process.exitCode = 1;
});
