# Registry deletion: confirmed bot drafts

## Scope

Fix deletion of authorized Tan-Tracker transfers created through bot drafts.
No permission, OTP, invitation, webhook, environment, worker, schema, or frontend
changes. Publication is separate from deployment and from deleting live tracks.

## Reproduction

`tt_external_request_drafts.confirmed_transfer_id` references a transfer with
`ON DELETE SET NULL`. The partial unique index
`tt_external_request_drafts_active_chat_uq` permits only one row with a null
confirmed transfer per channel and chat.

Deleting a confirmed transfer previously converted its historical bot draft
into an unconfirmed draft. If that chat already had an active draft, or two
confirmed transfers from the chat were deleted in one batch, PostgreSQL raised
23505 on the partial index. The cleanup transaction rolled back and the endpoint
returned 503 with the generic action-failed message. Without a conflicting row,
single deletion could silently revive a historical draft instead.

On the unmodified production base, the existing four admin-delete tests passed.
Two newly added regression cases both returned 503, with the local PostgreSQL
log identifying the partial unique index and the foreign-key SET NULL action.
This reproduces the observed live symptom; the production database was not
queried or modified to prove its exact row contents.

## Change

Inside the existing deletion transaction, after authorization and the custody
check, delete only draft rows whose `confirmed_transfer_id` equals the selected
internal transfer ID before deleting the transfer itself. Draft-file metadata
cascades with those rows. No active draft or draft for another transfer is
selected. Existing audit, notification cancellation, and transaction rollback
semantics remain in place.

## Acceptance

- Batch deletion with an active Telegram draft succeeds and preserves that draft.
- Other confirmed transfers, their drafts, and their file metadata remain intact.
- Multiple confirmed MAX drafts in one chat can be deleted without a conflict.
- Single deletion does not revive a historical draft.
- Associated draft-file metadata is removed, and deletion audit remains recorded.
- A non-admin denied deletion retains the protected confirmed draft.
- An aborted transaction restores the transfer, confirmed draft, and draft-file
  metadata and rolls back its deletion audit.
- Existing received/completed/archive, notification cleanup, director, creator,
  and read-only-preview protections remain covered.

## Deployment and live verification

No live tracks are deleted during development or publication. After an
independently authorized deployment, verify health/readiness and the published
revision without replaying the user's deletion. Live deletion remains a separate
explicit destructive action.

## Verification results

- Node 22, local isolated PostgreSQL 18; no production database credentials used.
- `npm run typecheck`, `npm run build`, and `git diff --check`: passed.
- `tan-tracker-registry-admin-delete.test.ts` and
  `tan-tracker-registry-cleanup.test.ts`: 14/14 integration tests passed.
- `npm test`: 1,434 tests passed. The pre-existing unit-file suite
  `external-person-outbox-delivery-target.test.ts` could not initialize without
  `TEST_DATABASE_URL` in that invocation; its two tests were then run separately
  against the local isolated database and both passed (1,436 successful unit
  checks across the two invocations, not one fully initialized invocation).
- No browser deletion replay or live mutation was performed. The frontend is
  unchanged; the regression scenarios exercise the real cleanup HTTP endpoint
  and PostgreSQL constraints using synthetic fixtures.
