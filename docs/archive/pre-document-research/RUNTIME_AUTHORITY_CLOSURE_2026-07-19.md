# Runtime Authority Closure — 2026-07-19

> Superseded for current runtime behavior by `RUNTIME_AUTHORITY_CLOSURE_2026-07-20.md`, which removes the remaining shadow-router fallbacks and prose-keyed lane dispatches. This file remains the historical record of the first closure pass.

## Scope

This change closes two runtime-authority defects:

1. query-text ROIC detection could replace a valid narrative filing-discovery plan with a deterministic screen;
2. `guard_non_explicit_model_build_intent` could delete a valid Router-authored model plan when the user's wording did not match a runtime regex.

The governing boundary is now: normalize and structurally validate a non-empty Router plan, then preserve it. Query-text detection is allowed only to recover an empty plan.

## Implementation

- Removed `expectedComputeIntent()` as a correctness oracle over non-empty plans.
- Removed `guard_non_explicit_model_build_intent`.
- Made empty explicit model recovery emit `intent`, resolved ticker, inferred template, statement-model inputs, and market inputs directly.
- Added `finalPlan` to the in-memory Router trace so evals can compare the complete executed plan with `normalizedPlan`.
- Added fixed-plan collision cases for ambiguous ROIC narrative discovery and paraphrased model builds, plus empty ROIC/model recovery cases.
- Fixed the ablation runner so `router_plan_override` seeds both the prompt-only and default-runtime sides.

During broad testing, two additional owning-component issues were exposed and fixed without answer rewrites:

- Router instructions now distinguish forecast/outlook analysis from a requested model artifact and require a latest-market-cap selector for the phrase "top PSX companies."
- A ROIC answer that claims a full requested horizon despite fewer usable periods receives one same-Analyst corrective retry. The retry is traced as `retry_invalid_roic_coverage_claim`; runtime does not edit the answer.

## Test Worker Evidence

Intermediate prompt deployments ended at `ddf63eec-7c15-4cc3-a194-8b542782131f`. Final combined test Worker version: `081a16e1-9db3-4cb6-8f61-4afc90ec1567`. Cloudflare version IDs identify deployment order; the production commit is the durable source identity.

- Before deployment, all four new authority/recovery cases failed as expected: [pre-fix collision summary](/Users/isfandiyarshaheen/psxgpt-serve/eval/outputs/context_quality/2026-07-19T18-49-12-642Z/summary.md).
- After deployment, all four passed: [post-fix collision summary](/Users/isfandiyarshaheen/psxgpt-serve/eval/outputs/context_quality/2026-07-19T18-51-36-232Z/summary.md).
- Corrected fixed-plan ablation passed 5/5, including the deliberately invalid closed-compute plan: [ablation summary](/Users/isfandiyarshaheen/psxgpt-serve/eval/outputs/runtime_ablation/2026-07-19T19-26-08-113Z/summary.md).
- EFERT fair-value collision replay passed after replacing a brittle literal-word assertion with the requested `fair value` concept: [collision replay](/Users/isfandiyarshaheen/psxgpt-serve/eval/outputs/context_quality/2026-07-19T19-30-53-397Z/summary.md).
- Reliability canary produced 10 direct passes; the one Router decomposition failure was fixed and its focused replay passed, giving 11/11 covered cases: [canary summary](/Users/isfandiyarshaheen/psxgpt-serve/eval/outputs/reliability/2026-07-19T19-31-44-394Z/summary.md), [focused pass](/Users/isfandiyarshaheen/psxgpt-serve/eval/outputs/reliability/2026-07-19T19-39-02-242Z/summary.md).
- Full regression produced 33 direct passes. The depreciation lane non-submit passed on exact replay; the repeated ROIC label failure passed after the same-stage Analyst retry was added, covering all 35 cases across the full run and focused replays: [full regression](/Users/isfandiyarshaheen/psxgpt-serve/eval/outputs/regression/2026-07-19T19-40-02-474Z/index.html), [ROIC focused pass](/Users/isfandiyarshaheen/psxgpt-serve/eval/outputs/regression/2026-07-19T19-52-13-946Z/index.html).
- Model-build suite passed every expected case; ILP remains the documented expected failure: [model-build summary](/Users/isfandiyarshaheen/psxgpt-serve/eval/outputs/model_build/2026-07-19T19-53-01-473Z/index.html).
- TypeScript, web build, Worker dry run, context drift, and test Worker admin issue scan passed. The issue scan returned no issues in the final one-hour window.

## Remaining Risk

- Router and lane calls remain probabilistic. Fixed raw-plan cases now isolate runtime authority independently of Router sampling, while live cases continue to exercise prompt quality.
- A lane model can still occasionally retrieve candidates without submitting valid evidence; the exact depreciation replay passed, so no candidate-promotion fallback was added.
- Retrieval reranking remains separate work. This patch changes routing authority and answer-contract validation, not narrative candidate ranking.
