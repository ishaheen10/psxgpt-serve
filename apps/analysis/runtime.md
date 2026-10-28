# Current research runtime

The active engine is `src/research/engine.ts`. Gemini plans one to three sections and
requests source tools; DeepSeek streams one answer per section. Comparisons stay together.
Every section receives the original query, shared Pakistan scope and optional selection.

## Tools and evidence

- `find_companies`: application roster; this is not independently certified exchange membership.
- `find_tagged_pages`: exact section tags and optional basis; `search_pages` remains the fallback.
- `list_documents`, `search_pages`, `read_pages`: inventories and original filing, announcement
  and macro Markdown. Search snippets do not enter the writer's evidence pack. Filing search accepts annual/quarterly and reporting-year filters.
- `market_snapshot`: dated PSX price, shares, market cap and 52-week range, as supplied.
- `search_web`, `read_web`: Gemini Google Search discovery followed by URL-context retrieval.
  Only successful page retrieval creates evidence. Canonical URLs returned after redirects
  are retained. Web text is a model-produced digest, explicitly distinguished from originals.
- Planner-requested `select_companies`: fixed aggregate allowlist, industry, one reporting
  date/basis, sort, bounded result count and optional numeric bounds in rupees. Selection
  precedes dependent research and carries coverage, excluded companies and source pages.

No normalized statement or precomputed ratio table supplies research. `research_aggregates`
contains direct reported deposits, assets and equity, with original units and source text.
Current population is a bounded March 2026 bank slice; availability varies by metric.

## Limits and delivery

At most three concurrent sections, eight retrieval turns and twelve tool calls per section.
At most 24 source pages per section, six filing IDs per read, 20,000 characters per filing
page with truncation disclosed, and twelve reused pages. Web calls have a 35-second timeout
inside the 150-second request deadline. No new tool call starts after cancellation.

Sections stream with actual operations and next steps. `finish_research` declares supported,
partial or unsupported evidence coverage; coverage gaps remain visible separately from
provider failures. An empty source pack cannot trigger a writer call. A Sources read footer preserves any source links omitted by the writer without rewriting its claims. This is not a semantic
correctness certificate: sampled answer review remains necessary.

Durable Object `research_reports` persists private session snapshots. Session deletion
removes them. D1 `research_runs` records owner/admin trace evidence. Existing authentication,
sharing, history and historical trace/model readers remain. No legacy financial engine runs.

## Independent corpus utilities

Run from the repository root:

```sh
node apps/analysis/scripts/tag-research-pages.mjs pages.json output/tags ../psxgpt-pipeline/review
node apps/analysis/scripts/build-research-index.mjs pages.json output/aggregates
```

Input is document publication rows, with id, ticker, period metadata, jpg_path and text.
Tagging also accepts Wrangler JSON. Its optional third argument synchronizes existing pipeline review JSONL so later document publication preserves the corrected tags. The aggregate publisher reads the linked original
page PDFs, copies only three reported totals and checks the printed value/label against
Markdown. It does not derive periods or reconcile accounts. Ambiguity stays excluded.

Both emit artifacts and scoped `publish.sql`; neither pushes D1 automatically. The optional review-root argument writes the matching upstream review artifacts. Inspect source
fidelity and coverage before executing SQL on shared D1. Tag updates match both ID and
original text to avoid applying stale annotations. Aggregate publication replaces only
observations from the supplied source IDs. Cache entries track source input identity.

These utilities provide a direct document-to-index path. They do not disable the sibling
pipeline or delete shared legacy tables. Broad corpus retagging is a separate scoped run.

## Verification

`pnpm --dir apps/analysis test` covers source boundaries, missing/duplicate selection,
shared scope, web redirects and unread sources, independent failure, cancellation and
follow-ups. `pnpm --dir apps/analysis eval:research` replays against the test Worker.
See the dated implementation review for observed results and residual limitations.
