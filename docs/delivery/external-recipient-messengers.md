# External recipient: Telegram / MAX (production)

## Feature flag

- `TT_EXTERNAL_MESSENGER_ENABLED=true` — enables messenger portal and bot `/start er…` tokens (non–user-test environments).
- `TT_USER_TEST_ENV=true` additionally requires `TT_EXTERNAL_MESSENGER_IN_USER_TEST=true` (does not bypass user-test guard or enable real bots by itself).

## Migrations

- `060_tt_external_messenger_sessions.sql` — session table (hashed start token, transfer scope).
- `061_tt_external_messenger_chat_bind.sql` — chat binding for contact follow-up.

## Secrets / config (no values in repo)

- Reuses `TT_OTP_PEPPER` for start-token HMAC.
- Telegram: existing `TANBOT_TELEGRAM_*` (bot must be configured for channel availability).
- MAX: `TANBOT_MAX_ENABLED` + optional `TANBOT_MAX_BOT_PUBLIC_LINK` template for deep links.

## API

- `POST /api/tan-tracker/transfers/:id/messenger-invite` (LK, CSRF) — mints `er…` token + portal URL.
- `GET /api/tan-tracker/public/recipient/messenger?mst=…` — channel availability + deep links (no OTP in response).

## Rollout

Enable flag in staging after migrations; configure Telegram bot webhook only via existing ops process (Cursor does not change live webhooks).

## Telegram external-notice navigation

External-person notices disable link previews, including in rich mode. A preview
of the generic `/tan-tracker/` page is a separate clickable destination without
external credentials and opens staff login. Do not replace it with a preview of
the private capability URL: preview requests must not carry capability tokens.
Keep the existing external URL button or the “Мои передачи” callback, which
issues a fresh external session after checking the messenger identity.

This presentation change does not change external authorization, session TTLs,
bot bindings, roles, OTP, or MAX delivery. A reported production incident still
needs live confirmation; finding this navigation path does not establish which
link a particular user clicked.
