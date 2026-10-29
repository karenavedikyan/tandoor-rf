# Tanbot — isolated read-only check (one-shot)

**Task:** `TANBOT-ISOLATED-READONLY-PREP-20261029`  
**Code branch:** `cursor/tanbot-telegram-server-stage1-20261029`  
**Scope:** run existing `tanbot-telegram-probe` CLI in an isolated, disposable runtime. **Not** the LK web app, **not** production deploy of the feature branch, **not** webhook/messages/polling.

## Why a separate packaging

The feature branch also carries unreleased Tan-Tracker work. Do **not** deploy that branch to the production cabinet just to validate `@TANDOOR_IBOT`. Use this one-shot image/process instead.

## Artifact

| Item | Purpose |
|------|---------|
| `Dockerfile.tanbot-readonly-check` | Builds a minimal image; `ENTRYPOINT` is the probe CLI only |
| `scripts/verify-tanbot-readonly-check.mjs` | Developer/CI sandbox check (synthetic token, no Telegram) |

Production `Dockerfile` / `npm start` / `dist/server.js` are **unchanged**.

## Build (operator or CI)

Replace `<SHA>` with the accepted commit (example: `6fcb918`).

```bash
git fetch origin cursor/tanbot-telegram-server-stage1-20261029
git checkout <SHA>
docker build -f Dockerfile.tanbot-readonly-check -t tanbot-readonly-check:<SHA> .
```

Image defaults: `TANBOT_TELEGRAM_ENABLED=false`, no `DATABASE_URL`, no HTTP port, no server bundle.

## Runtime configuration (secrets UI or `--env-file`)

Set variables in the host **secret store** or a local file **never committed to git**:

| Variable | Recommended for first run | Notes |
|----------|---------------------------|--------|
| `TANBOT_TELEGRAM_ENABLED` | `false` | Master switch; `false` → `DISABLED`, no network |
| `TANBOT_TELEGRAM_BOT_TOKEN` | *(secret field)* | From BotFather; **runtime only** |
| `TANBOT_TELEGRAM_EXPECTED_USERNAME` | `TANDOOR_IBOT` | Optional override |
| `TANBOT_TELEGRAM_REQUEST_TIMEOUT_MS` | `15000` | Optional |
| `TANBOT_TELEGRAM_MAX_RESPONSE_BYTES` | `65536` | Optional |

Do **not** pass the token on the command line, in build-args, or in image labels.

### CLI vs `:local` npm scripts (on a dev machine with repo checkout)

| Command | Env source |
|---------|------------|
| `npm run tanbot-telegram-probe` | Inherited **runtime** env of the shell/host (production-style) |
| `npm run tanbot-telegram-probe:local` | Requires `.env` file via `node --env-file=.env` |

The Docker image behaves like **`tanbot-telegram-probe`** (runtime env from platform/`--env-file`), not `:local`.

## Operator flow

### 1. Pin version

Record git `<SHA>` and image tag `tanbot-readonly-check:<SHA>`.

### 2. Provision token

Owner pastes the bot token into the **protected secret field** of the chosen runtime (Timeweb app variables, local `--env-file`, etc.). Do not send the token in chat, tickets, or git.

### 3. Disabled smoke (no Telegram HTTP)

```bash
docker run --rm tanbot-readonly-check:<SHA>
```

Expect JSON `status: "DISABLED"`, exit code **0**.  
With `ENABLED=false`, token validity is **not** checked.

### 4. Local validation (no `--live`, no Telegram HTTP)

Set `TANBOT_TELEGRAM_ENABLED=true` and token in secrets, then:

```bash
docker run --rm --env-file /secure/tanbot.env tanbot-readonly-check:<SHA>
```

Expect `status: "LOCAL_OK"`, exit **0**.

### 5. Live read-only (only after explicit owner approval)

Same secrets, add probe flag:

```bash
docker run --rm --env-file /secure/tanbot.env tanbot-readonly-check:<SHA> --live
```

Expected sequence:

1. `getMe` — verify bot identity vs `TANDOOR_IBOT`
2. If username matches → `getWebhookInfo` only  
3. No `getUpdates`, `setWebhook`, `deleteWebhook`, or `sendMessage`

Outcomes:

| Status | Action |
|--------|--------|
| `SUCCESS` | Save **sanitized** JSON only; no raw URLs, no token, no full webhook host in public tickets |
| `AUTH_FAILED` / `USERNAME_MISMATCH` / other errors | **Stop**; no auto token rotation, no webhook changes, no retry loops |

Empty webhook URL **does not** prove the bot is unused (polling elsewhere is possible). Silent `/start` is **not** diagnosed in stage 1.

### 6. Teardown

Container exits after the report. Remove temporary env files, delete one-off cloud resources if created, do not leave a long-running “probe app” unless you accept platform auto-restart behaviour (see hosting notes below).

Disabling integration later: set `TANBOT_TELEGRAM_ENABLED=false` on the **main** app when merged — **no token rotation** required for ordinary rollback ([stage-1 runbook](./tanbot-telegram-stage1-runbook.md)).

## Timeweb Cloud — placement and cost (public docs, 2026-10-29)

### Confirmed

| Topic | Source |
|-------|--------|
| App Platform targets **long-running** apps; backend deploys get Caddy/domain proxy | [App Platform overview](https://timeweb.cloud/docs/apps), [How it works](https://timeweb.cloud/docs/apps/how-it-works) |
| Custom **Dockerfile** deploy is supported | [Docker deploy](https://timeweb.cloud/docs/apps/deploying-with-docker) |
| **Стенды**: separate build/domain; up to **10** per app; backend/docker stands **free** on the **same VM** as the parent app; variables chosen per stand at creation (“выберите существующие или добавьте новые переменные”) | [Стенды](https://timeweb.cloud/docs/apps/stands) |
| Env/secrets via app **variables** UI | [Variables](https://timeweb.cloud/docs/apps/variables) |
| Frontend pricing example: **0,000495 ₽ per request** (4,95 ₽ / 10k) | [Frontend pricing](https://timeweb.cloud/docs/apps/frontend-pricing) |

### Not documented / unknown

- **One-shot / Job / Cron** mode without a persistent web process on App Platform — **not found** in official docs searched for this task.
- Exact **backend Docker app** monthly price for a minimal config — depends on server tariff selected in panel at deploy time; confirm under **App → configuration** or billing for project **ID2952081** / app **tandoor-rf ID258307**.
- Whether a stand **automatically inherits** all production secrets — docs say per-stand variable setup; treat inheritance as **unknown** until verified in panel for your app.

### Recommended hosting choice

1. **Preferred:** `docker run --rm` on an operator-controlled machine (laptop, CI runner, or existing VDS) using this Dockerfile — true one-shot, no LK deploy.
2. **Avoid:** deploying the **feature branch** to production **tandoor-rf** or cloning full production env to a stand for token tests.
3. **App Platform separate Docker app** named e.g. `tanbot-readonly-check` (proposed; **not created yet**): only if you accept that the platform expects a **continuous** service and may restart exited containers; delete the app after reading logs. Not equivalent to a native batch job.

## Sandbox verification (developers)

Synthetic token only:

```bash
npm run verify:tanbot-readonly-check
```

Covers: `DISABLED` / `LOCAL_OK` / `CONFIG_ERROR` without `DATABASE_URL`, optional Docker build/run, no token in stdout/stderr/image history (marker check).

## Next functional package (after real read-only smoke passes)

Not in scope now; requires separate product sign-off:

1. Inbound `/start` and update handling with verified transport
2. LK account ↔ Telegram user binding (consent + audit)
3. Webhook or approved inbound receiver with signature validation
4. Opt-in notifications with outbox, idempotency, retries, dead-letter
5. Staff vs external participant model; no silent tt56 scope expansion
6. MAX or other channels — only after explicit requirements

## References

- [Telegram getMe](https://core.telegram.org/bots/api#getme)
- [Telegram getWebhookInfo](https://core.telegram.org/bots/api#getwebhookinfo)
- [Stage-1 server runbook](./tanbot-telegram-stage1-runbook.md)
