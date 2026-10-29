# Tanbot readonly packaging — real Docker evidence

**Task:** `TANBOT-4B671C5-REAL-DOCKER-CHECK-20261029`  
**Packaging SHA:** `4b671c537c2f5e154e3685c9caee3e1708ba8ad4`  
**Branch:** `cursor/tanbot-telegram-server-stage1-20261029`  
**Date (UTC):** 2026-10-29  

Synthetic token only; no `--live`, no real Telegram, no production resources.

## Environment

| Item | Value |
|------|--------|
| Docker CLI / engine | 29.1.3 (Ubuntu `docker.io` package) |
| Daemon | Isolated `dockerd --data-root=/tmp/tanbot-docker-data --host=unix:///tmp/tanbot-docker-run/docker.sock` (sandbox-only, not production socket) |
| Preflight | `PREFLIGHT_OK` for `4b671c537c2f5e154e3685c9caee3e1708ba8ad4` |

## Image

| Field | Value |
|-------|--------|
| Tag | `tanbot-readonly-check:4b671c5` |
| Image ID | `sha256:4d2c4566339c6f8b1fa42a8693159d71178f2786b896da0d5f23fed6ddc1f0b5` |
| Build | `docker build -f Dockerfile.tanbot-readonly-check -t tanbot-readonly-check:4b671c5 .` → exit **0** |
| Image `Config.Env` | `TANBOT_TELEGRAM_ENABLED=false`, `TANBOT_TELEGRAM_EXPECTED_USERNAME=TANDOOR_IBOT` — **no bot token in image config** |

## Container runs (`--network none`)

Runtime token supplied only via `--env-file` (local case); not in build-args.

| Case | Command summary | Exit | JSON `status` |
|------|-----------------|------|----------------|
| Disabled (image default) | `docker run --rm --network none tanbot-readonly-check:4b671c5` | **0** | `DISABLED` |
| Local | `docker run --rm --network none --env-file <tmp>` (`ENABLED=true`, synthetic token) | **0** | `LOCAL_OK` |
| Config error | `docker run --rm --network none -e ENABLED=true -e BOT_TOKEN=` | **2** | `CONFIG_ERROR` |

Network isolation: **`--network none`** on all three runs (no external Telegram path from container network namespace).

Process model: each `docker run` exited after JSON report; no published ports, no restart policy, no `--live`.

## Leak checks (synthetic marker)

Marker: `SYNTH_READONLY_PACK_TOKEN_MARKER` (and `123456789:` prefix rule).

| Surface | Result |
|---------|--------|
| stdout/stderr of three runs | **no leak** |
| `/tmp/tanbot-docker-build.log` | **no leak** |
| `docker history --no-trunc tanbot-readonly-check:4b671c5` | **no leak** |

Raw `docker inspect` of a **running** container with runtime env was **not** copied into this document (avoid echoing runtime secrets).

## Verifier (end-to-end)

With `DOCKER_HOST=unix:///tmp/tanbot-docker-run/docker.sock`:

```bash
npm run verify:tanbot-readonly-check
# VERIFY_TANBOT_READONLY: node=PASS docker=PASS
```

## Summary status

| Gate | Status |
|------|--------|
| BUILD | **PASS** |
| RUN (disabled/local/config-error) | **PASS** |
| HISTORY | **PASS** |
| Prior unit/harness/PG/browser | **not re-run** (out of scope) |

## Cleanup performed

- Removed failed intermediate build container (`docker rm`).
- Removed temporary runtime `--env-file` after local run.
- Operator may stop isolated daemon: `sudo pkill -f 'dockerd --data-root=/tmp/tanbot-docker-data'` and delete `/tmp/tanbot-docker-data`, `/tmp/tanbot-docker-run` if no longer needed.
