# Document research simplification — paused 7 September 2026

Resumed later the same day. See [the completed simplified-stage report](2026-09-07-simplified-research.md) for current code, validation and deployment state. The checkpoint below is historical.

## Direction

Replace table-specific routing, normalized financial statements, precomputed ratios and financial modeling with good source context and model-written research sections. Keep dated PSX market data. Show actual searches, reading and section progress. Earlier findings and harness research are in the two adjacent review documents.

## What worked

- Added `apps/analysis/src/research/`: a small outline, up to three concurrent sections, fixed parameterized source tools, original Markdown pages and dated PSX snapshots. No financial-statement or ratio tool is exposed.
- Switched chat and eval requests to this path. Removed legacy execution imports and retired old stage-debug endpoints; saved models are read-only. Old implementation files still exist and need cleanup.
- Added persisted report/evidence snapshots for follow-ups, streamed section progress, partial-output preservation and protection against older progress revisions. Secondary web routes load on demand.
- Backend typecheck and four focused tests passed. Tests cover SQL boundaries, market-data fields, same-filing neighbor reads and independent section failure/progress. An earlier frontend build passed; the latest UI edits still need rebuilding and browser verification.
- First deployed UBL replay retained company/period on a follow-up and reused source evidence. Initial answer took 19 seconds; follow-up took 13 seconds. These are individual observations, not a latency benchmark.

## What did not work / remains unproven

- KOHC replay incorrectly researched KOHE and answered from search excerpts without reading pages. Added authoritative company context and removed search excerpts from the writer's evidence; finishing with unread search candidates now requests page reads. **These fixes have not been replayed.**
- UBL Markdown contains corrupted headings and inconsistent totals. Answers still sounded too definitive. Added instructions to disclose transcription ambiguity; this is not a repair of the source data and remains unverified. The eval's structural passes do not establish numerical correctness.
- Broad three-section, announcement, macro, missing-period and related-party cases have not run. Browser progress, cancellation/reload and concurrent follow-ups need end-to-end checks. Failure accounting and research-trace presentation also need review.
- Repository cleanup, canonical docs, public changelog and a final implementation commit remain unfinished. The researcher currently uses Gemini for planning/retrieval and DeepSeek for writing; it is not a single-model loop.

## Exact checkpoint

- Branch: `codex/document-research`.
- Commit `1587411` preserves pre-existing contract work and the review documents. New implementation changes remain **uncommitted**.
- Latest test Worker deployment completed: `754f0206-c9ce-4f5b-91b2-999fbd791d0f` at `https://psxgpt-serve-test.isfandiyar-shaheen.workers.dev`.
- No production Worker or frontend deployment. Test and production share D1; evals added logs and the additive `research_runs` table, without changing corpus rows.
- Replay evidence: `eval/outputs/research/1788774952194/` (ignored/private). One failed case; UBL structural checks passed with the quality caveats above. No eval or deployment remains running from this effort.

## Resume

1. Inspect the working diff; preserve this checkpoint.
2. Run `pnpm --dir apps/analysis typecheck` and `pnpm --dir apps/analysis exec node scripts/test-research.mjs`.
3. Replay `EVAL_CASES=ubl_pay,kohc_units pnpm --dir apps/analysis exec node scripts/run-research-eval.mjs`; the script reads the local token without printing it. Audit answers against source text, not just automated checks.
4. Run the remaining cases, verify the frontend/progress flow, then finish cleanup/docs/changelog and commit. Keep deployment on test unless production is explicitly requested.
