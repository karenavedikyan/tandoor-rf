-- Active source snapshot per calendar month and dataset (items/returns do not clobber other months).

CREATE TABLE IF NOT EXISTS onec_v3_legal_sales_month_activation (
  dataset TEXT NOT NULL CHECK (dataset IN ('sale_aggregate', 'sale_items', 'return_aggregate', 'return_items')),
  sale_month DATE NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (dataset, sale_month)
);
