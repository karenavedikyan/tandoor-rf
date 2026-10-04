import {
  DEFAULT_CATALOG_IMPORT_PROFILE,
  type CatalogImportProfile,
} from "../onec-catalog/constants";
import type { HoldingLinkValidationPolicy } from "../onec-clients/holding-link-policy";

export const CLEAN_RELOAD_ADVISORY_LOCK_KEY = 902_451_004;

export const BUNDLE_CLIENTS_FILE = "all_clients.json";
export const BUNDLE_EMPLOYEES_FILE = "all_employees.json";
export const BUNDLE_CATALOG_SUBDIR = "catalog";

export const DEFAULT_HOLDING_LINK_POLICY: HoldingLinkValidationPolicy = "tolerant";
export const DEFAULT_CATALOG_PROFILE: CatalogImportProfile = DEFAULT_CATALOG_IMPORT_PROFILE;

/** Tables cleared in purge phase (explicit list — no whole-schema TRUNCATE). */
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
  catalogImages: [
    "onec_catalog_image_sync_queue",
    "onec_catalog_image_sync_cursor",
    "onec_catalog_image_sync_runs",
    "onec_catalog_image_assets",
  ],
  catalogCore: [
    "onec_catalog_quarantine",
    "onec_catalog_prices_staging",
    "onec_catalog_stock_staging",
    "onec_catalog_stock_expected_staging",
    "onec_catalog_product_presence",
    "onec_catalog_product_sections",
    "onec_catalog_product_properties",
    "onec_catalog_product_images",
    "onec_catalog_products",
    "onec_catalog_price_types",
    "onec_catalog_storages",
    "onec_catalog_sections",
    "onec_catalog_groups",
    "onec_catalog_import_runs",
    "onec_catalog_versions",
  ],
  clientDomain: [
    "onec_import_jobs",
    "onec_client_quarantine_records",
    "onec_baseline_replacement_runs",
    "onec_extended_contract_confirmations",
    "onec_client_import_runs",
    "onec_clients",
  ],
} as const;
