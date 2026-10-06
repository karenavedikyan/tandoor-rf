export const IMPORT_JOB_KIND = "clients_snapshot" as const;
export const REGULAR_UPDATE_JOB_KIND = "regular_update_bundle" as const;
export type ImportJobKind = typeof IMPORT_JOB_KIND | typeof REGULAR_UPDATE_JOB_KIND;

export const REGULAR_UPDATE_JOB_SOURCE_ADMIN = "admin_manual" as const;
export const REGULAR_UPDATE_JOB_SOURCE_NIGHTLY = "nightly" as const;
export type RegularUpdateJobSource =
  | typeof REGULAR_UPDATE_JOB_SOURCE_ADMIN
  | typeof REGULAR_UPDATE_JOB_SOURCE_NIGHTLY;

export const TRUSTED_ONEC_FTP_HOST = "gw.toopatch.ru";
export const TRUSTED_ONEC_FTP_BASE_PATH = "/LC";
