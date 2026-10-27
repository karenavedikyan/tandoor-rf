# Main flows

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
