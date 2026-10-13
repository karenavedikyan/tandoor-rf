import { MAX_SOURCE_BYTES } from "../onec-clients/constants";

export const V3_ADVISORY_LOCK_KEY = 902_451_004;

export const V3_BUNDLE_FILES = {
  holdings: "all_holding.json",
  clients: "all_clients.json",
  retail: "all_retail.json",
  employees: "all_employees.json",
} as const;

export const V3_FTP_CLIENTS_DIR = "clients";

export const V3_MAX_FILE_BYTES = MAX_SOURCE_BYTES;
export const V3_MAX_RECORDS = 50_000;

export const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
