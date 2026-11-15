# Manual low-memory catalogue photo preparation

This is a one-shot operational tool, not a new service, migration, import,
HTTP endpoint or scheduled worker. It does not change production environment
variables or replace `/usr/bin/jpegtran`. Running it requires authorization for
the specific production photo pass. It is Linux x86-64 only.

## Why a disk-backed codec

The regular libjpeg-turbo `jmemnobs.c` backend has no disk backing store.
Progressive JPEG coefficient arrays therefore occupy full-resolution anonymous
memory even for small final thumbnails. The upstream virtual-array interface
supports a different backing store without changing the codec
([upstream jmemsys.h](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/jmemsys.h)).

`jmemdisk.c` implements that interface with a maximum of 64 MiB coefficient RAM
and 256 MiB total backing files. Each private `mkstemp` file is immediately
unlinked, so normal exits, decode errors and SIGKILL release the disk storage.
Writes are synced in chunks of at most 16 MiB to bound dirty page-cache pressure.
Clean coefficient cache remains reclaimable by Linux and can be reused across
progressive scans instead of forcing repeated physical reads.

The binary is statically linked from libjpeg-turbo 3.2.1 with SIMD disabled.
It only normalizes progressive JPEG into sequential JPEG. It does not modify
original files or perform arbitrary network requests. Other image stages use
the project's existing Sharp/WebP thumbnail recipe.

## Reproduce this binary

Source archive:
https://api.github.com/repos/libjpeg-turbo/libjpeg-turbo/tarball/3.2.1

Archive SHA-256:
`f9d7fad5a49dcab5270cccd2a75f567e21cbc5fcea408671034f083651874c86`

Extract the pinned archive into a clean directory. Replace only
`src/jmemnobs.c` with this directory's `jmemdisk.c`, then run:

```sh
cmake -S SOURCE -B BUILD \
  -DENABLE_SHARED=OFF -DENABLE_STATIC=ON -DWITH_TURBOJPEG=OFF -DWITH_SIMD=OFF \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS_RELEASE='-Os -DNDEBUG -ffunction-sections -fdata-sections' \
  -DCMAKE_EXE_LINKER_FLAGS='-static -s -Wl,--gc-sections'
cmake --build BUILD --target jpegtran-static -j2
```

The checked-in binary's SHA-256 is
`9101fcd1f168c9bedb3eab82abec71b8d975f41e880503b9679dfcddf4cacf13`.
Compiler, libc and build-date differences can change the executable hash.
Always validate the exact executable delivered to the server.
Upstream license notices are included alongside this file.

## Operational controls

- Run only `scripts/catalog-staged-run-once.sh` in its own detached process
  group. Its controller and watchdog enforce a 35-minute processing window
  and a 2140-second hard deadline, without repeated launches.
- Supply a private mode-0700 run directory containing the four `catalog-staged`
  scripts, the verified binary and a mode-0600 `config.json`.
- Configuration pins `snapshot`, product-record `hash`, `total`, `ready`,
  `unavailable`, `maxBytes` (8 GiB) and `binarySha256`.
- Node stages exit before the native JPEG decoder starts. Its inherited
  PostgreSQL socket retains both existing advisory leases until it exits.
  This behavior is tested against PostgreSQL and was checked with the
  production TLS connection without processing photographs.
- Runtime guards remain Node RSS 160 MiB, native RSS 192 MiB and available
  memory at least 96 MiB, with no overlapping Node/native work. Cgroup
  memory.max/high and OOM counters are checked. Native work has a 10-second
  deadline and bounded output; FTP has its existing 15-second deadline.
- Original sources remain limited to 32 MiB, 32 MP and 8192 pixels per edge.
  Oversized sources and definitive FTP 550 responses remain explicit
  unresolved results, not invented photos. Any other error stops the pass.
- Only `unavailable` rows in `internal_catalog_thumbnails` for the pinned
  snapshot and recipe can become `ready`. Prepared rows, products, originals,
  users, roles, assignments, bot links and history are not rewritten.
- SHA-256, full WebP decoding, bounds, EXIF removal, snapshot/product
  fingerprints, database storage cap, readiness and final counts are checked.
- This is a one-shot maintenance tool, not a scheduled service. A container
  whose PID 1 does not reap adopted children can retain exited native-shell
  zombie entries after the pass. They do not retain image RAM or sockets, but
  consume PID slots. Check PID headroom before another maintenance pass; use
  an init/subreaper before adapting this design to recurring execution. Do not
  restart the application merely for cleanup without separate authorization.

Sandbox checks:

```sh
node scripts/verify-catalog-staged-photos.cjs
node scripts/verify-catalog-staged-integration.cjs
```

The integration fixture requires its own local database
`tandor_staged_photo_test`. It uses only synthetic records and a loopback FTP
server, and must never be pointed at production.
