-- Per-outlet distribution markers: installed fact and planned placement intent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'outlet_distribution_marker_kind') THEN
    CREATE TYPE outlet_distribution_marker_kind AS ENUM ('installed', 'planned');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS outlet_distribution_markers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guid_store UUID NOT NULL REFERENCES onec_retail_outlets (guid_store),
  guid_client UUID NOT NULL REFERENCES onec_clients (guid_client) ON DELETE CASCADE,
  product_code TEXT NOT NULL CHECK (char_length(trim(product_code)) > 0),
  marker_kind outlet_distribution_marker_kind NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  marked_by_user_id UUID NOT NULL REFERENCES users (id),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  catalog_version_id UUID REFERENCES onec_catalog_versions (id),
  CONSTRAINT outlet_distribution_markers_unique
    UNIQUE (guid_store, product_code, marker_kind)
);

CREATE INDEX IF NOT EXISTS idx_outlet_distribution_markers_active_store
  ON outlet_distribution_markers (guid_store)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_outlet_distribution_markers_client_store
  ON outlet_distribution_markers (guid_client, guid_store);

CREATE TABLE IF NOT EXISTS outlet_distribution_marker_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marker_id UUID REFERENCES outlet_distribution_markers (id) ON DELETE SET NULL,
  guid_store UUID NOT NULL,
  guid_client UUID NOT NULL,
  product_code TEXT NOT NULL,
  marker_kind outlet_distribution_marker_kind NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('set', 'clear')),
  catalog_version_id UUID REFERENCES onec_catalog_versions (id),
  actor_user_id UUID NOT NULL REFERENCES users (id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outlet_distribution_marker_events_store
  ON outlet_distribution_marker_events (guid_store, occurred_at DESC);
