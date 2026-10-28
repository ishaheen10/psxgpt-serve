# Next Phase Objectives

## North Star

psxGPT should behave like a source-grounded PSX financial workstation: CapIQ-quality audited corpus, Excel-like deterministic modeling, and chat as the interface for retrieval, analysis, transformation, and what-if work.

The next phase should build on the implemented baseline rather than recreate it. The baseline already includes typed router/lane asks, curated D1 query views, source recovery, data-quality cautions, data-health UI, deterministic model-build for banks and non-financials, deterministic ROIC/dividend-yield screens, eval endpoints, and shared report previews.

## Primary Objective

Make historical financial model inputs and follow-up model transformations reliable enough to support valuation-grade user workflows.

This means the system should retrieve compact model-ready inputs, align periods correctly, compute historical ratios deterministically, preserve source traceability, and then let users change assumptions or requested numbers in follow-up turns without losing the model state.

## Workstream 1: Model-Ready Historical Post-Processing

Tighten the current partial implementation so it can be treated as production-grade for valuation and model-building queries.

Required outcomes:

- Annual vs LTM selection is explicit and traceable.
- Period alignment is deterministic across income statement, balance sheet, cash flow, market data, and ratios.
- Missing/null inputs are classified as unavailable, stale, or unsupported instead of silently dropped.
- Bank and non-bank model input packs use industry-appropriate metrics.
- Output artifacts show the exact rows, periods, source pages, and formulas used.

Acceptance checks:

- A model-build query for representative bank, cement, fertilizer, pharma, E&P, power, textile, and holding-company cases produces compact aligned model inputs or an explicit unsupported reason.
- Follow-up questions can inspect the same historical input table without re-querying unrelated broad surfaces.
- Eval traces show no broad raw `financial_statements` pulls when a curated model-input view is sufficient.

## Workstream 2: Deterministic Follow-Up Model Transforms

Move common assumption edits and what-if calculations into deterministic code over saved model state.

Required outcomes:

- Saved models expose a typed state object with base historicals, assumptions, formulas, and scenario outputs.
- Follow-up edits update only the requested assumptions or line items.
- Supported edits include revenue/deposit growth, margins/spreads, cost ratios, discount rate, terminal growth, capex, working capital, and payout assumptions where the model template supports them.
- Unsupported edits fail with a precise missing-input or unsupported-template message.

Acceptance checks:

- Query: build a model for a bank, then "increase deposit growth by 200bps" updates only deposit-growth-linked projections.
- Query: build a model for a non-bank, then "use 14% discount rate and 4% terminal growth" updates valuation output deterministically.
- Query: "show numerator and denominator" returns formulas and values from the saved model, not a new hallucinated calculation.

## Workstream 3: Query-Surface Expansion From Real Traces

Use recent query traces to add the next batch of curated D1 views or lane playbooks only where repeated broad pulls remain.

Candidate surfaces:

- Bank deposits, CASA/current/savings mix, cost of deposits, advances, NPL/provisioning, and spreads.
- Revenue, gross margin, operating margin, capex, depreciation, working capital, and cash conversion.
- Debt, finance cost, maturity notes, and borrowing movement.
- Segment/geography views where source coverage is reliable enough.

Acceptance checks:

- For each new surface, keep a before/after trace showing row counts, latency, retrieved sources, and answer quality.
- Add a regression eval for the query shape that motivated the surface.
- Do not add views without observed query demand or a clear model-input dependency.

## Workstream 4: Source Relevance Evaluation

Go beyond "sources present" and evaluate whether the selected pages are actually the best evidence for the question.

Required outcomes:

- Eval artifacts classify source failures separately from answer failures.
- Source checks compare requested ticker, period, topic, and page type against selected pages.
- Weak source selection produces a repair target: router, lane FTS terms, shaping tool, extraction prompt, or upstream corpus issue.

Acceptance checks:

- Recent-50 eval includes a source-relevance section.
- At least one source-relevance failure is traced to the earliest fixable stage and converted into a canary.

## Workstream 5: Pipeline Issue Contracts

Make pipeline/DB quality work more targeted by requiring every issue output to identify the earliest failing stage.

Required outcomes:

- Open quality issues include ticker, period, filing, statement, metric, source page, failing stage, and recommended rerun command.
- Aggregate yellow/red health flags link back to the exact issue record.
- Fixes are made at the earliest bad artifact, not by patching served rows.

Acceptance checks:

- A database-health red/yellow cell can be followed to the source page and a deterministic rerun command.
- A repaired ticker-period has before/after evidence in artifacts and D1 spot checks.

## Operating Rules

- Do not rework already-implemented surfaces unless traces show they are wrong or too slow.
- Do not change financial definitions to pass evals. P/E remains market cap divided by annual or LTM net income/net profit.
- Do not use SCS as production source of truth; use it only as an external reference check.
- Do not patch serve around bad pipeline data.
- Every meaningful behavior change should update spec/docs, changelog, evals, and deployment evidence.
