SQLite (Cloudflare D1). CTEs, window functions, JOINs supported.

## financial_statements
Structured financial data. Each row = one line item for one company/period. Values in PKR thousands.

| Column | Type | Notes |
|--------|------|-------|
| ticker | TEXT | Company symbol |
| company_name | TEXT | |
| industry | TEXT | See industry list below |
| period_type | TEXT | 'annual' \| 'quarterly' |
| period_end | TEXT | ISO date, see exhaustive list below |
| period_duration | TEXT | '3M' \| '6M' \| '9M' \| '12M' \| 'PIT' (balance sheet) |
| fiscal_year | INTEGER | 2017–2026 |
| section | TEXT | 'consolidated' \| 'unconsolidated' |
| statement_type | TEXT | 'profit_loss' \| 'balance_sheet' \| 'cash_flow' |
| canonical_field | TEXT | Standardized metric name, see lists below |
| original_name | TEXT | Original label from filing |
| value | REAL | In PKR thousands |

Important facts about this table:
- A ticker can have BOTH consolidated and unconsolidated rows for the same period. Filter by section or use MAX(value) to deduplicate.
- period_type indicates which FILING the data was extracted from, not the time granularity. Data for period_end '2024-12-31' may have period_type 'annual'. Filtering period_type = 'quarterly' will silently drop these rows. Use period_end to select time periods, not period_type.
- For profit_loss and cash_flow comparisons, use period_duration ('3M', '6M', '9M', '12M') to compare like-for-like periods.

### period_end values (exhaustive — use directly, do not query for these)
2017-12-31, 2018-12-31, 2019-06-30, 2019-12-31, 2020-03-31, 2020-06-30, 2020-09-30, 2020-12-31, 2021-03-31, 2021-06-30, 2021-09-30, 2021-12-31, 2022-03-31, 2022-06-30, 2022-09-30, 2022-12-31, 2023-03-31, 2023-06-30, 2023-09-30, 2023-12-31, 2024-03-31, 2024-06-30, 2024-09-30, 2024-12-31, 2025-03-31, 2025-06-30, 2025-09-30, 2025-12-31

### industries
Airlines, Auto Assembly, Banking, Cement, Chemicals, Conglomerate, Consumer Goods, Fertilizer, Food, Gas Infrastructure, Glass, Healthcare, Hospitality, Industrials, Insurance, Investment Holding, Leasing, Logistics, OMC, Packaging, Pharmaceuticals, Power, Real Estate, Refineries, Steel, Sugar, Technology, Telecommunications, Textile, Tobacco, Upstream

### canonical_field by statement_type (grouped by section)

**profit_loss (Corporate):**
- Revenue: revenue_net, revenue_gross, cost_of_revenue, gross_profit
- Operating: operating_expenses, administrative_expenses, operating_profit, other_income, other_operating, other_expenses, other_non_operating
- Below operating: finance_cost, share_of_associates, provisions, workers_welfare_fund, other_charges, levy, exploration_cost, royalties, profit_before_tax
- Bottom line: taxation, taxation_current, taxation_deferred, taxation_prior, net_profit, net_profit_parent, nci_income, eps, eps_diluted, ebitda, other_comprehensive_income, total_comprehensive_income

**profit_loss (Bank):**
- Interest: bank_interest_income, bank_interest_expense, net_interest_income
- Non-interest: fee_income, fx_income, dividend_income, trading_gains, other_non_interest_income, total_income
- Expenses: operating_expenses, provisions, workers_welfare_fund, other_charges, other_bank_adjustments, profit_before_tax
- Bottom line: taxation, net_profit, eps

**profit_loss (Insurance):**
- Underwriting: net_premium, gross_premium, claims_expense, commission_expense, other_underwriting, other_insurance_adjustments, underwriting_profit
- Below underwriting: investment_income, other_income, operating_expenses, finance_cost, profit_before_tax
- Bottom line: taxation, net_profit, eps

**balance_sheet (Corporate):**
- Current assets: total_current_assets, cash_and_equivalents, short_term_investments, receivables, other_receivables, inventory, prepayments, contract_assets, other_current_assets
- Non-current assets: total_non_current_assets, property_equipment, intangibles, right_of_use_assets, long_term_investments, investment_property, deferred_tax_assets, long_term_deposits, other_non_current_assets
- Current liabilities: total_current_liabilities, payables, short_term_debt, borrowings, lease_liabilities_current, contract_liabilities, provisions, other_current_liabilities
- Non-current liabilities: total_non_current_liabilities, long_term_debt, deferred_tax_liability, lease_liabilities, deferred_liabilities, employee_benefit_obligations, other_non_current_liabilities
- Equity: total_equity, share_capital, reserves, revaluation_surplus, retained_earnings, share_premium, nci
- Totals: total_assets, total_liabilities, total_equity_and_liabilities

**balance_sheet (Bank):**
- Assets: total_assets, cash_and_balances_with_treasury_banks, balances_with_other_banks, lending_to_fis, investments, advances, property_equipment, intangibles, right_of_use_assets, deferred_tax_assets, other_assets
- Liabilities: total_liabilities, bills_payable, borrowings, deposits, lease_liabilities, subordinated_debt, deferred_tax_liability, other_liabilities
- Equity: total_equity, total_equity_attributable_to_holders, share_capital, reserves, revaluation_surplus, retained_earnings, unappropriated_profit, nci
- Totals: total_equity_and_liabilities

**cash_flow:**
- Operating (CFO): cfo, cash_generated_from_operations, depreciation_amortization, provisions_cf, gain_on_sale_fixed_assets, share_of_profit_associates, fair_value_gains_losses, finance_cost_paid, interest_paid, taxes_paid, change_in_operating_assets, change_in_operating_liabilities, change_in_receivables, change_in_payables, change_in_inventory, change_in_other_working_capital, other_operating_adjustments
- Investing (CFI): cfi, capex, asset_sales, investment_purchases, investment_sales, dividend_received, interest_received, other_investing
- Financing (CFF): cff, dividends_paid, borrowings_raised, borrowings_repaid, equity_issued, lease_principal_paid, other_financing
- Net: net_cash_change, cash_start, cash_end

## filings_fts
Full-text search over filing pages for the current 471-ticker statement/document corpus. The user-facing served ticker reference can be narrower than the raw corpus when a ticker has only stale or unusable market price data; those symbols are excluded from routing until current close and market cap are available. Each match = one page of a company filing.

FTS5 virtual table. Search with MATCH, join to financial_documents for metadata:
`FROM filings_fts JOIN financial_documents fd ON fd.id = filings_fts.rowid WHERE filings_fts MATCH '...'`

| Column (from join) | Type | Notes |
|--------------------|------|-------|
| fd.id | INTEGER | Page ID (use for submit_sources) |
| fd.ticker | TEXT | |
| fd.filing_type | TEXT | 'annual' \| 'quarterly' |
| fd.filing_period | TEXT | e.g. '2025-09-30' |
| fd.filing_year | INTEGER | |
| fd.pg | INTEGER | Page number |
| fd.search_text | TEXT | BM25-oriented page retrieval text |

MATCH syntax: `'term'`, `'"exact phrase"'`, `'a OR b'`, `'prefix*'`. Use `ORDER BY rank` for relevance.

## market_data
Daily market metrics per ticker.

| Column | Type | Notes |
|--------|------|-------|
| symbol | TEXT | Ticker |
| date | TEXT | ISO date (use MAX(date) for latest) |
| closing_price | REAL | |
| total_shares | INTEGER | |
| market_cap | REAL | PKR (raw, not billions) |
| eps | REAL | |
| pe_ratio | REAL | |
| dividend_per_share | REAL | |
| dividend_yield | REAL | Percentage |
| week_52_high | REAL | |
| week_52_low | REAL | |

## market_valuation
Latest valuation snapshot per ticker, rebuilt from `market_data` + `financial_statements`.

| Column | Type | Notes |
|--------|------|-------|
| symbol | TEXT | Ticker |
| date | TEXT | Snapshot date |
| closing_price | REAL | |
| total_shares | INTEGER | |
| market_cap | REAL | PKR (raw) |
| week_52_high | REAL | |
| week_52_low | REAL | |
| pe_ratio | REAL | |
| pb_ratio | REAL | |
| dividend_yield | REAL | Percentage |
| roe | REAL | Percentage |
| enterprise_value | REAL | PKR (NULL for Banking/Insurance) |

## management_comp
Executive compensation aggregates by ticker/year/role.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Row ID |
| ticker | TEXT | Company symbol |
| company_name | TEXT | |
| industry | TEXT | |
| year | INTEGER | Fiscal year |
| section | TEXT | Optional classification |
| role | TEXT | Executive role/title |
| persons | INTEGER | Number of people in role |
| base_salary | REAL | PKR |
| bonus | REAL | PKR |
| housing | REAL | PKR |
| retirement | REAL | PKR |
| other_benefits | REAL | PKR |
| total | REAL | PKR |
| source_pdf | TEXT | Source reference |

## financial_documents
Document/page metadata for filing sources.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Page ID |
| ticker | TEXT | |
| filing_type | TEXT | 'annual' \| 'quarterly' |
| filing_period | TEXT | |
| filing_year | INTEGER | |
| section_tags | JSON | Parsed section tags |
| pg | INTEGER | Page number |
| jpg_path | TEXT | Page image path |
| search_text | TEXT | Page retrieval text |
| text | TEXT | OCR text (when requested) |
