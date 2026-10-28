DROP VIEW IF EXISTS statement_latest_snapshot;
DROP VIEW IF EXISTS statement_annual_history;
DROP VIEW IF EXISTS statement_model_inputs;
DROP VIEW IF EXISTS bank_statement_model_inputs;
DROP VIEW IF EXISTS statement_export_rows;

CREATE VIEW statement_latest_snapshot AS
WITH ranked AS (
  SELECT
    fs.*,
    ROW_NUMBER() OVER (
      PARTITION BY ticker, section, statement_type, canonical_name, period_duration
      ORDER BY period_end DESC
    ) AS recency_rank
  FROM financial_statements fs
  WHERE section = 'consolidated'
)
SELECT
  id,
  ticker,
  company_name,
  industry,
  unit_type,
  period_type,
  period_end,
  period_duration,
  fiscal_year,
  section,
  statement_type,
  canonical_name,
  original_name,
  value,
  method,
  source_file,
  source_pages,
  source_url,
  qc_flag,
  recency_rank
FROM ranked
WHERE recency_rank = 1;

CREATE VIEW statement_annual_history AS
SELECT
  id,
  ticker,
  company_name,
  industry,
  unit_type,
  period_type,
  period_end,
  period_duration,
  fiscal_year,
  section,
  statement_type,
  canonical_name,
  original_name,
  value,
  method,
  source_file,
  source_pages,
  source_url,
  qc_flag,
  ROW_NUMBER() OVER (
    PARTITION BY ticker, statement_type, canonical_name
    ORDER BY period_end DESC
  ) AS canonical_period_rank
FROM financial_statements
WHERE section = 'consolidated'
  AND (
    (statement_type IN ('profit_loss', 'cash_flow') AND period_duration = '12M')
    OR (statement_type = 'balance_sheet' AND period_duration = 'PIT')
  );

CREATE VIEW statement_model_inputs AS
SELECT
  ticker,
  MAX(company_name) AS company_name,
  MAX(industry) AS industry,
  period_end,
  section,
  'MIXED' AS period_duration,
  MAX(unit_type) AS unit_type,
  MAX(CASE WHEN canonical_name = 'revenue_net' THEN value END) AS revenue_net,
  MAX(CASE WHEN canonical_name = 'gross_profit' THEN value END) AS gross_profit,
  MAX(CASE WHEN canonical_name = 'operating_profit' THEN value END) AS operating_profit,
  MAX(CASE WHEN canonical_name = 'finance_cost' THEN value END) AS finance_cost,
  MAX(CASE WHEN canonical_name = 'profit_before_tax' THEN value END) AS profit_before_tax,
  MAX(CASE WHEN canonical_name = 'net_profit' THEN value END) AS net_profit,
  MAX(CASE WHEN canonical_name = 'eps' THEN value END) AS eps,
  MAX(CASE WHEN canonical_name = 'total_assets' THEN value END) AS total_assets,
  MAX(CASE WHEN canonical_name = 'total_equity' THEN value END) AS total_equity,
  MAX(CASE WHEN canonical_name = 'borrowings' THEN value END) AS borrowings,
  MAX(CASE WHEN canonical_name = 'cash_and_equivalents' THEN value END) AS cash_and_equivalents,
  MAX(CASE WHEN canonical_name = 'cfo' THEN value END) AS cfo,
  MAX(CASE WHEN canonical_name = 'capex' THEN value END) AS capex,
  MAX(CASE WHEN canonical_name = 'dividends_paid' THEN value END) AS dividends_paid,
  MAX(CASE WHEN canonical_name = 'borrowings_raised' THEN value END) AS borrowings_raised,
  MAX(CASE WHEN canonical_name = 'borrowings_repaid' THEN value END) AS borrowings_repaid,
  GROUP_CONCAT(DISTINCT source_file) AS source_files,
  GROUP_CONCAT(DISTINCT source_url) AS source_urls,
  GROUP_CONCAT(DISTINCT source_pages) AS source_pages,
  GROUP_CONCAT(DISTINCT qc_flag) AS qc_flags
FROM financial_statements
WHERE section = 'consolidated'
  AND (
    (statement_type = 'profit_loss' AND period_duration = '12M'
      AND canonical_name IN ('revenue_net', 'gross_profit', 'operating_profit', 'finance_cost', 'profit_before_tax', 'net_profit', 'eps'))
    OR (statement_type = 'balance_sheet' AND period_duration = 'PIT'
      AND canonical_name IN ('total_assets', 'total_equity', 'borrowings', 'cash_and_equivalents'))
    OR (statement_type = 'cash_flow' AND period_duration = '12M'
      AND canonical_name IN ('cfo', 'capex', 'dividends_paid', 'borrowings_raised', 'borrowings_repaid'))
  )
GROUP BY ticker, period_end, section;

CREATE VIEW bank_statement_model_inputs AS
SELECT
  ticker,
  MAX(company_name) AS company_name,
  MAX(industry) AS industry,
  period_end,
  section,
  'MIXED' AS period_duration,
  MAX(unit_type) AS unit_type,
  MAX(CASE WHEN canonical_name = 'total_income' THEN value END) AS total_income,
  MAX(CASE WHEN canonical_name = 'net_interest_income' THEN value END) AS net_interest_income,
  MAX(CASE WHEN canonical_name = 'non_interest_income' THEN value END) AS non_interest_income,
  MAX(CASE WHEN canonical_name = 'operating_expenses' THEN value END) AS operating_expenses,
  MAX(CASE WHEN canonical_name = 'provision_expense' THEN value END) AS provision_expense,
  MAX(CASE WHEN canonical_name = 'profit_before_tax' THEN value END) AS profit_before_tax,
  MAX(CASE WHEN canonical_name = 'net_profit' THEN value END) AS net_profit,
  MAX(CASE WHEN canonical_name = 'eps' THEN value END) AS eps,
  MAX(CASE WHEN canonical_name = 'deposits' THEN value END) AS deposits,
  MAX(CASE WHEN canonical_name = 'advances' THEN value END) AS advances,
  MAX(CASE WHEN canonical_name = 'borrowings' THEN value END) AS borrowings,
  MAX(CASE WHEN canonical_name = 'investments' THEN value END) AS investments,
  MAX(CASE WHEN canonical_name = 'total_assets' THEN value END) AS total_assets,
  MAX(CASE WHEN canonical_name = 'total_equity' THEN value END) AS total_equity,
  MAX(CASE WHEN canonical_name = 'cash_and_balances' THEN value END) AS cash_and_balances,
  MAX(CASE WHEN canonical_name = 'cfo' THEN value END) AS cfo,
  MAX(CASE WHEN canonical_name = 'dividends_paid' THEN value END) AS dividends_paid,
  GROUP_CONCAT(DISTINCT source_file) AS source_files,
  GROUP_CONCAT(DISTINCT source_url) AS source_urls,
  GROUP_CONCAT(DISTINCT source_pages) AS source_pages,
  GROUP_CONCAT(DISTINCT qc_flag) AS qc_flags
FROM financial_statements
WHERE section = 'consolidated'
  AND (
    (statement_type = 'profit_loss' AND period_duration = '12M'
      AND canonical_name IN ('total_income', 'net_interest_income', 'non_interest_income', 'operating_expenses', 'provision_expense', 'profit_before_tax', 'net_profit', 'eps'))
    OR (statement_type = 'balance_sheet' AND period_duration = 'PIT'
      AND canonical_name IN ('deposits', 'advances', 'borrowings', 'investments', 'total_assets', 'total_equity', 'cash_and_balances'))
    OR (statement_type = 'cash_flow' AND period_duration = '12M'
      AND canonical_name IN ('cfo', 'dividends_paid'))
  )
GROUP BY ticker, period_end, section;

CREATE VIEW statement_export_rows AS
SELECT
  id,
  ticker,
  company_name,
  industry,
  unit_type,
  period_type,
  period_end,
  period_duration,
  fiscal_year,
  section,
  statement_type,
  canonical_name,
  original_name,
  value,
  method,
  source_file,
  source_pages,
  source_url,
  qc_flag,
  CASE canonical_name
    WHEN 'revenue_net' THEN 10
    WHEN 'gross_profit' THEN 20
    WHEN 'operating_profit' THEN 30
    WHEN 'finance_cost' THEN 40
    WHEN 'profit_before_tax' THEN 50
    WHEN 'net_profit' THEN 60
    WHEN 'eps' THEN 70
    WHEN 'total_assets' THEN 110
    WHEN 'cash_and_equivalents' THEN 120
    WHEN 'investments' THEN 130
    WHEN 'advances' THEN 140
    WHEN 'total_equity' THEN 150
    WHEN 'borrowings' THEN 160
    WHEN 'deposits' THEN 170
    WHEN 'cfo' THEN 210
    WHEN 'capex' THEN 220
    WHEN 'dividends_paid' THEN 230
    WHEN 'borrowings_raised' THEN 240
    WHEN 'borrowings_repaid' THEN 250
    ELSE 999
  END AS display_order
FROM financial_statements
WHERE section = 'consolidated';
