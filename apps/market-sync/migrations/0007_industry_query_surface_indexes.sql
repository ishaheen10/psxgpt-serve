CREATE INDEX IF NOT EXISTS idx_financial_statements_industry_statement_lookup
ON financial_statements (
  industry,
  section,
  statement_type,
  period_duration,
  canonical_name,
  ticker,
  period_end DESC
);

CREATE INDEX IF NOT EXISTS idx_market_data_latest_lookup
ON market_data (
  ticker,
  date DESC
);

CREATE INDEX IF NOT EXISTS idx_market_data_date_lookup
ON market_data (
  date DESC,
  ticker
);
