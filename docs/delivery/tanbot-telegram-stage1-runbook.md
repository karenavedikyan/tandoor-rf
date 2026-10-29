# Tanbot Telegram — stage 1 (server prep, read-only)

**Task:** `TANBOT-TELEGRAM-SERVER-STAGE1-20261029`  
**Bot (expected):** `@TANDOOR_IBOT`  
**Scope:** configuration, read-only Telegram adapter (`getMe`, `getWebhookInfo`), local/live diagnostics. **No** webhook registration, **no** outbound messages, **no** production activation.

## Important limits

- Saving the token in a personal password manager or on a workstation **does not** copy it to the LK server or to Cursor.
- Real provision on Timeweb (or other hosting) is a **separate controlled step** after independent acceptance of this code.
- An empty webhook URL from `getWebhookInfo` **does not** prove the bot is unused (polling or another backend may exist).
- Do **not** call `getUpdates`, `setWebhook`, `deleteWebhook`, or send messages during stage 1 diagnostics.

## Environment (server process only)

| Variable | Default | Purpose |
|----------|---------|---------|
| `TANBOT_TELEGRAM_ENABLED` | `false` | Master switch; when false, no Telegram HTTP and no background work |
| `TANBOT_TELEGRAM_BOT_TOKEN` | empty | Bot token from BotFather (server secret store only) |
| `TANBOT_TELEGRAM_EXPECTED_USERNAME` | `TANDOOR_IBOT` | Username check on live `getMe` |
| `TANBOT_TELEGRAM_REQUEST_TIMEOUT_MS` | `15000` | Per-request timeout |
| `TANBOT_TELEGRAM_MAX_RESPONSE_BYTES` | `65536` | Response size cap |

Copy names and empty placeholders from `.env.example` only. Never commit real tokens, PR screenshots, or logs containing token material.

## Safe provision on existing hosting (after code acceptance)

1. Set `TANBOT_TELEGRAM_ENABLED=false` first; deploy or restart the app and confirm behaviour unchanged.
2. Add `TANBOT_TELEGRAM_BOT_TOKEN` in the host **secret** UI (not in git, not in frontend env).
3. Keep `TANBOT_TELEGRAM_ENABLED=false` until a named owner approves live checks.
4. Run **local** diagnostics on the server (no network):

   ```bash
   npm run tanbot-telegram-probe:local
   ```

   Expect `status: "DISABLED"` or `LOCAL_OK` depending on `ENABLED`.

5. When approved for read-only live check: set `TANBOT_TELEGRAM_ENABLED=true`, restart, then:

   ```bash
   npm run tanbot-telegram-probe:local -- --live
   ```

   Or as technical admin (session cookie): `GET /api/admin/tanbot-telegram/diagnostics?live=1`

6. Review JSON: username match, webhook present/empty, pending update count, last webhook error (sanitized). **Do not** paste full JSON into public tickets if it might contain webhook host hints you consider sensitive.

7. To roll back integration only: set `TANBOT_TELEGRAM_ENABLED=false` and restart. **Token rotation is not required** for ordinary disable of the new flag. Rotate the bot token in BotFather only if compromise is suspected or confirmed, with owner approval — that is separate from turning off `TANBOT_TELEGRAM_ENABLED`.

## Log hygiene

- Application code must not log `TANBOT_TELEGRAM_BOT_TOKEN` or Telegram URLs containing the token.
- If live diagnostics fail, use sanitized CLI/JSON output only; scrub operator copies before sharing.

## Next stage (plan only — not implemented here)

1. Confirmed LK account ↔ Telegram user binding with explicit user consent and audit.
2. Disable/rebind flows and support tooling for admins.
3. Inbound update receiver (webhook or approved transport) with signature/secret validation.
4. Outbox, idempotency keys, retry policy, and dead-letter handling for outbound notifications.
5. Separate data model for external participants vs staff; no broad tt56 rule changes without product sign-off.
6. Explicit opt-in for message types (handoff reminders, codes policy alignment with SMS).

## Stage 1 acceptance evidence

- Unit tests with mock transport (no real token).
- `typecheck`, `build`, unit suite green on the feature branch.
- PostgreSQL integration / browser smoke: run on host CI or operator environment; cloud sandbox may lack PostgreSQL.
