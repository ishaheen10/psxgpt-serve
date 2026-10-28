CREATE INDEX IF NOT EXISTS idx_financial_statements_ticker_statement_lookup
ON financial_statements (
  ticker,
  section,
  statement_type,
  period_duration,
  canonical_name,
  period_end DESC
);

CREATE INDEX IF NOT EXISTS idx_financial_statements_statement_screen_lookup
ON financial_statements (
  section,
  statement_type,
  period_duration,
  canonical_name,
  ticker,
  period_end DESC
);
