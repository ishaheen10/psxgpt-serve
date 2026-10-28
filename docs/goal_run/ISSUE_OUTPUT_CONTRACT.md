# Issue Output Contract

Serve reliability runs should produce traceable issue rows, not just aggregate
failure counts. The output should tell the next operator what failed, why it is
classified that way, and exactly how to replay it.

## Required Fields For Repairable Issues

Each issue row should include:

- `engine_id`
- `created_at`
- `user_email`, if available
- `query`
- `category`
- `surface`
- `table_or_lane`
- `ticker_or_entity`
- `status`
- `error_class`
- `detail`
- `why_this_category`
- `replay_command`
- `eval_case`, if one exists
- `production_impact`
- `fixed_by_commit`, once fixed
- `verified_by`

## Categories

Use one primary category:

- `serve_retrieval_or_reasoning_failure`
- `lane_sql_or_validation_failure`
- `router_or_ticker_grounding_failure`
- `coverage_disclosure_failure`
- `model_build_or_compute_failure`
- `pipeline_data_or_d1_quality_defect`
- `out_of_universe_or_user_scope`
- `transient_provider_or_runtime`
- `deployment_or_secret_mismatch`

## Good Issue Message Shape

Good:

```text
Run ed0e... treated GIDC as an unresolved ticker in an FFC net-cash query.
Category: router_or_ticker_grounding_failure. GIDC is a finance/regulatory
concept here, not a ticker request. Replay with /api/internal/eval-query-do and
add a regression that prevents ticker diagnostics from flagging GIDC in
gas-infrastructure-cess contexts.
```

Bad:

```text
Unresolved ticker.
```

## Before / After Requirement

Every fix report should include:

| Query or run | Before | After | Evidence |
| --- | --- | --- | --- |
| ed0e... | GIDC flagged as unresolved ticker | GIDC treated as concept in FFC context | replay run ID |

## Deployment Requirement

If a fix changes user-visible behavior, state exactly what was deployed:

- test Worker deployed or not
- production backend Worker deployed or not
- production Pages deployed or not
- D1 table pushed or not
- eval/replay command used after deploy
- `/api/admin/issues` window checked after deploy

