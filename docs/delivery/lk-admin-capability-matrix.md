# LK admin capability matrix (role policy)

Policy date: 2026-10-29. **Admin** (`users.role = admin`) is the functional superset in LK: it includes director/ROP/regional/manager/assistant/coordinator Tan-tracker and client surfaces where implemented, plus administrative settings. This is a **role rule**, not a per-user grant, allowlist, or identity substitution.

| Area | Admin | Notes |
|------|-------|-------|
| Tan-tracker write (own account) | **Implemented** | `tanTrackerCanWrite`: preview read-only still blocks; admin no longer denied. |
| Tan-tracker read scope | **Implemented** | `canViewOrder`: admin same as director (all transfers). |
| Tan-tracker recipients (no 1C link) | **Implemented** | Bootstrap catalog of active permitted users; `tt-user:<uuid>` materializes `tt_parties` on create. |
| Tan-tracker handoff OTP | **Unchanged validation** | Only the real pending holder/recipient confirms codes; admin cannot bypass OTP as another person. |
| Clients / sales API | **Already supported** | Existing `admin` / `fullClientBase` paths preserved. |
| Assignments assistant search | **Implemented** | `/assignments/assistants` allows admin in addition to manager/coordinator. |
| Assignment reviews (manager feedback) | **Still limited** | Reviews remain tied to the assigning manager identity; no admin impersonation of another user's rating. |
| Preview «Войти как» | **Read-only** | `preview.readOnly` blocks mutations across LK including Tan-tracker. |

Verification: `test/unit/lk-role-capabilities.test.ts`, `test/integration/tan-tracker-admin-unlinked.test.ts`, `test/browser/tan-tracker-lk-write-capability.browser.test.ts`.
