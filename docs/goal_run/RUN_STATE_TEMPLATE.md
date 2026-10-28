# Goal Run State

Use this file at the start of a long-running serve or cross-repo goal. Copy it
to `eval/outputs/goal_run_<YYYY-MM-DD>.md` or another run-specific evidence
path and keep it current. Do not rely on chat history as the only state store.

## Objective

- User objective:
- Current narrowed loop:
- Start time:
- Operator:

## Non-Negotiables

- Start from production traces, evals, admin issues, or reproducible queries.
- Do not make band-aid fixes.
- `psxgpt-serve` is the Pages project.
- Production backend Worker is `psxgpt-api-sqlite`.
- Test backend Worker is `psxgpt-serve-test`.
- Load `ADMIN_TOKEN` from `.admin-token.local`; never print it.
- A production claim requires an explicit Worker deploy, Pages deploy, D1 push,
  or proof that no production deploy was needed.
- For data defects, fix `psxgpt-pipeline` first and verify serve after D1 refresh.

## Current Hypothesis

- Suspected root cause:
- Serve surface implicated:
- Pipeline surface implicated, if any:
- Evidence that supports it:
- Evidence that would disprove it:

## Current Issue Classification

Choose exactly one primary category before editing code:

- `serve_retrieval_or_reasoning_failure`
- `lane_sql_or_validation_failure`
- `router_or_ticker_grounding_failure`
- `coverage_disclosure_failure`
- `model_build_or_compute_failure`
- `pipeline_data_or_d1_quality_defect`
- `out_of_universe_or_user_scope`
- `transient_provider_or_runtime`
- `deployment_or_secret_mismatch`

Primary category:

Why this category:

Why the other likely categories were rejected:

## Trace Ledger

| Time | Query/Run ID | User | Surface | Finding | Decision |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## Before / After

| Behavior | Before | After | Evidence |
| --- | --- | --- | --- |
|  |  |  |  |

## Commands Run

```bash
# Paste exact commands here.
```

## Deploy / Production Changes

| Time | Target | Command | Version/URL | Verification |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Current Health Snapshot

- Production admin issues:
- Test Worker evals:
- Production matrix, if data-related:
- Pages deployment:
- Backend Worker deployment:

## Open Items

| Item | Category | Owner | Next command/evidence | Blocking? |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Next Three Actions

1.
2.
3.

## Handoff

- What is fixed:
- What is not fixed:
- Residual risk:
- Resume command:

