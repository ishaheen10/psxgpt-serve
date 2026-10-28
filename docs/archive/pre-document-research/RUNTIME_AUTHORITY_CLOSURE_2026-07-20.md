# Runtime Authority Closure — 2026-07-20

## Outcome

The residual shadow Router has been removed. Runtime now reads query text for semantic intent only in one closed-vocabulary recovery module after the Router returns no asks and no intent. A valid Router plan is authoritative unless it violates a typed structural contract.

## Closed Issues

1. The incident-specific empty-plan recognizer zoo was replaced by closed compute recovery plus one generic statements-and-filings fallback for resolved company/industry scope.
2. Model-build, ROIC, dividend-yield, and FCF-yield query recognizers were removed from their compute runners. The runners execute only an explicit plan intent; the sole recovery recognizer lives in `intent_recovery.ts`.
3. The Router now emits `resolution_context` containing company scope, unresolved entity mentions, and topic mentions. Runtime validates ticker identifiers and enriches canonical metadata without maintaining uppercase-word stoplists.
4. Market-wide, report-inventory, and valuation surface preferences no longer trigger a whole-plan corrective retry from query regexes. They remain Router instructions and eval requirements.
5. Report inventory and the low-leverage/positive-CFO screen dispatch through `deterministic_surface`, never ask prose.
6. The bank-deposit page supplement was removed. Deposit-schedule vocabulary now lives in the `financial_documents_new` fact pack and normal narrative retrieval owns selection.
7. Mixed-scope semantic plan fabrication was removed. Router-authored entity/topic metadata and the generic empty-plan fallback cover the boundary.

## Preserved Runtime Responsibilities

- Structural normalization and enum validation.
- SQL sandboxing and lane-table permissions.
- Submit vetoes with feedback to the same lane model.
- Evidence-backed selector propagation through `id` and `depends_on`.
- Canonical entity/industry enrichment and out-of-universe closure from typed Router metadata.
- Intervention traces with obstruction risk and before/after state.

## Test Evidence

- Final test Worker version: `6b750a36-de2b-4ae1-ad38-c5d96d7cc260`.
- Fixed-plan and recovery ablation: 8/8 passed in `eval/outputs/runtime_ablation/2026-07-20T09-29-32-286Z`.
- Live Router typed-output checks: report inventory, mixed-duration screen, and CNERGY/SPM entity/topic classification passed 3/3 in `eval/outputs/context_quality/2026-07-20T09-36-24-068Z`.
- Live unknown-ticker classification passed for BFARGO without BFAGRO substitution in `eval/outputs/context_quality/2026-07-20T09-37-54-365Z`.
- The FABL individual-deposit query passed after the candidate booster was removed, proving normal retrieval still supplied individual/total deposit evidence.
- The complete runtime-collision suite passed 25/25 on the final test Worker in `eval/outputs/context_quality/2026-07-20T10-23-43-367Z`.
- The live mixed-duration case also passed three consecutive focused runs before the final suite, covering the previously observed stray-intent sample.

Intermediate runs exposed three prompt/runtime-boundary issues before closure: empty plans entered contract retry before recovery; `PSX` inventory membership was mistaken for company scope in market-wide queries; and one mixed-duration sample carried a structurally impossible model-build intent. Empty plans now bypass contract retry, candidate ticker matches are classified by the Router, and the same-stage structural retry explicitly preserves valid typed asks while removing impossible model intent.

## Remaining Risk

Router and lane prompt quality remains probabilistic. Removing runtime incident recognizers intentionally makes prompt failures visible to evals instead of hiding them. Retrieval reranking is separate work; this closure removes a topic-specific booster but does not introduce a new general reranker.
