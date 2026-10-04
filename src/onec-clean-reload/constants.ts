import type { HoldingLinkValidationPolicy } from "../onec-clients/holding-link-policy";

export const CLEAN_RELOAD_ADVISORY_LOCK_KEY = 902_451_004;

export const BUNDLE_CLIENTS_FILE = "all_clients.json";
export const BUNDLE_EMPLOYEES_FILE = "all_employees.json";

export const DEFAULT_HOLDING_LINK_POLICY: HoldingLinkValidationPolicy = "tolerant";

/** Tables always referenced by purge SQL without optional guards. */
export const PURGE_REQUIRED_TABLES = [
  "access_grants",
  "access_denials",
  "delegation_clients",
  "delegation_change_request_clients",
  "bitrix24_manual_sync_card_cooldown",
  "bitrix24_client_card_objects",
  "outlet_distribution_marker_events",
  "onec_import_jobs",
  "onec_client_quarantine_records",
  "onec_baseline_replacement_runs",
  "onec_extended_contract_confirmations",
  "onec_client_import_runs",
  "onec_retail_outlets",
  "onec_clients",
  "onec_wholesale_employee_roster",
  "onec_wholesale_roster_state",
  "onec_exchange_state",
] as const;

/** Purge skips these when absent; preflight must not block on them. */
export const PURGE_OPTIONAL_TABLES = [
  "outlet_distribution_markers",
  "client_review_records",
] as const;

/** Client-composition replacement scope only — catalog/image tables are never touched. */
export const PURGE_TABLE_GROUPS = {
  clientOrphans: [
    "DELETE FROM access_grants WHERE grant_type = 'client'",
    "DELETE FROM access_denials WHERE scope_type = 'client'",
    "DELETE FROM delegation_clients",
    "DELETE FROM delegation_change_request_clients",
    "DELETE FROM bitrix24_manual_sync_card_cooldown",
    "DELETE FROM bitrix24_client_card_objects",
    "DELETE FROM outlet_distribution_marker_events",
  ],
  clientDomain: [
    "onec_import_jobs",
    "onec_client_quarantine_records",
    "onec_baseline_replacement_runs",
    "onec_extended_contract_confirmations",
    "onec_client_import_runs",
    "onec_clients",
  ],
  rosterDomain: ["onec_wholesale_employee_roster"],
} as const;
