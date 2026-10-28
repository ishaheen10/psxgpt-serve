# Simplified research stage — 7 September 2026

## What changed

The active request path is now a small outline followed by up to three independent source-research sections. Each section lists/searches original documents, reads the relevant Markdown pages and writes an answer with source links. Follow-ups can select saved evidence for reuse. The new implementation lives in `apps/analysis/src/research/` (about 950 lines including source tools, provider calls and types).

Removed the old router, table-specific lanes, intent recovery, analyst/extraction handoffs, financial model builders, precomputed ratio screens, 29 prompt packs and obsolete eval commands. The Ax and sandbox dependencies were unused by the replacement and were removed. Old design notes and gold cases are clearly separated as historical material. Checkpoint `1587411` preserves the earlier implementation.

PSX price, share-count, market-capitalization and 52-week-range fields remain available with dates. Original filing tables remain intact in source Markdown. No corpus tables were deleted or upstream ingestion changed. Historical model records and traces remain readable; model writes/calculations are disabled.

The chat shows the question outline, actual search/read activity, next steps, elapsed time and independently arriving sections. Completed text survives a section failure, an interrupted stream or cancellation. Saved revisions prevent old progress updates replacing newer ones. Company discovery and public docs are simplified; secondary routes are loaded separately from chat.

## Interventions removed or retained

| Former intervention | Classification / obstruction risk | Decision |
|---|---|---|
| Query-specific routing overrides and intent recovery | routing_override / high | Removed with the old router |
| Runtime answer corrections and financial extraction assembly | answer_rewrite / high | Removed |
| Model, ROIC, dividend and FCF computations | explicit_compute_product / high maintenance cost | Bypassed/removed as explicitly requested |
| Failed-lane source promotion/recovery | lane_failure_behavior / high | Removed; sections keep their own evidence and failure state |
| Source identity, SQL parameters, auth, budgets and cancellation | validation_guard / low | Retained |
| Historical trace/model reads and corpus diagnostics | operator_helper / low | Retained outside answer generation |

There is no phrase-specific financial fix for UBL, KOHC or another company. Explicit ticker metadata accompanies the original question; invalid tool arguments get bounded feedback. Search excerpts do not enter the writer's evidence.

## What verification establishes

Seven focused tests cover parameterized retrieval, market-data fields, same-filing neighbors, independent section failures, truncated streams, evidence reuse and cancellation. Backend typecheck, frontend build and Worker dry-run pass. Test-site HTML and assets, backend health, CORS and unauthenticated-request rejection were checked. Browser automation was unavailable, so visual/browser interaction verification remains outstanding.

Live replays exercise UBL remuneration and follow-up scope, KOHC units/market snapshots, unavailable ILP periods, three MARI sections, reciprocal TGL/BGL balances and macro retrieval. These checks establish execution, scope and source delivery, **not blanket factual correctness**. The final fast-mode run, `1788776872797`, passed all seven execution/scope/source checks: UBL 16s, follow-up 12s, KOHC 24s, ILP 18s, three MARI sections 28s, related parties 17s and macro 14s. These are seven targeted observations, not a production latency benchmark. Private raw outputs are under `eval/outputs/research/`.

## Lessons and limits

The first KOHC replay substituted KOHE and answered from search excerpts; authoritative symbol context and excluding snippets from answer evidence corrected that boundary. Macro retrieval needed full-text search and correctly shaped page IDs.

Stored UBL Markdown has damaged headings/column alignment and inconsistent totals. Both fast and reasoning-mode answers could still overstate a definitive CEO figure. This remains a source-fidelity limitation requiring original-PDF review and upstream transcription work; it is not marked fixed.

High-effort reasoning took roughly 142 seconds for an initial UBL answer and the follow-up hit the 150-second deadline. Low effort still produced long waits and an unfinished section. The final default returns to the faster non-thinking answer mode. Progress improves visibility; this is not evidence that every query is faster or that arithmetic accuracy is solved. The provider's mode contract was checked against [DeepSeek's documentation](https://api-docs.deepseek.com/guides/thinking_mode/).

This stage does not implement an in-place report editor, a full associative-trail memex, automatic source repair or a new ingestion/tagging system. Those are future product choices, not reasons to restore the removed financial machinery.

## Deployment

- Test UI: https://psxgpt-serve-test.pages.dev
- Test Worker: `f276f463-4dd4-4af8-aa47-ba33b33539bb`.
- Latest test Pages deployment: `e872d846`.
- No production Worker or production Pages promotion. Test and production share D1; test/eval logs and the additive `research_runs` table were written there.
