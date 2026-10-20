-- Monthly wholesale sales by legal entity and product category (1C sale.json).

CREATE TABLE IF NOT EXISTS onec_v3_legal_sales_import_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  source_sha256 CHAR(64) NOT NULL,
  row_count INTEGER NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onec_v3_legal_sales_lines (
  legal_guid UUID NOT NULL,
  sale_month DATE NOT NULL,
  product_type TEXT NOT NULL,
  quantity NUMERIC(18, 4) NOT NULL,
  income NUMERIC(18, 4) NOT NULL,
  manual_discount NUMERIC(18, 4) NOT NULL,
  automatic_discount NUMERIC(18, 4) NOT NULL,
  total_discount NUMERIC(18, 4) NOT NULL,
  cost_price NUMERIC(18, 4) NOT NULL,
  additional_expenses NUMERIC(18, 4) NOT NULL,
  gross_profit NUMERIC(18, 4) NOT NULL,
  profitability NUMERIC(18, 4) NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (legal_guid, sale_month, product_type)
);

CREATE INDEX IF NOT EXISTS onec_v3_legal_sales_lines_legal_month_idx
  ON onec_v3_legal_sales_lines (legal_guid, sale_month);
