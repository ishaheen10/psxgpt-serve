# D1 and Serve Quality Closure — 2026-07-18

## Decision

The served D1 corpus is suitable for production use with explicit quarantine and warning handling. This does not mean every source filing is clean. It means known blockers are structurally visible, excluded or disclosed at the correct boundary, and the serving runtime no longer silently replaces Router, lane, compute, or Analyst output to make evaluations pass.

## D1 State

- 478 tickers were inspected through the deployed 12-period data-quality matrix.
- 443 ticker rows are green, 31 are yellow, and 4 are red.
- The matrix contains 5,688 green cells, 11 yellow cells, and 37 red cells, backed by 47 open quality flags.
- The only red tickers are AGP, ILP, MMBLTFC, and WASL. These are explicit source/route quarantines, not silently served repaired values.
- Yellow rows are warnings such as stale market prices or source-PDF subtotal inconsistencies. The source-reported value is preserved and the limitation is disclosed rather than deterministically rewritten.
- The pipeline whole-corpus reconciliation matched 17,117 published ticker-period fingerprints plus 2 exact rows. Forty-one differences were gate-failed/quarantined, with no gate-passed unpublished candidate.
- Remote schema, ratios inventory, canonical statement slots, and model-build inputs passed the deployed context-drift check.

The upstream audit and exact blocker inventory are documented in `/Users/isfandiyarshaheen/psxgpt-pipeline/docs/D1_DATA_QUALITY_CLOSURE_2026-07-16.md`.

## Boundary Fixes Verified

- Closed deterministic computes own ROIC, dividend-yield, and FCF-yield arithmetic only when the Router emits the matching typed intent.
- Invalid compute ownership, selector graphs, valuation-input plans, report-inventory plans, cross-corpus narrative dependencies, and follow-up ticker leakage receive one Router-authored corrective retry. Runtime does not rewrite a valid model plan.
- Deterministic models and screens consume scoped D1 quality flags before arithmetic. Relevant blockers stop models or exclude screen observations with coverage disclosure.
- The Analyst selects its own tables and sources. Selection markers are emitted before answer prose to survive long-output truncation; a missing selection receives one same-model retry, and runtime never falls back to attaching all context.
- Dividend yield remains explicitly a cash-flow proxy, `abs(dividends_paid) / market_cap`, suitable for rough SCS alignment rather than declaration-accurate DPS truth.
- Market-wide compute QC uses the complete blocker set for exclusion but sends only selected-ticker flags to AnalystContext; the analyst warning block is capped at twelve rows.
- Failed lane and compute outputs now use the same failure predicates as checkpoints, and failed screens create explicit blocked compute artifacts instead of disappearing or crossing a passed boundary.
- Closed screens may feed their evidence-backed selected tickers into an explicitly requested narrative filing/announcement lane. Missing pages yield disclosed partial coverage rather than a runtime veto that discards valid pages.
- Whole-plan Router corrective retries are medium-risk interventions. A forced invalid-plan eval proves the retry removes the colliding structured lane while preserving the dependent narrative request.

## Deployed Evidence

Test Worker version: `49f3bfa8-4783-4444-a11c-09193cd33fc4`.

- Full regression: 35/35 pass — `eval/outputs/regression/2026-07-18T10-02-29-342Z`.
- Full reliability: 25/25 pass — `eval/outputs/reliability/2026-07-18T10-50-03-637Z`.
- Runtime-collision suite: 8/8 pass — `eval/outputs/context_quality/2026-07-18T10-13-14-345Z`.
- Runtime ablation: 8/8 pass — `eval/outputs/runtime_ablation/2026-07-18T10-02-29-361Z`.
- Model-build suite: 9 pass and 1 exact known-source XFAIL for ILP — `eval/outputs/model_build/2026-07-18T09-50-32-942Z`.
- Context drift: pass against the live test D1 corpus.

The 24-hour admin issue scan contained one historical `coverage_missing_tickers` warning. Direct trace inspection confirmed the answer explicitly disclosed that growth inputs covered only 4 of 10 requested companies, named the six missing tickers, and refused to fabricate broker or technical signals. This is the intended detection-and-disclosure path, not silent data loss.

## Boundary Follow-up — 2026-07-18

Test Worker version: `3667ecbe-c9a8-4c2a-8592-fca60576cbb9`.

- Runtime-collision suite: 10/10 pass — `eval/outputs/context_quality/2026-07-18T13-51-36-869Z`.
- Runtime ablation: 10/10 pass — `eval/outputs/runtime_ablation/2026-07-18T13-57-23-572Z`.
- Reliability matrix: 23/25 passed in the full run; the two failures were stale expectations (a filing-only query incorrectly required a structured table, and an insufficiency synonym list omitted two correct phrases). Both corrected cases passed on focused replay — `eval/outputs/reliability/2026-07-18T14-18-39-854Z`.
- Regression matrix: 34/35 passed in the full run; the remaining assertion treated any occurrence of `unavailable` as failure even when a seven-company screen correctly disclosed one quarantined ticker's missing market cap. The narrowed assertion passed on replay — `eval/outputs/regression/2026-07-18T14-30-28-319Z`.
- Model-build suite: 9 pass and the exact known-source ILP XFAIL — `eval/outputs/model_build/2026-07-18T14-31-06-090Z`.
- TypeScript, web production build, Worker dry-run, live context drift, and diff whitespace checks pass.
- The two eval-generated compute-dependent filing gaps now appear as low-severity `coverage_partial_disclosed`, with zero high-severity issue classes in the two-hour test-Worker scan. This preserves the work queue without misclassifying explicit partial evidence as silent ticker loss.

Production release:

- Git release commit: `576194c` (`Fix runtime boundary collisions`).
- Production Worker `psxgpt-api-sqlite`: version `2423610e-657f-497e-a8d0-f7edeaf56af3` at `https://psxgpt-api-sqlite.isfandiyar-shaheen.workers.dev`.
- Production Pages deployment: `https://7c142bde.psxgpt-serve.pages.dev`, promoted on the `main` branch and available through `https://psxgpt-serve.pages.dev`.
- Production health returned `{"status":"ok"}`; both Pages URLs returned HTTP 200.
- Production focused collision smoke: 2/2 pass for natural compute-to-filing handoff and forced medium-risk Router corrective retry — `eval/outputs/context_quality/2026-07-18T14-45-14-657Z`.
- Post-smoke admin scan: only low-severity `coverage_partial_disclosed` entries, with no high-severity examples.

## Residual Work

The four red ticker routes require source-specific upstream repair or a better source document. They should remain quarantined until the originating pipeline stage passes; removing their flags or manufacturing replacement values would reduce, not improve, data quality. Automation can now treat these as explicit work-queue items while continuing to publish and serve unaffected ticker-periods.
