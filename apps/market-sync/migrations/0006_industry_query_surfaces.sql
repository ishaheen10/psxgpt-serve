DROP VIEW IF EXISTS technology_model_inputs;
DROP VIEW IF EXISTS textile_industrial_model_inputs;
DROP VIEW IF EXISTS pharma_consumer_model_inputs;
DROP VIEW IF EXISTS fertilizer_model_inputs;
DROP VIEW IF EXISTS energy_model_inputs;
DROP VIEW IF EXISTS cement_model_inputs;
DROP VIEW IF EXISTS bank_industry_model_inputs;
DROP VIEW IF EXISTS industry_statement_model_inputs;
DROP VIEW IF EXISTS latest_market_snapshot;
DROP VIEW IF EXISTS valuation_inputs;
DROP VIEW IF EXISTS net_cash_screen_inputs;
DROP VIEW IF EXISTS growth_screen_inputs;

CREATE VIEW industry_statement_model_inputs AS
SELECT
  ticker,
  MAX(company_name) AS company_name,
  MAX(industry) AS industry,
  CASE
    WHEN lower(MAX(industry)) LIKE '%bank%' THEN 'banking'
    WHEN lower(MAX(industry)) LIKE '%cement%' THEN 'cement'
    WHEN lower(MAX(industry)) IN ('upstream', 'omc', 'refineries')
      OR lower(MAX(industry)) LIKE '%oil%'
      OR lower(MAX(industry)) LIKE '%gas%'
      OR lower(MAX(industry)) LIKE '%power%' THEN 'energy'
    WHEN lower(MAX(industry)) LIKE '%fertilizer%' THEN 'fertilizer'
    WHEN lower(MAX(industry)) LIKE '%pharma%'
      OR lower(MAX(industry)) LIKE '%food%'
      OR lower(MAX(industry)) LIKE '%consumer%' THEN 'pharma_consumer'
    WHEN lower(MAX(industry)) LIKE '%textile%'
      OR lower(MAX(industry)) LIKE '%glass%'
      OR lower(MAX(industry)) LIKE '%steel%'
      OR lower(MAX(industry)) LIKE '%auto%'
      OR lower(MAX(industry)) LIKE '%engineering%' THEN 'textile_industrial'
    WHEN lower(MAX(industry)) LIKE '%technology%' THEN 'technology'
    ELSE 'other_operating'
  END AS industry_family,
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
  MAX(CASE WHEN canonical_name = 'total_income' THEN value END) AS total_income,
  MAX(CASE WHEN canonical_name = 'net_interest_income' THEN value END) AS net_interest_income,
  MAX(CASE WHEN canonical_name = 'non_interest_income' THEN value END) AS non_interest_income,
  MAX(CASE WHEN canonical_name = 'operating_expenses' THEN value END) AS operating_expenses,
  MAX(CASE WHEN canonical_name = 'provision_expense' THEN value END) AS provision_expense,

  MAX(CASE WHEN canonical_name = 'total_assets' THEN value END) AS total_assets,
  MAX(CASE WHEN canonical_name = 'total_equity' THEN value END) AS total_equity,
  MAX(CASE WHEN canonical_name = 'borrowings' THEN value END) AS borrowings,
  MAX(CASE WHEN canonical_name = 'cash_and_equivalents' THEN value END) AS cash_and_equivalents,
  MAX(CASE WHEN canonical_name = 'cash_and_balances' THEN value END) AS cash_and_balances,
  MAX(CASE WHEN canonical_name = 'deposits' THEN value END) AS deposits,
  MAX(CASE WHEN canonical_name = 'advances' THEN value END) AS advances,
  MAX(CASE WHEN canonical_name = 'investments' THEN value END) AS investments,
  MAX(CASE WHEN canonical_name = 'inventory' THEN value END) AS inventory,
  MAX(CASE WHEN canonical_name = 'current_assets' THEN value END) AS current_assets,
  MAX(CASE WHEN canonical_name = 'current_liabilities' THEN value END) AS current_liabilities,
  MAX(CASE WHEN canonical_name = 'trade_receivables' THEN value END) AS trade_receivables,
  MAX(CASE WHEN canonical_name = 'trade_payables' THEN value END) AS trade_payables,
  MAX(CASE WHEN canonical_name = 'property_equipment' THEN value END) AS property_equipment,

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
      AND canonical_name IN (
        'revenue_net', 'gross_profit', 'operating_profit', 'finance_cost',
        'profit_before_tax', 'net_profit', 'eps',
        'total_income', 'net_interest_income', 'non_interest_income',
        'operating_expenses', 'provision_expense'
      ))
    OR (statement_type = 'balance_sheet' AND period_duration = 'PIT'
      AND canonical_name IN (
        'total_assets', 'total_equity', 'borrowings', 'cash_and_equivalents',
        'cash_and_balances', 'deposits', 'advances', 'investments',
        'inventory', 'current_assets', 'current_liabilities',
        'trade_receivables', 'trade_payables', 'property_equipment'
      ))
    OR (statement_type = 'cash_flow' AND period_duration = '12M'
      AND canonical_name IN (
        'cfo', 'capex', 'dividends_paid', 'borrowings_raised', 'borrowings_repaid'
      ))
  )
GROUP BY ticker, period_end, section;

CREATE VIEW bank_industry_model_inputs AS
SELECT * FROM industry_statement_model_inputs WHERE industry_family = 'banking';

CREATE VIEW cement_model_inputs AS
SELECT * FROM industry_statement_model_inputs WHERE industry_family = 'cement';

CREATE VIEW energy_model_inputs AS
SELECT * FROM industry_statement_model_inputs WHERE industry_family = 'energy';

CREATE VIEW fertilizer_model_inputs AS
SELECT * FROM industry_statement_model_inputs WHERE industry_family = 'fertilizer';

CREATE VIEW pharma_consumer_model_inputs AS
SELECT * FROM industry_statement_model_inputs WHERE industry_family = 'pharma_consumer';

CREATE VIEW textile_industrial_model_inputs AS
SELECT * FROM industry_statement_model_inputs WHERE industry_family = 'textile_industrial';

CREATE VIEW technology_model_inputs AS
SELECT * FROM industry_statement_model_inputs WHERE industry_family = 'technology';

CREATE VIEW latest_market_snapshot AS
WITH ranked AS (
  SELECT
    market_data.*,
    ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) AS market_recency_rank
  FROM market_data
)
SELECT
  ticker,
  date,
  closing_price,
  total_shares,
  market_cap,
  week_52_high,
  week_52_low,
  fundamentals_period_end,
  pe_earnings_basis,
  pe_earnings_period_duration,
  pe_earnings_section,
  market_recency_rank
FROM ranked
WHERE market_recency_rank = 1;

CREATE VIEW valuation_inputs AS
WITH latest_profit AS (
  SELECT ticker, company_name, industry, period_end, value AS annual_net_profit,
         ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY period_end DESC) AS rn
  FROM financial_statements
  WHERE section = 'consolidated'
    AND statement_type = 'profit_loss'
    AND period_duration = '12M'
    AND canonical_name = 'net_profit'
),
latest_equity AS (
  SELECT ticker, period_end, value AS total_equity,
         ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY period_end DESC) AS rn
  FROM financial_statements
  WHERE section = 'consolidated'
    AND statement_type = 'balance_sheet'
    AND period_duration = 'PIT'
    AND canonical_name = 'total_equity'
),
latest_cash AS (
  SELECT ticker, period_end, value AS cash_balance,
         ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY period_end DESC) AS rn
  FROM financial_statements
  WHERE section = 'consolidated'
    AND statement_type = 'balance_sheet'
    AND period_duration = 'PIT'
    AND canonical_name IN ('cash_and_equivalents', 'cash_and_balances')
),
latest_borrowings AS (
  SELECT ticker, period_end, value AS borrowings,
         ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY period_end DESC) AS rn
  FROM financial_statements
  WHERE section = 'consolidated'
    AND statement_type = 'balance_sheet'
    AND period_duration = 'PIT'
    AND canonical_name = 'borrowings'
)
SELECT
  m.ticker,
  p.company_name,
  p.industry,
  m.date AS market_date,
  m.closing_price,
  m.total_shares,
  m.market_cap,
  p.period_end AS earnings_period_end,
  p.annual_net_profit,
  e.period_end AS equity_period_end,
  e.total_equity,
  c.period_end AS cash_period_end,
  c.cash_balance,
  b.period_end AS borrowings_period_end,
  b.borrowings,
  m.market_cap / NULLIF(p.annual_net_profit * 1000.0, 0) AS pe_market_cap_net_profit,
  m.market_cap / NULLIF(e.total_equity * 1000.0, 0) AS pb_market_cap_equity,
  ((COALESCE(b.borrowings, 0) - COALESCE(c.cash_balance, 0)) * 1000.0) AS net_debt_pkr
FROM latest_market_snapshot m
LEFT JOIN latest_profit p ON p.ticker = m.ticker AND p.rn = 1
LEFT JOIN latest_equity e ON e.ticker = m.ticker AND e.rn = 1
LEFT JOIN latest_cash c ON c.ticker = m.ticker AND c.rn = 1
LEFT JOIN latest_borrowings b ON b.ticker = m.ticker AND b.rn = 1;

CREATE VIEW net_cash_screen_inputs AS
WITH latest_cash AS (
  SELECT ticker, company_name, industry, period_end, value AS cash_balance,
         ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY period_end DESC) AS rn
  FROM financial_statements
  WHERE section = 'consolidated'
    AND statement_type = 'balance_sheet'
    AND period_duration = 'PIT'
    AND canonical_name IN ('cash_and_equivalents', 'cash_and_balances')
),
latest_borrowings AS (
  SELECT ticker, period_end, value AS borrowings,
         ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY period_end DESC) AS rn
  FROM financial_statements
  WHERE section = 'consolidated'
    AND statement_type = 'balance_sheet'
    AND period_duration = 'PIT'
    AND canonical_name = 'borrowings'
)
SELECT
  c.ticker,
  c.company_name,
  c.industry,
  c.period_end AS cash_period_end,
  c.cash_balance,
  b.period_end AS borrowings_period_end,
  b.borrowings,
  (COALESCE(c.cash_balance, 0) - COALESCE(b.borrowings, 0)) AS net_cash_pk_thousand,
  (COALESCE(c.cash_balance, 0) - COALESCE(b.borrowings, 0)) * 1000.0 AS net_cash_pkr,
  m.date AS market_date,
  m.market_cap,
  ((COALESCE(c.cash_balance, 0) - COALESCE(b.borrowings, 0)) * 1000.0) / NULLIF(m.market_cap, 0) AS net_cash_to_market_cap
FROM latest_cash c
LEFT JOIN latest_borrowings b ON b.ticker = c.ticker AND b.rn = 1
LEFT JOIN latest_market_snapshot m ON m.ticker = c.ticker
WHERE c.rn = 1;

CREATE VIEW growth_screen_inputs AS
WITH annual_metrics AS (
  SELECT
    ticker,
    company_name,
    industry,
    period_end,
    canonical_name,
    value,
    ROW_NUMBER() OVER (PARTITION BY ticker, canonical_name ORDER BY period_end DESC) AS rn
  FROM financial_statements
  WHERE section = 'consolidated'
    AND statement_type = 'profit_loss'
    AND period_duration = '12M'
    AND canonical_name IN ('revenue_net', 'net_profit', 'operating_profit')
),
pivoted AS (
  SELECT
    ticker,
    MAX(company_name) AS company_name,
    MAX(industry) AS industry,
    MAX(CASE WHEN canonical_name = 'revenue_net' AND rn = 1 THEN period_end END) AS latest_period_end,
    MAX(CASE WHEN canonical_name = 'revenue_net' AND rn = 6 THEN period_end END) AS base_period_end,
    MAX(CASE WHEN canonical_name = 'revenue_net' AND rn = 1 THEN value END) AS latest_revenue_net,
    MAX(CASE WHEN canonical_name = 'revenue_net' AND rn = 6 THEN value END) AS base_revenue_net,
    MAX(CASE WHEN canonical_name = 'net_profit' AND rn = 1 THEN value END) AS latest_net_profit,
    MAX(CASE WHEN canonical_name = 'net_profit' AND rn = 6 THEN value END) AS base_net_profit,
    MAX(CASE WHEN canonical_name = 'operating_profit' AND rn = 1 THEN value END) AS latest_operating_profit,
    MAX(CASE WHEN canonical_name = 'operating_profit' AND rn = 6 THEN value END) AS base_operating_profit
  FROM annual_metrics
  WHERE rn IN (1, 6)
  GROUP BY ticker
)
SELECT
  ticker,
  company_name,
  industry,
  latest_period_end,
  base_period_end,
  latest_revenue_net,
  base_revenue_net,
  latest_net_profit,
  base_net_profit,
  latest_operating_profit,
  base_operating_profit,
  (julianday(latest_period_end) - julianday(base_period_end)) / 365.25 AS years_between,
  latest_revenue_net / NULLIF(base_revenue_net, 0) AS revenue_growth_multiple,
  latest_net_profit / NULLIF(base_net_profit, 0) AS net_profit_growth_multiple,
  latest_operating_profit / NULLIF(base_operating_profit, 0) AS operating_profit_growth_multiple
FROM pivoted
WHERE latest_period_end IS NOT NULL
  AND base_period_end IS NOT NULL;
