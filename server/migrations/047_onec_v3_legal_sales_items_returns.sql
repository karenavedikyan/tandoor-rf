-- Item-level sales and returns (1C sale(items).json / returne*.json). Raw row lineage per source file.

CREATE TABLE IF NOT EXISTS onec_v3_legal_sale_item_import_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  source_sha256 CHAR(64) NOT NULL,
  row_count INTEGER NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onec_v3_legal_sale_item_lines (
  source_sha256 CHAR(64) NOT NULL,
  source_row_index INTEGER NOT NULL CHECK (source_row_index >= 0),
  legal_guid UUID NOT NULL,
  sale_month DATE NOT NULL,
  product_type TEXT NOT NULL,
  guid_item UUID NOT NULL,
  name_item TEXT NOT NULL,
  quantity NUMERIC(18, 6) NOT NULL,
  income NUMERIC(18, 4) NOT NULL,
  manual_discount NUMERIC(18, 4) NOT NULL,
  automatic_discount NUMERIC(18, 4) NOT NULL,
  total_discount NUMERIC(18, 4) NOT NULL,
  cost_price NUMERIC(18, 4) NOT NULL,
  additional_expenses NUMERIC(18, 4) NOT NULL,
  gross_profit NUMERIC(18, 4) NOT NULL,
  profitability NUMERIC(18, 4) NOT NULL,
  catalog_matched BOOLEAN NOT NULL DEFAULT FALSE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_sha256, source_row_index)
);

CREATE INDEX IF NOT EXISTS onec_v3_legal_sale_item_lines_legal_month_idx
  ON onec_v3_legal_sale_item_lines (legal_guid, sale_month);

CREATE INDEX IF NOT EXISTS onec_v3_legal_sale_item_lines_item_idx
  ON onec_v3_legal_sale_item_lines (guid_item);

CREATE TABLE IF NOT EXISTS onec_v3_legal_return_import_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  source_sha256 CHAR(64) NOT NULL,
  row_count INTEGER NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onec_v3_legal_return_lines (
  source_sha256 CHAR(64) NOT NULL,
  source_row_index INTEGER NOT NULL CHECK (source_row_index >= 0),
  legal_guid UUID NOT NULL,
  sale_month DATE NOT NULL,
  product_type TEXT NOT NULL,
  quantity NUMERIC(18, 6) NOT NULL,
  income NUMERIC(18, 4) NOT NULL,
  catalog_matched BOOLEAN NOT NULL DEFAULT FALSE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_sha256, source_row_index)
);

CREATE INDEX IF NOT EXISTS onec_v3_legal_return_lines_legal_month_idx
  ON onec_v3_legal_return_lines (legal_guid, sale_month);

CREATE TABLE IF NOT EXISTS onec_v3_legal_return_item_import_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  source_sha256 CHAR(64) NOT NULL,
  row_count INTEGER NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onec_v3_legal_return_item_lines (
  source_sha256 CHAR(64) NOT NULL,
  source_row_index INTEGER NOT NULL CHECK (source_row_index >= 0),
  legal_guid UUID NOT NULL,
  sale_month DATE NOT NULL,
  product_type TEXT NOT NULL,
  guid_item UUID NOT NULL,
  name_item TEXT NOT NULL,
  quantity NUMERIC(18, 6) NOT NULL,
  income NUMERIC(18, 4) NOT NULL,
  catalog_matched BOOLEAN NOT NULL DEFAULT FALSE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_sha256, source_row_index)
);

CREATE INDEX IF NOT EXISTS onec_v3_legal_return_item_lines_legal_month_idx
  ON onec_v3_legal_return_item_lines (legal_guid, sale_month);
