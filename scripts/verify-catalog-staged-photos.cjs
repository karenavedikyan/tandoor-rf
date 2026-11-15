// Sandbox-only synthetic tests; never uses production data or FTP credentials.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const sharp = require('sharp');
const { validateMeta, coefficientBytes, digest, available } = require('./catalog-staged-photos.cjs');
const script = path.join(__dirname, 'catalog-staged-native.sh');
const MiB = 1048576;
async function run(directory, port) {
  return await new Promise(resolve => {
    const c = spawn('/bin/sh', [script, directory, '999999999'], {
      env: { PATH: '/usr/bin:/bin', LANG: 'C', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe', 'ignore'],
    });
    let out = '', err = '';
    c.stdout.on('data', b => out += b); c.stderr.on('data', b => err += b);
    c.on('close', code => resolve({ code, out, err }));
  });
}
(async () => {
  for (const filename of ['catalog-staged-native.sh', 'catalog-staged-photos.sh', 'catalog-staged-run-once.sh'])
    assert.equal(spawnSync('/bin/sh', ['-n', path.join(__dirname, filename)]).status, 0);
  assert.equal(validateMeta({ format: 'jpeg', width: 4000, height: 8000, channels: 3 }), true);
  for (const bad of [
    { format: 'jpeg', width: 4000, height: 8001 },
    { format: 'jpeg', width: 8193, height: 1 },
    { format: 'webp', width: 10, height: 10, pages: 2 },
    { format: 'svg', width: 10, height: 10 },
    { format: 'png', width: 0, height: 10 },
  ]) assert.equal(validateMeta(bad), false);
  assert.equal(coefficientBytes({ width: 3795, height: 6882, channels: 3 }), 3800 * 6888 * 6);
  assert.ok(available() > 0);
  const server = http.createServer((_q, r) => { r.writeHead(200); r.end('ready'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-staged-test-'));
  fs.chmodSync(directory, 0o700);
  try {
    fs.copyFileSync(path.join(__dirname, '../tools/catalog-jpeg-disk/bin/jpegtran-disk-x86_64'),
      path.join(directory, 'jpegtran-disk-x86_64'));
    fs.chmodSync(path.join(directory, 'jpegtran-disk-x86_64'), 0o700);
    sharp.cache(false); sharp.concurrency(1);
    for (const [width, height] of [[96, 180], [3795, 6882], [4060, 7022], [4000, 8000]]) {
      const input = await sharp({ create: { width, height, channels: 3, background: '#427268' } })
        .jpeg({ progressive: true, chromaSubsampling: '4:4:4' })
        .withMetadata({ orientation: 6 }).toBuffer();
      fs.writeFileSync(path.join(directory, 'source'), input, { mode: 0o600 });
      const meta = await sharp(input).metadata();
      fs.writeFileSync(path.join(directory, 'native.require'), String(192 * MiB));
      const result = await run(directory, port);
      assert.equal(result.code, 0, JSON.stringify(result));
      assert.match(result.out, /PHOTO_STAGED_NATIVE_OK/);
      const normalized = fs.readFileSync(path.join(directory, 'normalized'));
      const m = await sharp(normalized).metadata();
      assert.equal(m.isProgressive, false); assert.equal(m.width, width); assert.equal(m.height, height);
      assert.equal(m.orientation, 6); assert.equal(digest(fs.readFileSync(path.join(directory, 'source'))), digest(input));
      assert.equal(digest(await sharp(normalized).raw().toBuffer()), digest(await sharp(input).raw().toBuffer()));
      assert.equal(fs.statSync(path.join(directory, 'normalized')).mode & 0o777, 0o600);
      console.log('PASS native lossless staged', width, height, result.out.trim());
    }
    fs.writeFileSync(path.join(directory, 'native.require'), String(1024 ** 5));
    const low = await run(directory, port);
    assert.equal(low.code, 93); assert.match(low.out, /NATIVE_NO_MEMORY/);
    console.log('PASS native memory rejection');
    fs.writeFileSync(path.join(directory, 'source'), 'corrupt');
    fs.writeFileSync(path.join(directory, 'native.require'), '0');
    const corrupt = await run(directory, port);
    assert.notEqual(corrupt.code, 0);
    console.log('PASS corrupt input rejection');
    await new Promise(resolve => server.close(resolve));
    const notReady = await run(directory, port);
    assert.equal(notReady.code, 95);
    console.log('PASS readiness rejection');
    fs.writeFileSync(path.join(directory, 'catalog-staged-photos.sh'),
      '#!/bin/sh\nsleep 30 &\necho $! > "$1/test-child"\nexit 0\n', { mode: 0o600 });
    const wrapper = await new Promise(resolve => {
      const child = spawn('/bin/sh', [path.join(__dirname, 'catalog-staged-run-once.sh'), directory], {
        detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', b => out += b);
      child.stderr.on('data', () => {});
      child.on('close', code => resolve({ code, out }));
    });
    assert.equal(wrapper.code, 0);
    assert.match(wrapper.out, /PHOTO_STAGED_PROCESS_EXIT 0/);
    const pid = fs.readFileSync(path.join(directory, 'test-child'), 'utf8').trim();
    const status = (() => { try { return fs.readFileSync(`/proc/${pid}/status`, 'utf8'); } catch { return ''; } })();
    assert.ok(!status || /^State:\s+Z/m.test(status), 'no living child survives the job');
    assert.equal(fs.existsSync(path.join(directory, 'source')), false);
    console.log('PASS detached process-group cleanup, exit status and temporary-source removal');
  } finally {
    server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log('PASS shell syntax, metadata boundaries, DCT estimate, memory/cgroup metrics, cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
