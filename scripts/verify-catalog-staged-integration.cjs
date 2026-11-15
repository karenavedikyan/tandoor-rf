/* Isolated sandbox database and loopback FTP only. No production credentials. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');
const sharp = require('sharp');
const { digest } = require('./catalog-staged-photos.cjs');
const url = 'postgresql://staged_photo_test:sandbox-only-staged-photo@127.0.0.1/tandor_staged_photo_test';
const helper = path.join(__dirname, 'catalog-staged-photos.cjs');
(async () => {
  const db = new Pool({ connectionString: url });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-staged-integration-'));
  fs.chmodSync(directory, 0o700);
  const ready = http.createServer((_q, r) => { r.end('ready'); });
  let ftp, passive, data;
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS internal_catalog_snapshots(
      id uuid PRIMARY KEY,sha256 text,source_name text,imported_at timestamptz DEFAULT now(),summary jsonb);
      CREATE TABLE IF NOT EXISTS internal_catalog_products(snapshot_id uuid,guid uuid,record jsonb);
      CREATE TABLE IF NOT EXISTS internal_catalog_thumbnails(snapshot_id uuid,source_path text,recipe text,status text,
      small_bytes bytea,small_sha256 text,list_bytes bytea,list_sha256 text,prepared_at timestamptz DEFAULT now(),
      PRIMARY KEY(snapshot_id,source_path,recipe));
      TRUNCATE internal_catalog_snapshots,internal_catalog_products,internal_catalog_thumbnails;`);
    const snapshot = '00000000-0000-4000-8000-000000000001';
    const paths = Array.from({ length: 3847 }, (_, i) => `photo-${String(i).padStart(4, '0')}.jpg`);
    await db.query('INSERT INTO internal_catalog_snapshots(id,sha256,source_name,summary) VALUES($1,$2,$3,$4)',
      [snapshot, 'synthetic', 'synthetic', {}]);
    await db.query('INSERT INTO internal_catalog_products VALUES($1,$2,$3)',
      [snapshot, snapshot, { guid: snapshot, files: paths.map(p => ({ path: p })) }]);
    await db.query(`INSERT INTO internal_catalog_thumbnails(snapshot_id,source_path,recipe,status)
      SELECT $1,p,'webp-v1-240-640-q76',CASE WHEN ord<=236 THEN 'unavailable' ELSE 'ready' END
      FROM unnest($2::text[]) WITH ORDINALITY x(p,ord)`, [snapshot, paths]);
    const hash = (await db.query("SELECT md5(string_agg(md5(guid::text||record::text),'' ORDER BY guid)) h FROM internal_catalog_products")).rows[0].h;
    fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
      snapshot, hash, total: 3847, ready: 3611, unavailable: 236, maxBytes: 8 * 1024 ** 3,
      binarySha256: digest(fs.readFileSync(path.join(__dirname, '../tools/catalog-jpeg-disk/bin/jpegtran-disk-x86_64'))),
    }), { mode: 0o600 });
    fs.copyFileSync(path.join(__dirname, '../tools/catalog-jpeg-disk/bin/jpegtran-disk-x86_64'),
      path.join(directory, 'jpegtran-disk-x86_64'));
    fs.chmodSync(path.join(directory, 'jpegtran-disk-x86_64'), 0o700);
    const progressive = await sharp({ create: { width: 3795, height: 6882, channels: 3, background: '#427268' } })
      .jpeg({ progressive: true, chromaSubsampling: '4:4:4' }).withMetadata({ orientation: 6 }).toBuffer();
    const baseline = await sharp({ create: { width: 96, height: 180, channels: 3, background: '#427268' } }).jpeg().toBuffer();
    await new Promise(resolve => ready.listen(0, '127.0.0.1', resolve));
    ftp = net.createServer(socket => {
      socket.on('error', () => {});
      socket.write('220 sandbox FTP\r\n');
      let buffered = '';
      socket.on('data', chunk => {
        buffered += chunk;
        for (;;) {
          const end = buffered.indexOf('\r\n');
          if (end < 0) break;
          const line = buffered.slice(0, end); buffered = buffered.slice(end + 2);
          const [command, ...rest] = line.split(' '), arg = rest.join(' ');
          if (command === 'USER') socket.write('331 password\r\n');
          else if (command === 'PASS') socket.write('230 logged in\r\n');
          else if (command === 'FEAT') socket.write('211 no features\r\n');
          else if (command === 'EPSV') {
            passive = net.createServer(s => { data = s; s.on('error', () => {}); });
            passive.listen(0, '127.0.0.1', () => socket.write(`229 Entering Extended Passive Mode (|||${passive.address().port}|)\r\n`));
          } else if (command === 'SIZE') {
            if (arg.endsWith('0002.jpg')) socket.write('550 not found\r\n');
            else socket.write(`213 ${arg.endsWith('0003.jpg') ? 33554433 : arg.endsWith('0000.jpg') ? progressive.length : baseline.length}\r\n`);
          } else if (command === 'RETR') {
            socket.write('150 opening data\r\n');
            data.end(arg.endsWith('0000.jpg') ? progressive : baseline, () => {
              data.destroy(); passive.close(); socket.write('226 complete\r\n');
            });
          } else if (command === 'QUIT') socket.end('221 bye\r\n');
          else socket.write('200 OK\r\n');
        }
      });
    });
    await new Promise(resolve => ftp.listen(0, '127.0.0.1', resolve));
    const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: url, PGSSLMODE: 'disable',
      PORT: String(ready.address().port), ONEC_FTP_ENABLED: 'true', ONEC_FTP_HOST: '127.0.0.1',
      ONEC_FTP_PORT: String(ftp.address().port), ONEC_FTP_USER: 'sandbox', ONEC_FTP_PASSWORD: 'sandbox',
      ONEC_FTP_BASE_PATH: '/s3', ONEC_FTP_SECURITY: 'plain' };
    const run = (mode, index) => new Promise(resolve => {
      const child = spawn(process.execPath, ['--expose-gc', '--max-old-space-size=64', '--max-semi-space-size=1',
        helper, mode, directory, String(index ?? '')], {
        env, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '', err = '';
      let leaseCheck = Promise.resolve();
      child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
      child.on('exit', () => {
        if (mode === 'fetch' && index === 0) leaseCheck = db.query(
          'SELECT pg_try_advisory_lock(718332020) a,pg_try_advisory_lock(718332021) b'
        ).then(result => {
          assert.equal(result.rows[0].a, false, 'preparation lease survives Node exit');
          assert.equal(result.rows[0].b, false, 'native lease survives Node exit');
        });
      });
      // The native shell inherits stdout; wait for close, not only Node exit.
      child.on('close', async code => { await leaseCheck; resolve({ code, out, err }); });
    });
    assert.equal((await run('init')).code, 0);
    for (let i = 0; i < 4; i++) {
      for (const name of ['source', 'normalized', 'item.json', 'native.done', 'native.require', 'native.stderr'])
        fs.rmSync(path.join(directory, name), { force: true });
      const fetch = await run('fetch', i);
      assert.equal(fetch.code, 0, JSON.stringify(fetch));
      if (i < 2) {
        assert.equal(fs.readFileSync(path.join(directory, 'native.done'), 'utf8').trim(), '0');
        const sourceHash = digest(fs.readFileSync(path.join(directory, 'source')));
        const published = await run('publish', i);
        assert.equal(published.code, 0, JSON.stringify(published));
        assert.equal(digest(fs.readFileSync(path.join(directory, 'source'))), sourceHash);
        const row = (await db.query('SELECT * FROM internal_catalog_thumbnails WHERE source_path=$1', [paths[i]])).rows[0];
        assert.equal(row.status, 'ready');
        assert.equal(digest(row.small_bytes), row.small_sha256);
        assert.equal(digest(row.list_bytes), row.list_sha256);
        const meta = await sharp(row.list_bytes).metadata();
        assert.equal(Math.max(meta.width, meta.height) <= 640, true);
        if (i === 0) assert.ok(meta.width > meta.height, 'EXIF rotation preserved');
      } else {
        assert.match(fetch.out, i === 2 ? /FTP_550/ : /SOURCE_OVER_32_MIB/);
        assert.equal(fs.existsSync(path.join(directory, 'native.require')), false);
      }
    }
    const final = await run('final');
    assert.equal(final.code, 0, JSON.stringify(final));
    assert.match(final.out, /"safe":true/);
    assert.match(final.out, /"prepared":2/);
    console.log('PASS isolated PostgreSQL + FTP: progressive/baseline, hashes, orientation, source preservation, 550, 32MiB cap, final integrity');
  } finally {
    passive?.close(); data?.destroy(); ftp?.close(); ready.close();
    await db.end(); fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
