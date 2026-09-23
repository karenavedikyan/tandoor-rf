export const CLIENTS_RELATIVE_PATH = "clients/all_clients.json";

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_RECORDS = 50_000;
export const FTP_READ_DEADLINE_MS = 60_000;
export const MAX_DETAILED_ERRORS = 50;
export const MAX_DETAILED_WARNINGS = 20;

export const IMPORT_ADVISORY_LOCK_KEY = 902_451_002;

export const KNOWN_CLIENT_KEYS = [
  "guid_client",
  "name_client",
  "guid_holding",
  "name_holding",
  "guid_manager",
  "name_manager",
  "address",
  "telephone",
] as const;

export type KnownClientKey = (typeof KNOWN_CLIENT_KEYS)[number];
