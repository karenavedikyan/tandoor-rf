# Main flows

## Tan-tracker (document handoff prototype)
- Static `#tan-tracker` in the existing employee shell; nav label «Тан-трекер», subtitle «Передача документов и предметов», main CTA «Создать передачу». After all deferred scripts load, `syncShellNav()` re-renders the employee shell once so «Тан-трекер» appears on cold entry (no hash), `#exchange`, sales and other deep links without changing the current screen; assistant-only nav and external recipient shells stay unchanged.
- In-memory demo only: reload restores ≥18 synthetic transfers; banner «Демо-данные · изменения до обновления страницы»; no storage, SMS, or external APIs.
- Registry: search, status/overdue filters, reset, row/card open, desktop table scroll inside `.tt-table-scroll`, mobile cards at 375px.
- Create: item + recipient (pick or new phone), optional due/comment; creator stays holder, recipient pending; reject self, invalid phone, duplicate phone.
- Detail: transfer, enter code, open recipient demo screen, complete when holder with no pending, cancel pending, timeline; wrong/expired/replay/5-try code rules.
- Recipient URL `#tan-tracker?tt_view=recipient&tt_order=…` simplified shell without corporate nav; demo phone verify + one-time 6-digit code (5 min).
- External holder demo mode: limited registry/contacts; employee sections (clients, assignments, notifications, stars) unchanged on other routes.
- `tan-tracker-qa.js`: end-to-end clicks for create, codes, filters, privacy, 375/1440, theme toggle, reload reset. `tan-tracker-nav-qa.js`: cold entry and sidebar/mobile nav to tracker (≥20 rows), return via «Клиенты» (`exchange`), no duplicate nav after re-render. Regression: existing assistant QA scripts unchanged.

## Required star feedback
- Completion of the access period always revokes access on time. Business closure
  remains "Ожидает обязательной оценки" until the assigning manager sends a valid
  1–5-star score and comment. Returning from the form or reading a notification
  does not close the obligation. Other work in the cabinet remains accessible.
- A persistent personal reminder links to outstanding reviews; ROA/director see
  pending and closed-with-review status. Existing role privacy stays unchanged.
- Five SVG stars support hover/focus preview, selected fill through the chosen
  star, explicit numeric/text feedback and keyboard selection. Show stars in
  submitted reviews, tables and average summaries, light/dark and 375px.
- Check no-score/no-comment submission, returning without feedback, unread
  controls not clearing obligations, successful submission clearing only the
  matching obligation and keeping assistant access closed.
- Verified 23 new star/required-closure assertions plus all 141 prior feedback,
  scope, decision, audit, directory, fullscreen and picker assertions. No page
  errors. Global manager reminder also opens the correct form from Clients.
- Reviewed light/dark desktop and 375px star form and assistant summaries;
  1280x600 dialog scrolls to submit. New form labels measured at least 4.5:1.

## Notifications and completed-assignment feedback
- Preserve manager picker, coordinator-only decisions, director audit and assistant
  41/20-client shared directory, cards, sales, full screen and both scroll axes.
- Every role has a header bell, personal unread count, notification drawer,
  all/unread filters, individual/read-all controls and contextual navigation.
- Role/person changes isolate inbox/read flags. ROP receives information only,
  never approval requests. Assistant never sees scores, comments or rating notices.
- Assignment submit/decision/change/revocation and demo-time boundaries generate
  role-appropriate messages without duplicates; reset restores synthetic fixtures.
- Only the assigning manager may rate a completed assignment, once, 1–5 and
  a meaningful comment. Active, future, rejected/cancelled and paused assignments
  cannot be rated. Previously active revoked access may be rated after revocation.
- ROA and director have realistic multi-assistant review summaries, score/assistant/
  manager/search filters and full comments/period/client details. Manager sees own
  submissions only. ROP/assistant have no rating controls or results.
- Test invalid and duplicate submission, low-score attention, contextual links,
  privacy through role switching, read/unread cycles, time advancement and reset.
- Check 1440px/375px, light/dark, short-height and desktop/mobile transitions,
  readable labels, independent drawer/table scroll, Escape and focus return.
- Prototype only: no production changes, APIs, external channels or persistence.
- Feedback acceptance: 44 browser assertions cover role privacy, immutable reviews,
  contextual notification links, read states, reset, expiry reminders and deduplication.
  Revoked-before-start periods stay unrateable after clock advancement; actually
  started revoked periods use the real closing date in the review snapshot.
- Visual review: desktop/mobile, light/dark, inbox, editable/read-only review,
  short desktop window; no unexpected page overflow or page errors. Secondary
  labels in the review overview measured at least 5.52:1 light and 8.21:1 dark.
- Header bell also checked outside assignments in the main client directory.
- Synthetic only: no persistent ratings, real employee messages, external delivery,
  backend authorization or production deployment are asserted by this prototype.

## Role correction: coordinator is the head of assistants
- User clarified these are ONE role, not two people. Canonical role `coordinator`
  now owns the global review queue, approvals/returns/rejections/revocations,
  assignment preparation, access overview and work history.
- Remove the duplicate assistant-lead button/person. Old `assistant_lead` links
  alias to coordinator. One synthetic coordinator is used consistently in all
  sample decisions, new history events and the director journal.
- Coordinator covers all territories, not just the former South-team sample.
  Managers remain limited to their own clients; director/ROP stay read-only.
- Coordinator-created drafts are visible to their author, not treated as submitted
  review requests. Director journal also includes coordinator's preparation and
  submission activity, separately from decision types.
- Latest acceptance supersedes the earlier split-role design below.
- Verified: 24 coordinator/decision/audit assertions, 46 shared-directory scope
  assertions and 27 assignment-picker assertions passed without page errors.

## Current approval policy: single head of assistants
- Supersedes every earlier ROP/director-approval scenario below. All submitted
  requests and amendments from every territory enter the assistant lead's queue.
  Only `assistant_lead` can approve, reject or return them. ROP has read-only
  own-team visibility without a review queue; director is read-only globally.
- Add a distinct synthetic head of assistants (Olga Smirnova), not a renamed
  coordinator. Manager/coordinator remain request authors; coordinator still only
  covers their team. Unsubmitted drafts do not appear in the lead queue.
- Director opens a populated lead-activity journal by default: all decision types,
  timestamps, actor, manager, assistant, comments and access terms/client IDs.
  Snapshots retain proposed terms even for rejected amendments; later assignment
  changes cannot rewrite historical decisions. Equal-time events have sequence.
- Filter the journal by text, decision, assistant and inclusive decision dates;
  expand client lists and open underlying requests without approval/revoke controls.
- `assistant-lead-qa.js`: 22 assertions, including cross-territory approval, return,
  resubmission, rejection, amendment rejection, revocation, immutable snapshots,
  director/ROP restrictions, journal filtering and mobile containment.
- Updated shared-directory (46) and picker (26) suites also passed. Fresh mobile
  visual check confirms date filters and journal fit the screen; table scrolls
  horizontally within its container. All identities/data remain synthetic.

## Filter clients when creating or changing an assignment
- Manager's picker now covers the full synthetic 116-client owner portfolio;
  coordinator may choose either manager in their own team. Expanding this source
  does not grant any additional assistant access.
- Combine search by name/city/client ID/phone/INN/legal entity/contract with city,
  TOP category, selected sales month, inclusive revenue bounds, minimum legal
  entity and TT counts, and access-overlap status for the assignment dates.
- Sort by name or numeric sales in either direction. Missing sales are not zero
  and sort last; they are excluded when a revenue bound is set.
- Bulk select/deselect affects only current results; hidden choices remain.
  Show total selected and number hidden, offer selected-only and clear selection.
  Reset filters preserves choices. Changing owner clears choices and filters.
- Keep list scroll and keyboard focus when toggling a client. Recompute overlaps
  when dates change; assignment validation still blocks conflicting approved
  access. Requests/approval only grant the explicitly selected IDs.
- `assistant-picker-qa.js`: 26 browser assertions, including end-to-end approval.
  `assistant-directory-qa.js`: 46 shared directory/scope regression assertions.
  Desktop, mobile, light/dark visual review and selection scroll/focus checked.

## Realistic default demonstration data
- Default assistant Anna has 41 active assigned clients across four approved
  assignments from two managers. Pavel has 20 active assigned clients; the future
  assignment adds one client at its start, rather than being his entire portfolio.
- Reuse 60 additional unused canonical synthetic client records. Their legal
  entities, sales, contacts and TT remain linked to the existing directory.
- Empty access remains an explicit expiry/revocation scenario, not the normal
  design preview. Reset restores the populated portfolios.
- Default list pagination, fullscreen long-list scrolling, numeric sorting, narrow
  screens and light/dark themes must be tested with this volume.

## Current change: shared manager/assistant client directory
- Inspect existing manager fullscreen and assistant compact list before editing.
- Replace compact assistant list/card with the same client-directory engine as
  manager: list, TT, columns/order, all fields, typed filters, fullscreen search,
  per-column filters, sorting, card, legal sales detail, period and back.
- Scope all rows, totals, field suggestions, related TT and direct card links to
  active approved assigned client IDs. Reset/filter/fullscreen must not broaden it.
- No early/expired/revoked access; no task queue or real data writes.
- Validate scope under URL tampering, assistant switching and a scope change
  while fullscreen/card is open. Keep original manager/director workflows.
- Implemented by mounting the shared `exchangePrototype` directory in the
  assistant workspace. The row provider restricts both clients and trading points
  to active approved assignments. Direct card URLs are revalidated on every mount.
- Latest regression: `assistant-directory-qa.js`, 46 browser assertions passed,
  no page errors. Covers shared fields/columns, numeric sorting both directions,
  fullscreen filters/reset, actual two-axis scroll, legal sales drilldown, periods,
  mobile layout, dark theme, changed/revoked/future/expired assignments, actor
  switching and URL tampering. Original manager fullscreen still shows 116 clients.
- Direct assistant-client links survive a full reload; assistant-only routes are
  restored after the base app's earlier initialization. Numeric multivalue fields
  sort by the largest value in the cell, with the rule shown in the header tooltip.
- Previous compact assistant UI checks below are historical; the shared-directory
  suite supersedes their list/card selectors.

## First-stage assistant access, current acceptance criteria
- Supersedes the earlier assistant-task/report scenarios below.
- Assistant opens Clients by default; only active approved selected clients.
- Cards are read-only information: overview, existing synthetic sales/legal
  breakdown and all client fields. No task queue, task actions or handover reports.
- Keep create/draft/submit/approve/reject/return/change/revoke and period checks.
- No assignment means empty Clients; no early or expired card access.
- Old assistant-tasks / tasks-view hashes resolve to Clients, not a task screen.
- Existing manager client list/cards, sales, columns, fullscreen and navigation
  remain unchanged. Check desktop/mobile, light/dark and fresh deployed context.
- Current first-stage verification: assistant-stage1-qa.js, 31 browser checks
  passed. Existing sales numerical suite 7/7 passed. All nine base card sections,
  legal sales detail, period/list preservation, columns, fullscreen/Escape,
  empty search/reset, team navigation, Sales/Distribution/route rerun in browser.
  No pageerror events. Desktop light and 375px dark information/sales inspected;
  mobile document width stayed 375px. Historical extended QA below is superseded.

Baseline inspected in Chromium at 1440 × 1000 before editing. Existing synthetic
client directory, role scope, fullscreen registry and client card tabs work.

## Clients and territory navigation
- Start: Clients, Manager role.
- Open first visible client, use Back, then change Director role.
- Open a team, an employee and their client list. Back retains the territory.
- Regional role starts on outlets; access stays within the existing demo scope.

## Search, filters and empty result
- Search the client name, clear search and use City and Category.
- Open all-field filters, select a field and add a condition.
- A nonexistent client search shows No matches; reset restores the list.

## Columns and fullscreen
- Open Columns; toggle fields, reorder using arrows, close and reload.
- Selected columns and order remain in the URL; client name stays pinned.
- Enter fullscreen, use column filters and exit with Escape.
- Both normal and fullscreen selectors offer the new sales fields.

## Existing card sections and other screens
- Open a client and switch Data, Work, Showcase, Orders, Finance, Documents,
  Claims and Plan; no exception or missing existing content.
- Visit Sales, Distribution and route preparation, then return to Clients.

# Requested changes

## Immediately visible client sales
- Open any client: Overview shows sales total, quantity and active legal count
  for September 2026, followed by an already expanded legal-entity breakdown.
- Each legal row shows name, INN, sales, quantity and share of the client total.
- Sum of unique legal rows equals client total. Outlets do not multiply sales.
- Missing data is not zero. A known zero remains zero. No linked legal entities
  shows an explicit absence message.

## Same figures in client list
- Default list exposes total sales and legal breakdown, with optional quantity
  and active legal count in Columns.
- Numeric filters work on sales and quantity in normal and fullscreen views.
- Change period in list, open a card, change period there, return to list:
  period and amounts remain consistent. Reload and history preserve month.
- Mobile list displays chosen fields; legal breakdown and column settings usable
  at 375 pixels without page-level horizontal overflow.

## Sales detail
- Open a legal row's Details: Sales tab opens scoped to that entity.
- Change legal selector and month; category table reconciles with summary.
- Return to Overview: whole-client total is shown, not stale entity selection.

## Safety and deployment
- Fixtures only: no credentials, production data, real customer totals or APIs.
- New independent preview explicitly authorized by user on 26 October 2026.
- Old prototype and production app are not edited.
- Fresh deployed-browser context must show the new version; recheck card,
  Columns, period and an existing navigation flow.

# Assistant assignment scenarios, 27 October 2026

- Preserve all existing Clients, card, Sales, Distribution and route flows.

## Verification result

- 31 linked browser assertions passed using assistant-qa.js, including create,
  approval, replacement, reports, date boundaries, team isolation and revocation.
- 9 further interactive checks passed: incomplete draft save, reversed dates,
  approval-time overlap recheck, dialog keyboard trap/Escape, change withdrawal,
  second ROP scope, search, status filter, return of expired requests.
- Existing flows checked in browser: nine client-card sections, legal sales
  detail, month retained between list/card, column chooser, fullscreen/Escape,
  empty search/reset, director/team/employee/client navigation, Sales,
  Distribution and route preparation. No pageerror events.
- Existing numerical unit regression suite: 7/7 passed. JS syntax check passed.
- Desktop 1440x1000, short desktop 1440x650 and mobile 375x812 inspected.
  Light/dark panels, inputs and status text checked; dark surface issue fixed.
  Mobile page width remains 375px, nested table scrollLeft changes with keyboard,
  and vertical document scrolling works. Assistant sidebar selects one section.
- Fixture data only. No backend calls, real accounts, permissions or production
  records changed. Workflow state intentionally resets on reload.
- Deployment and fresh-context verification recorded separately after upload.
- Existing prototype inspected at handover / assistant / coordinator before edit.
- Manager: only own clients; create draft, edit, search/select clients, validate
  assistant/dates/reason, submit, withdraw, revise returned request, propose
  changes to approved assignment, cancel proposed changes and revoke with reason.
- Coordinator: create for managers in assigned teams; see overlapping workload,
  inspect assignments; no approval rights.
- ROP: approve/reject/return only own team's requests; inspect changes and history.
- Director: review across teams, same decision flows; no simulated admin powers.
- Assistant: see active/future/paused/completed assignments, only active client
  details and tasks; take/complete tasks, report handover outcome. No assignment
  means no clients. No names/details before start or after expiry/revocation.
- Effective states: draft, pending, revision, rejected, cancelled, planned, active,
  change_pending, completed and revoked. Pending changes pause access; rejection
  or withdrawal restores the last approved scope, approval applies the new scope.
- Demo clock: before start, exact start, exact end, after end; end is exclusive.
- Every transition is in-memory demo only; no APIs, localStorage or real users.
- Validate overlapping client periods, ended approval, empty reasons, invalid
  dates, role switching and direct assignment/client actions after access expires.
- Desktop 1440x1000, 375px mobile and short desktop; light and dark readability,
  vertical scrolling, contained table scrolling, keyboard/dialog focus and Escape.
- Verify deployed version in a fresh browser context; no production release.
