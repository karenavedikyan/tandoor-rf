# Outlet catalog distribution (Витрина)

## Scope

Employees select a **confirmed retail outlet** (`guid_store`) in the catalog workspace (`/clients/:guid/catalog`), browse the existing visual catalog, and persist:

- **Установлено** (`installed`) — factual sample placement
- **Нужно поставить** (`planned`) — planned placement

Records are stored in PostgreSQL (`outlet_distribution_markers` + append-only `outlet_distribution_marker_events`), keyed by `guid_store` and stable 1C product code — not catalog version id.

## Production photo readiness

Real product photos in the UI depend on the **existing** protected media chain:

1. Catalog import (`distribution` or `full`) includes product image paths in the snapshot.
2. Operator runs **manual** image sync: `npm run onec-catalog-image-sync` (not executed by this feature).
3. Assets reach `onec_catalog_image_assets.status = 'ready'` with verified SHA256.
4. UI loads `/api/clients/:guid/catalog/media/:assetId` (client read access + active catalog version check).

Until step 2–3 complete on production, the workspace shows the existing placeholder states (`Изображение не передано` / `Просмотр изображения пока недоступен`). This feature does **not** expose FTP/S3 credentials or make private storage public.

## Outlet write gates

Writing is allowed only when server-side checks pass (no global `outletNormalizedReady` override):

- `onec_retail_outlets` row exists and `guid_client` matches the card
- Outlet is **open** (`is_closed` not true, snapshot closure `open`)
- Outlet is **present in current export** (`provenance.freshness = current`, confirmed `guid_store`)

Closed, missing-from-export, or cross-client outlets return `OUTLET_NOT_WRITABLE` / `OUTLET_NOT_FOUND`.
