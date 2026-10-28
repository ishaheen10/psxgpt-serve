# Narrative Lane + AnalystContext Improvement Plan

## User goals

1. Improve formatting of SQL-derived outputs before they go to analyst.
2. Improve quality of narrative page gists sent to analyst.
3. Identify and prune metadata/reference noise.

## Current state

The current implementation works, but AnalystContext mixes useful signal with low-signal noise in all three places:

- Structured lane artifacts (tables, rows, coverage and debug fields).
- Narrative page selection and extraction defaults.
- Source metadata duplication between analyst-facing context and internal provenance/debug traces.

This plan keeps structural behavior stable:

- No routing changes.
- No structured-table compute changes.
- No change to lane success/failure contracts.

## Source surfacing principle (important)

Keep source visibility even when source metadata is pruned from reasoning rows.

- Analyst reasoning context should include:
  - structured rows and coverage context
  - concise summaries and lane-level interpretation
- Source visibility should stay explicit via a separate `sources` payload:
  - stable `source_id`/`tag`
  - human-readable `snippet`
  - `sourceType`, `ticker`, `filingPeriod/page`, and `pdf/thumbnail` links
- Internal traces should keep full raw diagnostic material for replay/audit.

This means we should not “remove sources,” we should separate:

1) compact reasoning payload
2) dedicated source list
3) internal debug traces

## 1) Structured SQL formatting: make analyst-facing payload compact and interpretable

### Problem

Structured row payloads are often verbose and include fields that are less helpful for synthesis. DeepSeek has to infer what to use.

### What to fix

- Produce a compact, deterministic presentation layer for each table artifact:
  - standard header block
  - metric coverage block
  - full structured row delivery (all rows intended for analysis), not sampled
- Normalize numeric rendering for readability and consistency:
  - dates normalized to `YYYY-MM-DD`
  - percentages to 4 decimals where applicable
  - values like `market_cap` / `closing_price` fixed to readable scale
  - explicit `-` for missing values
- Keep full CSV payload for traceability, but prioritize the compact summary in analyst context.
  - Do not rely on sample rows for synthesis; analyst should consume all provided data.

### Source list requirement

- Structured context must continue to return a dedicated source list for every lane that produces narrative or provenance-backed rows.
- Sources should be deduplicated and ordered for relevance, but never dropped silently unless out-of-bounds by explicit budget policy.

### What to include per structured output

- `artifact_title`
- `tickers_in_scope` and `requested_tickers`
- `period_window` (`earliest_period` → `latest_period`)
- `metric_columns` and `metric_count`
- `coverage_gaps` (where applicable)
- `rows` (complete set for that lane)

### Why this helps

- Keeps all relevant data in context while reducing parsing noise.
- Reduces accidental over-interpretation from raw columns.
- Keeps the deterministic evidence contract while improving synthesis quality.

## 2) Narrative page gist quality: intent-aware extraction and ranking

### Problem

Narrative extraction and page ranking are currently broad and not always intention-specific, so DeepSeek receives either too much low-signal extraction or too little high-signal coverage.

### What to fix

- Create an explicit evidence profile per narrative ask:
  - `ask_type`: `find`, `compare`, `summarize`, `evolve`, `risk`, `outlook`, `fact_check`
  - `required_ticker_coverage`: strict / partial / broad
  - `extraction_mode`: `required`, `optional`, `off`
  - `depth`: `shallow`, `standard`, `deep`
- Use the profile to steer:
  - extraction invocation
  - number of candidate pages kept
  - which pages are prioritized for final analyst context
- For compare/evolve/fact-check asks:
  - prioritize per-ticker balanced coverage
  - stronger ranking toward section/topic-matching pages
  - extract by concise evidence schema (claim + quote + period + ticker)
- For find/retrieve asks:
  - allow raw narrative pages with minimal extraction when possible
  - avoid expensive extraction unless it materially improves answer quality

### Narrative page output model

- Preserve one per-page evidence record with schema:
  - `ticker`
  - `period`
  - `topic`
  - `claim`
  - `supporting_quote`
  - `source_score_hint`
- Keep raw page fallback if extraction confidence is low, but filter page order by ranked quality first.

## 3) Metadata/reference noise: prune low-value fields and duplicates

### Problem

Some repeated metadata fields and cross-links are duplicated across payload sections. They are useful for debug but reduce signal quality for analyst reasoning.

### What to prune from analyst-facing context

- Duplicate source IDs that appear in both narrative context and provenance/debug payloads.
- Repeated metadata fields that do not change decision quality for the model.
- Long internal traces mixed with assistant-facing evidence.
- Overly long source snippets for pages not used in final ranking.

### What to keep in analyst-facing context

- concise lane summaries with pass/fail reason
- selected_tickers and effective scope
- extraction count and extraction misses
- short source quality rationale per table group

### What to keep only in internal traces

- full model/run diagnostics
- query-by-query raw SQL samples beyond compact summary
- low-level trace fields used for UI/audit only

## End-to-end rollout sequence (no code changes now)

### Phase 1 — Contract/format spec

- Finalize the structured output template.
- Finalize evidence profiles for narrative asks.
- Add a metadata noise policy matrix.

### Phase 2 — Narrative policy refinement

- Apply intent-aware extraction profile.
- Apply narrative page prioritization by topic coverage and ask type.

### Phase 3 — Analyst payload pruning

- Enforce compact summary-first payload for both structured and narrative context.
- Deduplicate analyst-facing references while preserving internal audit fidelity.

## Acceptance checks

For each phase, verify on controlled scenarios:

- single ticker narrative deep-dive
- 2–4 ticker narrative compare
- wide industry narrative context
- PSX announcement retrieval and follow-up
- macro commentary request

Metrics to track:

- evidence relevance score from eval samples
- lane failure/noise incidents
- analyst token volume per query
- extracted page usefulness (non-null, in-scope)
- user-visible citation quality (fewer wrong or noisy citations)

## Non-goals

- Do not alter structured compute logic.
- Do not alter lane success criteria.
- Do not remove safety caps entirely.
- Do not expand routing to narrative unless the user intent already requires it.
