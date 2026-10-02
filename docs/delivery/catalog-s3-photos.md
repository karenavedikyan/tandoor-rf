# Private catalog photographs on Timeweb

This extends PR #33 without changing UI, permissions, catalog import, Bitrix24 or schedules.

## Storage

Server-only variables: `CATALOG_IMAGE_STORAGE_BACKEND=s3`,
`CATALOG_IMAGE_S3_ENDPOINT=https://s3.twcstorage.ru`, `CATALOG_IMAGE_S3_BUCKET`,
`CATALOG_IMAGE_S3_ACCESS_KEY`, `CATALOG_IMAGE_S3_SECRET_KEY`.
Do not commit credentials. The bucket is private; no public URLs or browser credentials.
Existing permission-checked media API reads immutable WebP objects by SHA256.
Objects are bounded and hash-verified before serving and before DB publication.
Local storage remains the default when the S3 backend is not selected.

## Manual FTP loading

`node dist/cli/catalog-photo-ftp-load.js --max-files=3` validates without publishing.
`node dist/cli/catalog-photo-ftp-load.js --apply --max-files=3` publishes the pilot.
`node dist/cli/catalog-photo-ftp-load.js --apply --missing-only --max-files=5000`
continues the initial loading, excluding verified ready assets.
The latter mode is for initial completion, not detection of updated source photos.

Only image paths of the active PostgreSQL catalog are read under `/s3/IMG`.
Existing ONEC_FTP settings are reused, never changed. No recursive scan or import.
One image is buffered, processed and removed from temporary disk at a time.
The current byte, pixel and image dimension limits still apply.
Oversized, missing or corrupt photographs remain unavailable and are reported.
Limits per run: max-files, 45 minutes and 8 GiB of downloaded originals.
Resume manually; no scheduler is installed.

Source-scoped batches do not change the original local-sync queue/cursor.
The FTP journal records partial results and failures. A PostgreSQL advisory lock
prevents overlapping FTP loaders. Active-version changes stop loading.
Existing per-source publication locks remain in effect.

## Deployment and rollback

Take and verify a PostgreSQL backup. Apply existing migrations 022 and 023 only.
Deploy reviewed code and S3 settings; run a small dry-run then a small apply.
Verify authenticated media plus 403/404 denial tests and the client UI.
Finish remaining photographs in bounded manual runs.
Rollback code to the previous commit if needed; retain S3 objects and additive tables.
Do not delete the bucket, change customer records, or start 1C/scheduled imports.
