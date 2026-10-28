-- Market Data Tables
-- Run with: pnpm migrate (or pnpm migrate:local for local testing)

CREATE TABLE IF NOT EXISTS market_data (
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  closing_price REAL,
  total_shares INTEGER,
  market_cap REAL,
  week_52_high REAL,
  week_52_low REAL,
  pe_ratio REAL,
  pb_ratio REAL,
  dividend_yield REAL,
  enterprise_value REAL,
  fundamentals_period_end TEXT,
  pe_earnings_section TEXT,
  pe_earnings_basis TEXT,
  pe_earnings_period_duration TEXT,
  PRIMARY KEY (ticker, date)
);

CREATE INDEX IF NOT EXISTS idx_market_data_date ON market_data(date);
