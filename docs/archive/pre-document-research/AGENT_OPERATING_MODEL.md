# Agent Operating Model

This repo should use AI-assisted work as a controlled engineering loop, not as one-pass code generation. The core pattern is:

1. Define the component contract.
2. Reproduce or inspect the smallest real failure surface.
3. Make the smallest fix that changes the earliest broken artifact.
4. Run an independent adversarial review.
5. Verify with the relevant deployed replay, eval, browser smoke, or artifact audit.
6. Record public behavior changes through `changes/*.json` and regenerate the changelog.

Do not claim a user-facing fix is done until the relevant deployed path has been exercised.

## Roles

Use separate contexts for implementation and review when a change touches routing, lane behavior, analyst grounding, source recovery, frontend progress, or deployment wiring.

- Implementer: changes code or prompts. The implementer should explain the intended contract and the exact verification command.
- Adversarial reviewer: receives the diff and relevant component contract only. The reviewer assumes the change is wrong and looks for hidden regressions, unsupported claims, fallback masking, deploy-target mistakes, and missing tests.
- Fixer: applies accepted review findings. The fixer should not broaden the change unless the review exposes the real boundary as wider than expected.

For narrow documentation-only edits, a single pass is acceptable. For runtime or answer behavior, use at least one adversarial review. For large or cross-component behavior, use two.

## Hard Rules

- Start from evidence: trace row, eval output, replay, admin issue, deployed bundle behavior, or explicit code path.
- Do not add answer rewrites to make evals pass.
- Do not add deterministic fallbacks without a fallback inventory: category, obstruction risk, before/after behavior, and verification.
- Do not let failed or empty lane evidence become authoritative context.
- Do not let docs, UI copy, or trace labels claim more than the actual payload contains.
- Do not hand-edit generated changelog files.
- Do not treat local success as production proof.
- Do not deploy production by implication. Production backend is `psxgpt-api-sqlite`; the default analysis deploy targets the test Worker in `apps/analysis/wrangler.toml`.

## Standard Workflow

### 1. Classify the Work

Pick one primary class before editing:

- `router_contract`: planner, ticker grounding, intent, table selection, runtime interventions.
- `lane_contract`: SQL/tool loop, narrative shaping, coverage, selected ticker handoff, provenance.
- `analyst_contract`: final prompt, computed tables, source tags, unsupported claims.
- `frontend_contract`: progress/status rendering, trace viewer, API base, shared conversation view.
- `source_contract`: structured source recovery, narrative page evidence, source panel previews.
- `model_build_contract`: deterministic model creation/update/load, saved model state, assumptions.
- `deployment_contract`: Worker/Page target, secrets, D1 binding, production/test mismatch.
- `eval_contract`: missing or weak regression coverage.

If two classes seem plausible, inspect the boundary before editing. For example, a stuck UI may be a frontend metadata issue or a backend generation path that died before emitting progress.

### 2. Build the Work Queue

Use the smallest queue that captures the problem:

- Exact trace or user query replay for a single failure.
- `/api/admin/issues?hours=24&limit=500` for fleet-level failure clusters.
- `eval:regression` for broad answer behavior.
- `eval:model-build` for saved model and deterministic model behavior.
- `eval:context-quality` for source/table/payload retention.
- `eval:runtime-collisions:ablation` when runtime interventions may be helping or harming prompt-pack behavior. It must replay one captured Router plan and fail on unallowlisted changed high-risk interventions.
- Browser smoke for frontend, trace viewer, and shared-link behavior.

Group failures by root cause before fixing them. Do not chase symptoms one by one if they share the same contract break.

### 3. Trial Run Before Broad Change

Before broad router, prompt, lane, or analyst changes, run a three-case trial:

- One bare ticker or company snapshot case.
- One structured numeric/model-build case.
- One narrative/source-heavy case.

If a change is specifically about frontend progress, use:

- One generation that emits multiple checkpoints.
- One polling recovery path through `/api/messages/:messageId`.
- One browser smoke on the deployed frontend target.

### 4. Implement

Keep the change scoped to the component that owns the broken contract.

- Router fixes belong in router prompt packs or router runtime normalization/guards.
- Lane fixes belong in lane prompts, SQL/tool contracts, or lane runtime validation.
- Analyst fixes belong in analyst prompt assembly or supplied context shape.
- Source fixes belong in recovery/provenance code and source panel contract.
- Frontend progress fixes belong in stream/poll metadata handling and shared trace rendering.

When possible, fix the earliest broken artifact rather than adding downstream cleanup.

### 5. Adversarial Review Checklist

Ask the reviewer to answer these concretely:

- What behavior can this break that the implementer did not mention?
- Does the diff change the real owner of the contract, or patch a downstream symptom?
- Could this create unsupported final-answer claims?
- Could this mask a failed lane, empty source set, unresolved ticker, or unsupported model?
- Could this route announcements, filings, ratios, or market data through the wrong table?
- Could a follow-up query behave differently from a fresh query?
- Could the frontend point to the wrong backend or mishandle status-only metadata updates?
- Does the verification actually exercise the changed deployed path?

Rejected patterns:

- Stubbed behavior.
- Broad fallback without trace evidence.
- Long explanatory comments that justify a workaround instead of fixing the contract.
- Tests that only prove shape, not behavior.
- Local-only validation for deployed behavior.

### 6. Verify

Use the smallest sufficient verification, then broaden when the blast radius requires it.

Common commands:

```bash
pnpm --dir apps/analysis typecheck
pnpm --dir apps/web build
pnpm --dir apps/analysis exec wrangler deploy --dry-run --outdir /tmp/psxgpt-serve-worker-dry-run
```

Focused deployed replay:

```bash
ADMIN_TOKEN="$(cat .admin-token.local)" curl -fsS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://psxgpt-serve-test.isfandiyar-shaheen.workers.dev/api/internal/eval-query-do" \
  --data '{"query":"Tell me about BFARGO.","user_id":"debug-user","user_email":"isfandiyar.shaheen@gmail.com","session_id":"post-fix-debug"}'
```

Broad evals:

```bash
ADMIN_TOKEN="$(cat .admin-token.local)" pnpm --dir apps/analysis eval:regression
ADMIN_TOKEN="$(cat .admin-token.local)" pnpm --dir apps/analysis eval:model-build
ADMIN_TOKEN="$(cat .admin-token.local)" pnpm --dir apps/analysis eval:context-quality
ADMIN_TOKEN="$(cat .admin-token.local)" pnpm --dir apps/analysis eval:runtime-collisions:ablation
```

Use focused case filters when the change is narrow. Run full suites when the change touches routing, shared lane validation, analyst grounding, source recovery, or deterministic model computation.

### 7. Ship Hygiene

For public behavior changes:

1. Add one JSON record under `changes/`.
2. Run `node scripts/sync-changelog.mjs`.
3. Include the eval or replay output path in the handoff.
4. State exactly which target was deployed or verified: local, test Worker, production Worker, test Pages, or production Pages.

## Component Contracts

Detailed component descriptions live in `docs/component_contracts/`:

- `router.md`
- `lanes.md`
- `orchestrator.md`
- `analyst.md`
- `source_recovery.md`
- `frontend_progress.md`
- `model_build.md`
- `evals_and_deploy.md`
