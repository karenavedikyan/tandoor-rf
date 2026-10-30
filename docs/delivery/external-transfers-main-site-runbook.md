# External transfers on main site — delivery runbook

Approved prototype: branch `cursor/prototype-registry-recovery-20261030`, commits `d078894` → `f0da061` → `3b3c98f`. Production branch: `cursor/upload-invite-flow-problems-e22b`.

## Scope map (approved → implementation status)

| Block | Status in repo | Notes |
|-------|----------------|-------|
| Delivery vs explicit close | **Phase 1 in 064+** | `delivered` status; `completed` only via explicit close |
| Holder URL renewal | **Phase 1** | Signature-valid expired token refresh while still holder |
| External «Мои передачи» shell | **Not in this slice** | Prototype in `site/tan-tracker.js`; port to `public/tan-tracker/*` |
| Bot 6-step external request + photos | **Not in this slice** | Needs drafts, media ingest, intake employees, limit 5 |
| Global phone-first contacts dedupe | **Not in this slice** | Migration + admin UX + conflict report |
| Step LK notifications + outbox matrix | **Not in this slice** | Extend `tanbot_notification_outbox` + bell center |
| Admin «принимает заявки от внешних» | **Not in this slice** | Role guard on `users` / employee profile |
| Mobile/code dock/feedback collision | **Partial** | Prototype CSS; production port pending |

**Do not deploy** until Computer completes remaining phases and QA on synthetic DB.

## Migrations (order)

| File | Purpose |
|------|---------|
| `064_tt_transfers_delivered_status.sql` | `delivered`, `delivered_at`, `from_external` flag |
| (planned) `065_tt_external_person_capability.sql` | Verified external identity sessions |
| (planned) `066_tt_external_requests.sql` | External-origin tracks + decline |
| (planned) `067_tt_lk_notifications.sql` | In-app notification rows |
| (planned) `068_users_external_intake.sql` | Staff intake flag |

Dry-run: apply on staging clone; `completed` rows must remain `completed`; no backfill of `delivered`.

Rollback 064: only if no rows use `delivered` — otherwise forward-fix.

## Env (no secrets in repo)

Existing: `TT_OTP_PEPPER`, `TANBOT_*`, `TT_EXTERNAL_MESSENGER_ENABLED`, S3 attachment config.

## Verification commands (Computer)

```bash
npm run typecheck && npm run build && npm test
npm run test:integration -- test/integration/tan-tracker-delivered-status.test.ts
TANBOT_STAGE2_BROWSER_SMOKE=1 npm run test:browser -- test/browser/tan-tracker-*.browser.test.ts
```

## Remaining limitations (explicit)

- External bot menus «Мои передачи» / «Отправить предмет» not wired to backend list/create APIs.
- No production backfill of notifications; no SMS promises in copy.
- Prototype demo storage / OTP reveal must not be copied to production.
