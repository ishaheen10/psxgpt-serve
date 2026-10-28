DROP VIEW IF EXISTS statement_annual_history;
DROP VIEW IF EXISTS statement_quarterly_history;

CREATE VIEW statement_annual_history AS
WITH annual_periods AS (
  SELECT DISTINCT ticker, section, period_end
  FROM financial_statements
  WHERE section = 'consolidated'
    AND statement_type IN ('profit_loss', 'cash_flow')
    AND period_duration = '12M'
)
SELECT
  fs.id,
  fs.ticker,
  fs.company_name,
  fs.industry,
  fs.unit_type,
  fs.period_type,
  fs.period_end,
  fs.period_duration,
  fs.fiscal_year,
  fs.section,
  fs.statement_type,
  fs.canonical_name,
  fs.original_name,
  fs.value,
  fs.method,
  fs.source_file,
  fs.source_pages,
  fs.source_url,
  fs.qc_flag,
  ROW_NUMBER() OVER (
    PARTITION BY fs.ticker, fs.statement_type, fs.canonical_name
    ORDER BY fs.period_end DESC
  ) AS canonical_period_rank
FROM financial_statements fs
JOIN annual_periods period
  ON period.ticker = fs.ticker
 AND period.section = fs.section
 AND period.period_end = fs.period_end
WHERE fs.section = 'consolidated'
  AND (
    (fs.statement_type IN ('profit_loss', 'cash_flow') AND fs.period_duration = '12M')
    OR (fs.statement_type = 'balance_sheet' AND fs.period_duration = 'PIT')
  );

CREATE VIEW statement_quarterly_history AS
WITH quarterly_periods AS (
  SELECT DISTINCT ticker, section, period_end
  FROM financial_statements
  WHERE section = 'consolidated'
    AND statement_type IN ('profit_loss', 'cash_flow')
    AND period_duration = '3M'
)
SELECT
  fs.id,
  fs.ticker,
  fs.company_name,
  fs.industry,
  fs.unit_type,
  fs.period_type,
  fs.period_end,
  fs.period_duration,
  fs.fiscal_year,
  fs.section,
  fs.statement_type,
  fs.canonical_name,
  fs.original_name,
  fs.value,
  fs.method,
  fs.source_file,
  fs.source_pages,
  fs.source_url,
  fs.qc_flag,
  ROW_NUMBER() OVER (
    PARTITION BY fs.ticker, fs.statement_type, fs.canonical_name
    ORDER BY fs.period_end DESC
  ) AS canonical_period_rank
FROM financial_statements fs
JOIN quarterly_periods period
  ON period.ticker = fs.ticker
 AND period.section = fs.section
 AND period.period_end = fs.period_end
WHERE fs.section = 'consolidated'
  AND (
    (fs.statement_type IN ('profit_loss', 'cash_flow') AND fs.period_duration = '3M')
    OR (fs.statement_type = 'balance_sheet' AND fs.period_duration = 'PIT')
  );
