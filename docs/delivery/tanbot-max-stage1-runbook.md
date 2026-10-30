# Tanbot MAX — stage 1 (server prep + LK linking, read-only probe)

**Task:** `TANBOT-MAX-STAGE1-20261029`  
**Expected bot nickname (live check only):** `id231100522180_bot` (display name «Tandoor» in cabinet — not a substitute for API `user_id`)  
**Scope:** MAX transport (`GET /me`, `GET /subscriptions`), TLS CA bundle, LK linking UI/API, webhook receiver (secret, dedup, inbox), notification outbox + worker (default off). **No** `POST /subscriptions`, **no** live messages, **no** production activation.

## Limits (this stage)

- Mock/synthetic tests and local `LOCAL_OK` diagnostics **do not** mean MAX is connected in production.
- Computer credential-proxy TLS/`502` is **outside** this backend; configuring `TANBOT_MAX_TLS_CA_BUNDLE` on LK does not fix that proxy.
- `--tls-probe` calls `GET /me` **without** a token and treats **401** as success (TLS + reachability only).
- Never commit tokens, webhook secrets, or private keys. The **public** Russian trusted CA PEM shipped in-repo is allowed (see below).

## Vendored TLS CA (public PEM only)

Official source (verified HTTPS download, do not substitute unofficial mirrors):

- URL: [https://gu-st.ru/content/downloads/Russian_Trusted_CA.pem](https://gu-st.ru/content/downloads/Russian_Trusted_CA.pem)
- Repo path: `certs/max/Russian_Trusted_CA.pem`
- SHA-256 (whole file): `6d1b66e7c1aa2512ad3abb50d6a6f144c9ee9d80fd7fbe1c9255a39f8e790944`
- PEM blocks (2× CA, no private key):
  - **Russian Trusted Sub CA** — SHA-256 fingerprint `BB:BD:E2:10:3E:79:0B:99:9E:C6:2B:D0:3C:F6:25:A5:A2:E7:C3:16:E1:0A:FE:6A:49:0E:ED:EA:D8:B3:FD:9B`; notAfter **2027-03-06**
  - **Russian Trusted Root CA** — notAfter **2032-02-27** (root; `CA:TRUE`)

Production image copies the directory to **`/app/certs/max/`** (see root `Dockerfile`). When MAX is enabled later, set **`TANBOT_MAX_TLS_CA_BUNDLE=/app/certs/max/Russian_Trusted_CA.pem`** on the app host only (not set by default; MAX flags remain off).

**Rollback:** unset `TANBOT_MAX_TLS_CA_BUNDLE` or point to a previous PEM revision; redeploy without changing MAX master/webhook/delivery flags unless separately approved.

## Environment (server process only)

| Variable | Default | Purpose |
|----------|---------|---------|
| `TANBOT_MAX_ENABLED` | `false` | Master switch |
| `TANBOT_MAX_BOT_TOKEN` | empty | Bot token (server secret store) |
| `TANBOT_MAX_EXPECTED_USERNAME` | `id231100522180_bot` | Username check on live `GET /me` |
| `TANBOT_MAX_BOT_USERNAME` | same as expected | Deep link `https://max.ru/<nick>?start=…` |
| `TANBOT_MAX_TLS_CA_BUNDLE` | empty | Path to **official** Russian trusted CA PEM (MinDigital chain per [MAX API docs](https://dev.max.ru/docs-api)); image default file **`/app/certs/max/Russian_Trusted_CA.pem`** when operator enables MAX |
| `TANBOT_MAX_LINK_TOKEN_PEPPER` | empty | HMAC pepper for link tokens (≥16 chars when enabled) |
| `TANBOT_MAX_WEBHOOK_ENABLED` | `false` | Expose `POST /api/tanbot-max/webhook` |
| `TANBOT_MAX_WEBHOOK_SECRET` | empty | Matches MAX `X-Max-Bot-Api-Secret` (≥16 when webhook on) |
| `TANBOT_MAX_DELIVERY_ENABLED` | `false` | Send webhook replies / outbox via `POST /messages` |
| `TANBOT_MAX_OUTBOX_WORKER_ENABLED` | `false` | In-process worker loop |
| `APP_ORIGIN` | — | Required when MAX enabled (LK URLs in bot replies) |

Telegram flags are independent; toggling MAX must not change Telegram state.

## Read-only diagnostics

```bash
npm run build
npm run tanbot-max-probe:local
# expect status DISABLED or LOCAL_OK

# TLS reachability without token (401 = OK):
npm run tanbot-max-probe:local -- --tls-probe

# After owner approves token on server:
npm run tanbot-max-probe:local -- --live
```

Admin (session): `GET /api/admin/tanbot-max/diagnostics?live=1` or `?tls_probe=1`.

## Future webhook/delivery activation (operator — not in this stage)

1. Install trusted TLS cert on public HTTPS :443 endpoint.
2. Set `TANBOT_MAX_WEBHOOK_SECRET`, `TANBOT_MAX_WEBHOOK_ENABLED=true`, deploy.
3. Owner-approved `POST https://platform-api2.max.ru/subscriptions` with `update_types` including `bot_started`, `message_created`, `bot_stopped`, and the same `secret`.
4. Enable `TANBOT_MAX_DELIVERY_ENABLED` and `TANBOT_MAX_OUTBOX_WORKER_ENABLED` only after linking tests on staging.
5. Rollback: set master `TANBOT_MAX_ENABLED=false` (and delivery/webhook flags false); no requirement to rotate token for ordinary disable.

## Undelivered / ambiguous sends

Outbox marks `sent` only after MAX API success JSON. Network timeout after an accepted request may leave delivery ambiguous; rows retry until `failed` or `sent`. External exactly-once is not guaranteed.
