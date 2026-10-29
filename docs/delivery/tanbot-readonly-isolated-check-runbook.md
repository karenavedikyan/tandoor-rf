# Tanbot — isolated read-only check (one-shot)

**Task:** `TANBOT-ISOLATED-READONLY-PREP-20261029`  
**Code branch:** `cursor/tanbot-telegram-server-stage1-20261029`  
**Scope:** run existing `tanbot-telegram-probe` CLI in an isolated, disposable runtime. **Not** the LK web app, **not** production deploy of the feature branch, **not** webhook/messages/polling.

## Version pins (do not confuse)

| Label | Meaning | Example |
|-------|---------|---------|
| **Runtime stage-1** | Accepted probe/transport/validator on the server path (no packaging Dockerfile required) | `6fcb91805811782f56ff7c7468a4b83ae8ba1430` |
| **Packaging commit** | Git commit that **contains** `Dockerfile.tanbot-readonly-check` and passed packaging review | Set `<PACKAGING_SHA>` after independent sign-off (must not be a runtime-only SHA) |

Building the image from `6fcb918` ** fails preflight** — that commit has no packaging Dockerfile.

## Why a separate packaging

The feature branch also carries unreleased Tan-Tracker work. Do **not** deploy that branch to the production cabinet just to validate `@TANDOOR_IBOT`. Use this one-shot image/process instead.

## Artifact

| Item | Purpose |
|------|---------|
| `Dockerfile.tanbot-readonly-check` | Image with probe CLI `ENTRYPOINT` (HTTP server is **not started**) |
| `scripts/verify-tanbot-readonly-check.mjs` | Developer/CI check (synthetic token) |
| `scripts/tanbot-readonly-packaging-preflight.mjs` | Verify chosen commit contains the packaging Dockerfile |

Production `Dockerfile` / `npm start` / `dist/server.js` are **unchanged**.

## Build (operator or CI)

### 1. Preflight (required before build)

Replace `<PACKAGING_SHA>` with the **full** accepted packaging commit (update this placeholder when packaging is signed off — do not use `main`, a branch name, or `:latest`).

```bash
git fetch origin cursor/tanbot-telegram-server-stage1-20261029
npm run verify:tanbot-readonly-preflight -- <PACKAGING_SHA>
# Expect: PREFLIGHT_OK: Dockerfile.tanbot-readonly-check exists at <PACKAGING_SHA>
```

Manual equivalent:

```bash
git cat-file -e "<PACKAGING_SHA>:Dockerfile.tanbot-readonly-check"
```

On runtime-only commits (e.g. `6fcb918…`) this exits **128** — do not proceed to `docker build`.

### 2. Checkout and build

```bash
git checkout <PACKAGING_SHA>
docker build -f Dockerfile.tanbot-readonly-check -t tanbot-readonly-check:<PACKAGING_SHA> .
```

Image defaults: `TANBOT_TELEGRAM_ENABLED=false`, no `DATABASE_URL`, no `PORT`/`EXPOSE`.  
The image **includes** compiled `dist/` (including `dist/server.js`), but the **ENTRYPOINT runs only** `dist/cli/tanbot-telegram-probe.js` — the cabinet server is not started.

## Runtime configuration

Provide variables at **runtime** via platform UI or `--env-file` (file must not be committed). Public Timeweb docs describe [local and global variables](https://timeweb.cloud/docs/apps/variables); they do **not** document guaranteed secret masking — verify how your chosen UI stores sensitive values before entering a bot token.

| Variable | Recommended for first run | Notes |
|----------|---------------------------|--------|
| `TANBOT_TELEGRAM_ENABLED` | `false` | Master switch; `false` → `DISABLED`, no network |
| `TANBOT_TELEGRAM_BOT_TOKEN` | *(runtime secret)* | From BotFather; never in git/build-args/argv |
| `TANBOT_TELEGRAM_EXPECTED_USERNAME` | `TANDOOR_IBOT` | Optional override |
| `TANBOT_TELEGRAM_REQUEST_TIMEOUT_MS` | `15000` | Optional |
| `TANBOT_TELEGRAM_MAX_RESPONSE_BYTES` | `65536` | Optional |

Do **not** pass the token on the command line, in build-args, or in image labels.

### CLI vs `:local` npm scripts (repo checkout on a dev machine)

| Command | Env source |
|---------|------------|
| `npm run tanbot-telegram-probe` | Inherited **runtime** env of the shell/host |
| `npm run tanbot-telegram-probe:local` | Requires `.env` via `node --env-file=.env` |

The Docker image behaves like **`tanbot-telegram-probe`** (runtime env from platform/`--env-file`), not `:local`.

## Operator flow

### 1. Pin packaging SHA

Record `<PACKAGING_SHA>` and image tag `tanbot-readonly-check:<PACKAGING_SHA>`.

### 2. Provision token

Owner enters the bot token only in a runtime mechanism they treat as confidential (local `--env-file` with restrictive permissions, or host-specific secret storage after verifying UI behaviour). Do not send the token in chat, tickets, or git.

### 3. Disabled smoke (no Telegram HTTP)

```bash
docker run --rm tanbot-readonly-check:<PACKAGING_SHA>
```

Expect JSON `"status": "DISABLED"`, exit **0**. With `ENABLED=false`, token validity is **not** checked.

### 4. Local validation (no `--live`)

Set `TANBOT_TELEGRAM_ENABLED=true` and token at runtime, then:

```bash
docker run --rm --env-file /secure/tanbot.env tanbot-readonly-check:<PACKAGING_SHA>
```

Expect `"status": "LOCAL_OK"`, exit **0**.

### 5. Live read-only (only after explicit owner approval)

```bash
docker run --rm --env-file /secure/tanbot.env tanbot-readonly-check:<PACKAGING_SHA> --live
```

Sequence: `getMe` → if username matches `TANDOOR_IBOT`, then `getWebhookInfo` only. No polling, webhook mutations, or messages.

| Status | Action |
|--------|--------|
| `SUCCESS` | Save **sanitized** JSON only |
| `AUTH_FAILED` / `USERNAME_MISMATCH` / other | **Stop**; no auto rotation, webhook changes, or retry loops |

Empty webhook URL does not prove the bot is unused. `/start` is not in stage 1.

### 6. Teardown

Process exits after printing the report. Remove temporary env files. Do not rely on App Platform as a documented one-shot job (see below).

Rollback on main app when merged: `TANBOT_TELEGRAM_ENABLED=false` — no token rotation for ordinary disable ([stage-1 runbook](./tanbot-telegram-stage1-runbook.md)).

## Timeweb Cloud — placement (public docs, 2026-10-29)

### Confirmed

| Topic | Source |
|-------|--------|
| Long-running apps; Caddy/domain for backends | [Apps](https://timeweb.cloud/docs/apps), [How it works](https://timeweb.cloud/docs/apps/how-it-works) |
| Custom Dockerfile deploy | [Docker deploy](https://timeweb.cloud/docs/apps/deploying-with-docker) |
| **Стенды**: separate build/domain; up to 10; backend/docker stands free on **same VM** as parent; variables chosen per stand | [Стенды](https://timeweb.cloud/docs/apps/stands) |
| Variables (local/global) | [Variables](https://timeweb.cloud/docs/apps/variables) |

### Unknown / not documented

- Native **one-shot / batch / Cron job** without a persistent web process.
- Process **restart policy** when the container main process exits ([How it works](https://timeweb.cloud/docs/apps/how-it-works) does not specify this).
- Automatic **inheritance** of all production secrets onto a stand.
- Guaranteed **secret masking** for every variable field in the panel.

### Recommended hosting

**Preferred:** `docker run --rm` on operator-controlled hardware (workstation, CI, or an existing VDS shell) — matches one-shot semantics.

**Avoid:** deploying the unreleased feature branch to production **tandoor-rf**; cloning full production env to a stand for token tests.

**Do not use** a separate always-on App Platform Docker app as a substitute for one-shot live diagnostics unless lifecycle, restart behaviour, and secret handling are verified separately and the owner explicitly accepts a non-batch process model.

Backend pricing depends on the server tariff chosen at deploy time — confirm in the Timeweb panel (project **ID2952081**, app **258307**). Frontend per-request pricing ([frontend-pricing](https://timeweb.cloud/docs/apps/frontend-pricing)) does not apply to this CLI path.

## Sandbox verification (developers)

```bash
npm run verify:tanbot-readonly-check
```

Report line distinguishes outcomes:

- `VERIFY_TANBOT_READONLY: node=PASS docker=PASS` — node checks and Docker build/run/history succeeded.
- `VERIFY_TANBOT_READONLY: node=PASS docker=NOT_RUN reason=…` — node checks only; **not** full container proof.

Preflight regression (in unit tests): `6fcb918…` fails; current packaging commit passes.

## Next functional package (after real read-only smoke)

Separate sign-off: `/start`, LK binding, inbound updates, opt-in notifications (outbox/idempotency), staff vs external participants, MAX — not implemented here.

## References

- [Telegram getMe](https://core.telegram.org/bots/api#getme)
- [Telegram getWebhookInfo](https://core.telegram.org/bots/api#getwebhookinfo)
- [Stage-1 server runbook](./tanbot-telegram-stage1-runbook.md)
