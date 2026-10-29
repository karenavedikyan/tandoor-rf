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
