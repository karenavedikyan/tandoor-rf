# External transfers on main site — delivery runbook

Approved prototype: branch `cursor/prototype-registry-recovery-20261030`, commits `d078894` → `f0da061` → `3b3c98f`. Production branch: `cursor/upload-invite-flow-problems-e22b`.

## Scope map (approved → implementation status)

| Block | Status in repo | Notes |
|-------|----------------|-------|
| Delivery vs explicit close | **In progress** | `delivered`; creator may close after delivery while external holds; holder token bound to `handoff_version` + open status |
| Holder URL renewal | **In progress** | Expired signature refresh only while still holder on open transfer; invalid after close or `hv` bump |
| External «Мои передачи» shell | **Partial** | `est`/`cap` bootstrap, `partyId` actor; prototype wizard port still pending |
| Bot 6-step external request + photos | **Partial** | Telegram + MAX bot flows; bounded image fetch; review blockers fixed in `391fbaa+` |
| Global phone-first contacts dedupe | **Partial** | `070_tt_phone_dedupe_conflicts` + admin refresh API |
| Step LK notifications + outbox matrix | **Partial** | `tt_lk_notifications` + bell UI; extend event matrix on handoff/decline |
| Admin «принимает заявки от внешних» | **Partial** | `PATCH .../external-intake`; profile UI pending |
| Mobile/code dock/feedback collision | **Partial** | Prototype CSS; production port pending |

**Do not deploy** until Computer completes remaining phases and QA on synthetic DB.

## Migrations (order)

| File | Purpose |
|------|---------|
| `064_tt_transfers_delivered_status.sql` | `delivered`, `delivered_at`, `from_external` flag |
| `065`–`068` | External persons, drafts, LK notifications, intake flag |
| `069_tt_external_request_confirm_idempotency.sql` | `confirmed_transfer_id`, external decline outbox |
| `070_tt_phone_first_dedupe_report.sql` | Admin phone conflict report |

Dry-run: apply on staging clone; `completed` rows must remain `completed`; no backfill of `delivered`.

Rollback 064: only if no rows use `delivered` — otherwise forward-fix.

## Env (no secrets in repo)

Existing: `TT_OTP_PEPPER`, `TANBOT_*`, `TT_EXTERNAL_MESSENGER_ENABLED`, S3 attachment config.

## Verification commands (Computer)

```bash
npm run typecheck && npm run build && npm test
npm run test:integration -- test/integration/tan-tracker-delivered-status.test.ts test/integration/tan-tracker-external-person-blockers.test.ts
TANBOT_STAGE2_BROWSER_SMOKE=1 npm run test:browser -- test/browser/tan-tracker-*.browser.test.ts
```

## Session rule (external person)

- New browser session (`est`) does **not** bump `access_epoch`; other devices stay valid.
- **Logout all** (`POST /api/tan-tracker/public/external/logout-all`) bumps `access_epoch` and revokes sessions.
- Own-contact verification in messengers is separate from staff OTP handoff codes.

## Remaining limitations (explicit)

- External bot menus «Мои передачи» / «Отправить предмет» need end-to-end QA on Computer.
- No production backfill of notifications; no SMS promises in copy.
- Prototype demo storage / OTP reveal must not be copied to production.
