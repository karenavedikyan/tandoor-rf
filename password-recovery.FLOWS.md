# Password recovery acceptance

Scope: existing login and admin access pages, preserving branding, roles, bot identities and data.
No production migration, publication, real messages or deployment without separate approval.

## Existing flows
- Login with valid credentials; invalid credentials show an error.
- A temporary password redirects to mandatory change before business APIs are usable.
- Admin access search and overview remain available; non-admin access remains denied.
- Employee preview cannot mutate data or request employee recovery.

## Employee recovery requested by admin
- Настройка доступа: exact employee email, own admin password, reason, MAX/Telegram and consent.
- Code goes only to the authenticated administrator's confirmed, non-stopped bot, never a supplied chat/phone.
- The message names the employee (full name and login) and authenticated requesting admin (full name and login).
- Admin targets and self-reset through this endpoint are denied; self-service remains available.
- Requesting does not alter the employee's current password or sessions.

## Self-service recovery and restricted login
- Login: Забыли пароль?, own login, MAX/Telegram, Восстановить пароль через бота.
- Employee requests deliver only to the server-configured administrator's confirmed bot; no employee bot is required.
- Administrator self-recovery delivers only to that administrator's own confirmed bot.
- Missing/invalid recipient configuration fails closed; HTTP input cannot choose or override the recipient.
- No password/session changes occur until the administrator personally verifies the employee and shares the code.
- Public response is generic across unknown accounts, unavailable bots and successful requests.
- Messages explicitly state that unauthenticated initiator identity is not yet verified.
- Existing code: select Войти по временному коду из бота, enter login and code.
- Code expires after 10 minutes, allows 5 verification attempts, and is consumed on one login.
- Valid redemption revokes previous sessions, rotates old password and forces password change.
- In the change form enter the same code as current password and choose a permanent 12+ character password.
- Business APIs stay blocked until change. Consumed code cannot log in through either login endpoint.
- Stopped/rebound bot, disabled account, changed credentials, revoked initiating admin session and stale code fail closed.
- Delivery uses existing bounded bot transports synchronously; no plaintext code in DB, audit, outbox or API.
- No reserved offline keys, new credentials, scheduled jobs, real-user messages or production migration in this patch.
- Before release configure PASSWORD_RECOVERY_ADMIN_USER_ID with the separately approved administrator account ID.

## QA
- Synthetic integration tests cover transactions, rollback on audit failure, authorization,
  concurrent reuse, session revocation, no role changes, code HMAC and HTTP CSRF/rate limits.
- Browser checks cover actual forms, channel selection, code mode, login and mandatory change.
- Check login and expanded recovery forms at desktop and 375px; check browser errors.
