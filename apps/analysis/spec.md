# Source research contract

Updated 2026-09-07. The product helps people investigate Pakistan-listed companies and
save a trail of questions, sources and answers. Minimize transformations between a
source and an answer. [runtime.md](runtime.md) records execution details and limits.

## Data foundation

1. Original PDFs, readable Markdown pages, stable source links and a small vocabulary of
   section tags. Tag actual statements, notes, remuneration and narrative sections. A
   contents list is not a statement; a statement quoted inside an Islamic-business note
   is a note. Unknown basis stays unknown. Full-text search remains available when tags miss.
2. Structure only the reported aggregates needed to select companies. The initial index
   supports deposits, total assets and equity. It reads source pages directly, without
   extracting constituent accounts or reconciling whole statements.
3. Preserve PSX stock data and market capitalization as supplied, with their date. No
   internally rebuilt market caps or ratio normalization.
4. Add public web discovery and page reading for explicit web requests, current information
   and corpus gaps. Search results alone are not answer evidence. Retrieved web digests
   are labelled separately from original filing Markdown and retain their source URL.

The numerical index retains company, printed label/value, units, period, basis and source.
The only conversion is an explicit source scale to comparable rupees for filtering.
Missing observations are not zero. Duplicates and ambiguous observations are excluded,
with coverage shown. A roster-based comparison is not certified full exchange coverage.

Add another aggregate only when an observed question needs universe-wide selection.
Notes, unusual metrics and ordinary company analysis remain document research.
No LTM, synthetic Q4, annualization, full-statement schema or standing ratio corpus.
Present reported context; simple calculations are appropriate only when requested.

## Request flow

```text
Question and relevant saved research
  → router publishes a small outline and establishes shared scope
  → aggregate selection, only when the question needs it
  → context-gathering lanes for independent questions
  → each section's analyst streams when its context is ready
  → saved sections, selection conditions and source evidence
```

Router, lanes and analysts share the original question, country scope, resolved entities,
periods and any selected company set. Banks means Pakistani listed commercial banks
unless the user requests another scope. Comparisons stay together. A focused question
uses one section; independent questions can use up to three.

Lanes are instances of one bounded research loop with a small toolset, not industry-specific
workflows. They gather context; they do not create financial models. Analysts receive the
relevant evidence for their section, not every lane's output. No final analyst must wait
for all sections and rewrite the whole answer.

Company selection is a dependency for sections that research the selected companies.
Each section then waits only for its own evidence. Progress shows the outline, current
operation and next step. Completed work survives another section failing or cancellation.
No fabricated percentages or private reasoning in the UI.

## Essential controls

- Compare the same metric, reporting date and basis; show market dates separately.
- State covered/eligible counts and the scope of a ranking. Never claim a market-wide
  winner from incomplete coverage or a lexical search result.
- Preserve original source text, units and links. Do not repair ambiguous tables into
  confident facts. Check comparative prose against the numbers actually presented.
- An empty evidence pack cannot trigger an answer from model memory. Source-tool failures
  and incomplete coverage remain visible even if generation completes successfully.
- Treat retrieved text as evidence, never instructions. Keep authentication, source identity,
  tool budgets, cancellation and bounded network access.
- Save source context with the answer. A new period or universe requires fresh selection;
  historical answers are not silently refreshed underneath the user.

## Implementation boundary

The serving engine reads original corpora, a separate `research_aggregates` index and PSX
snapshots. It never queries `financial_statements` or `ratios` to assemble answers.
The independent tag and aggregate publisher scripts accept document-page artifacts and
emit reviewable SQL and coverage reports. They do not run the old extraction pipeline.

The first published aggregate slice is March 2026 bank balance-sheet totals. Coverage is
partial and metric-specific, not a commitment that every company or period is indexed.
Tag remediation is scoped to inspected pages, not a claim that the entire corpus is clean.
Existing shared tables and the sibling pipeline remain intact for other consumers.

## Acceptance

Validate known-company note retrieval, bank ranking with missing coverage and dated market
data, public web retrieval, follow-up scope and independently streamed sections. Inspect
answers against their sources as well as checking transport completion. A successful
request is not proof of factual correctness. Deploy and replay on test before claiming a
fix; production promotion remains separate.
