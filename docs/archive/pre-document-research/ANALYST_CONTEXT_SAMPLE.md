# AnalystContext Sample And Review

This note shows what the analyst model currently receives at the final write stage. It uses a real recent trace as the sample:

- Trace id: `f179976f-9feb-46cd-b022-b3b64cfdfed8`
- Query: `FCL what is the trading setup for it?`
- Payload field: `analyst.analyst_user_message_text`

The exact payload is assembled by `buildAnalystMessage()` in `apps/analysis/src/engine/analyst.ts`.

## Current Shape

The analyst receives one final `user` message with these sections:

1. `USER QUERY`
2. `ANSWER SCOPE`
3. `CONTEXT COVERAGE`
4. `RETRIEVAL SUMMARY`
5. `DATA QUALITY WARNINGS`
6. `COMPUTED DATA`
7. `SOURCES`

The system prompt and citation contract are separate. Chat history, when selected, is also separate and appears before this final user message.

## Sample Payload

```text
USER QUERY
[Today: 2026-06-26] FCL what is the trading setup for it?

ANSWER SCOPE
Retrieved ticker scope: FCL (1 tickers).
If the user mentions a different company count, do not repeat that count unless the retrieved ticker scope supports it.
Do not discuss, rank, value, or compare companies outside this retrieved scope unless explicitly flagged as missing coverage.

CONTEXT COVERAGE
[TABLE 1] Latest Market Data for FCL: 1 rows; columns: ticker, closing_price, week_52_high, week_52_low, market_cap, date; coverage: rows fed=1 of submitted=1; final_sql_rows=1; requested tickers=FCL; fed tickers=FCL; periods=2026-06-24; market max date=2026-06-24
[TABLE 2] Latest Financial Performance Summary: FCL: 90 rows; columns: ticker, period_end, period_duration, statement_type, canonical_name, value; coverage: rows fed=90 of submitted=90; final_sql_rows=90; requested tickers=FCL; fed tickers=FCL; canonicals=cash_and_equivalents, total_assets, total_equity, eps, finance_cost, gross_profit, net_profit, operating_profit, revenue_net; periods=2026-03-31, 2025-12-31, 2025-06-30, 2025-03-31
[1] FCL 2026-04-17 announcement: extracted evidence
[2] FCL 2026-05-06 announcement: extracted evidence
[3] FCL 2026-02-18 announcement: extracted evidence
[4] FCL 2026-06-22 announcement: extracted evidence
[5] FCL 2026-02-13 announcement: extracted evidence
[6] FCL 2026-04-27 announcement: extracted evidence

RETRIEVAL SUMMARY
1. [market_data] latest market price, 52-week range, and market cap for FCL
   Result: Latest Market Data for FCL: 1 rows

2. [psx_announcements] recent PSX announcements, unusual movement notices, or material disclosures for FCL
   Result: Recent material disclosures and corporate announcements for FCL: 6 pages, 6 extractions
   Selected tickers: FCL

3. [financial_statements] latest annual and interim financial performance summary for FCL
   Result: Latest Financial Performance Summary: FCL: 90 rows

DATA QUALITY WARNINGS
none

COMPUTED DATA
[TABLE 1] Latest Market Data for FCL
ticker,closing_price,week_52_high,week_52_low,market_cap,date
FCL,24.28,24.89,24.25,15650289498,2026-06-24

[TABLE 2] Latest Financial Performance Summary: FCL
ticker,period_end,period_duration,statement_type,canonical_name,value
FCL,2026-03-31,PIT,balance_sheet,cash_and_equivalents,141759
FCL,2026-03-31,PIT,balance_sheet,total_assets,38774455
FCL,2026-03-31,PIT,balance_sheet,total_equity,15470830
FCL,2026-03-31,3M,profit_loss,eps,0.63
FCL,2026-03-31,9M,profit_loss,eps,1.95
FCL,2026-03-31,LTM,profit_loss,eps,2.0799999999999996
FCL,2026-03-31,LTM,profit_loss,eps,2.2199999999999998
FCL,2026-03-31,3M,profit_loss,finance_cost,-431534
...
FCL,2025-03-31,LTM,profit_loss,revenue_net,36187421
FCL,2025-03-31,LTM,profit_loss,revenue_net,35130699

SOURCES
══ [1] FCL 2026-04-17 Announcement
Ticker: FCL, Date: 2026-04-17. The company issued a notice regarding a Corporate Briefing Session for FY 2025, providing a link to a YouTube playlist for the session...

---

══ [2] FCL 2026-05-06 Announcement
FCL announced the successful consolidation of its manufacturing units to enhance operational efficiency, stating that the integration is expected to deliver annual cost savings of approximately PKR 100 million...

---

══ [3] FCL 2026-02-18 Announcement
FCL disclosed the successful completion of its plant and machinery expansion funded by IPO proceeds...

---

══ [4] FCL 2026-06-22 Announcement
The Board approved the Annual Budget for FY 2026-27 and stated that there was no price-sensitive information...

---

══ [5] FCL 2026-02-13 Announcement
For the half year ended December 31, 2025, FCL reported financial results and stated NIL for dividends, bonus, rights, or other price-sensitive information.

---

══ [6] FCL 2026-04-27 Announcement
FCL announced quarterly results for March 31, 2026 and stated NIL for dividends, bonus, rights, or other price-sensitive information.
```

## What This Gets Right

- It gives the analyst the original user query with today’s date.
- It constrains answer scope to retrieved ticker coverage.
- It separates structured computed data from narrative source text.
- It labels sources with stable source tags the analyst can cite.
- It includes retrieval coverage, so the analyst can disclose missing or thin coverage.
- It includes deterministic QC warnings when available.

## What Feels Noisy

The biggest problem is not the section structure. The problem is that the payload sends raw lane output instead of a task-shaped analyst pack.

For the FCL trading setup query, the analyst receives:

- A full 90-row financial table even though the user asked for a trading setup.
- Duplicate-looking LTM rows for the same metric and period.
- Historical rows that are useful for context but not prioritized into a concise trend table.
- Announcements that are individually useful, but not grouped into `positive`, `neutral`, `risk`, or `price-sensitive` buckets.
- No explicit trading-specific computed fields such as distance to 52-week high/low, recent catalyst map, earnings momentum, or valuation/multiple context.

This makes the analyst do too much sorting in token space.

## What Feels Missing

For this query shape, the analyst would benefit from a smaller task-specific pack:

```text
TRADING SETUP PACK
ticker: FCL
as_of_market_date: 2026-06-24
last_price: 24.28
52w_high: 24.89
52w_low: 24.25
distance_to_52w_high: -2.5%
distance_to_52w_low: +0.1%
market_cap: 15.65bn

RECENT FINANCIAL MOMENTUM
latest_quarter: 2026-03-31
revenue_3m: 8.24bn
gross_profit_3m: 1.67bn
net_profit_3m: 406m
eps_3m: 0.63
revenue_9m: 26.31bn
net_profit_9m: 1.26bn
eps_9m: 1.95

CATALYSTS AND DISCLOSURES
positive:
- manufacturing consolidation expected to save PKR 100m annually [2]
- IPO-funded plant and machinery expansion completed [3]
neutral:
- FY2026-27 budget approved with no price-sensitive information [4]
- no dividend or other entitlement in recent result notices [5], [6]
unknown:
- no technical chart series, volume trend, order book, or broker-flow data supplied

ANSWER GUARDRAILS
- Do not produce technical-analysis claims unless market price series/volume data was retrieved.
- Treat this as a fundamental/news trading setup, not a chart setup.
- State that current price is very close to the 52-week high/low range if using the supplied market fields.
```

## Recommended Direction

Keep the current AnalystContext sections, but change what goes inside `COMPUTED DATA` for common query shapes.

### 1. Add query-shaped attachments

Instead of always sending raw rows, post-process rows into compact model-ready attachments:

- `ticker_overview_pack`
- `trading_setup_pack`
- `valuation_pack`
- `bank_sensitivity_pack`
- `latest_results_pack`
- `source_discovery_pack`

The raw row table should stay in trace/debug, not always in AnalystContext.

### 2. Cap raw statement rows unless explicitly needed

For broad context queries, send the shaped pack first. Include raw rows only when:

- the user asks for detailed line items,
- the shaped pack cannot be computed,
- or a QC/debug answer needs row-level evidence.

### 3. Remove duplicate LTM rows before AnalystContext

The FCL sample shows repeated LTM values for the same metric/period. That may be explainable by different source bases or derived variants, but AnalystContext currently does not tell the analyst how to choose between them.

Either:

- dedupe upstream before the final attachment, or
- add a `basis`/`source` column and explicitly label which row is preferred.

### 4. Compress source evidence by role

Narrative pages should be grouped before the analyst sees them:

- `primary support`
- `recent catalyst`
- `risk or caution`
- `not useful / no price-sensitive information`

The full source text can still be available in trace and source panel.

### 5. Keep coverage, but make it shorter

Current coverage lines are useful but verbose. A compact version would be enough:

```text
COVERAGE SNAPSHOT
- market_data: 1 row, latest date 2026-06-24
- financial_statements: 90 rows submitted, 90 fed; latest period 2026-03-31
- psx_announcements: 6 extracted announcements
- missing: chart history, volume trend, technical indicators
```

## Proposed Target Payload For The Same Query

```text
USER QUERY
[Today: 2026-06-26] FCL what is the trading setup for it?

ANSWER SCOPE
Retrieved ticker scope: FCL.
This is a fundamental/news setup because no technical price-series or volume history was retrieved.

COVERAGE SNAPSHOT
- market_data: latest price and 52-week range as of 2026-06-24
- financial_statements: latest quarterly/interim performance through 2026-03-31
- psx_announcements: 6 recent extracted announcements
- missing: daily chart series, volume trend, moving averages, broker-flow/order-book data

RETRIEVAL SUMMARY
1. market_data: latest price, 52-week range, market cap
2. financial_statements: latest revenue/profit/eps/balance-sheet snapshot
3. psx_announcements: recent corporate announcements and material disclosures

NARRATIVE SOURCE MAP
1. [psx_announcements] FCL announcement page metadata, retrieval role, compact snippet
2. [psx_announcements] FCL announcement page metadata, retrieval role, compact snippet

DATA QUALITY WARNINGS
none

COMPUTED DATA
[TABLE 1] Trading setup pack
field,value
ticker,FCL
market_date,2026-06-24
last_price,24.28
52w_high,24.89
52w_low,24.25
distance_to_52w_high,-2.5%
distance_to_52w_low,0.1%
market_cap,15.65bn
latest_quarter,2026-03-31
revenue_3m,8.24bn
net_profit_3m,406m
eps_3m,0.63
revenue_9m,26.31bn
net_profit_9m,1.26bn
eps_9m,1.95

[TABLE 2] Catalyst map
type,date,summary,source
positive,2026-05-06,manufacturing consolidation expected to save PKR 100m annually,[2]
positive,2026-02-18,IPO-funded plant and machinery expansion completed,[3]
neutral,2026-06-22,FY2026-27 budget approved; no price-sensitive information,[4]
neutral,2026-02-13,no dividend/bonus/right/price-sensitive information with HY results,[5]
neutral,2026-04-27,no dividend/bonus/right/price-sensitive information with quarterly results,[6]

SOURCES
══ [1] FCL 2026-04-17 Announcement
Corporate briefing session notice for FY2025.

══ [2] FCL 2026-05-06 Announcement
Manufacturing-unit consolidation expected to deliver annual cost savings of approximately PKR 100 million.

══ [3] FCL 2026-02-18 Announcement
Plant and machinery expansion funded by IPO proceeds completed.

══ [4] FCL 2026-06-22 Announcement
FY2026-27 annual budget approved; no price-sensitive information.

══ [5] FCL 2026-02-13 Announcement
HY2025 result notice; NIL dividend/bonus/right/price-sensitive information.

══ [6] FCL 2026-04-27 Announcement
Q3 result notice; NIL dividend/bonus/right/price-sensitive information.
```

## Bottom Line

The current AnalystContext is accurate but not sufficiently opinionated about what the analyst needs. It is sending correct artifacts, but too often in raw operational form.

The fix should not be to remove traceability. The fix should be:

- keep raw rows in traces,
- send compact query-shaped tables to AnalystContext,
- keep source tags and short evidence excerpts,
- explicitly disclose missing data needed for the requested answer type.
