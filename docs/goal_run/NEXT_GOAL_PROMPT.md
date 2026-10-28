# Next Goal Prompt Template

Use this when starting a long-running reliability goal. Fill in the concrete
window, known invariants, and target category before handing it to Codex.

```md
Goal: reduce live psxGPT production failures without bandaids.

Time window:
- Inspect production traces from the last <N> hours.
- Prioritize issues that affected real users or production health.

Repositories:
- `psxgpt-serve` owns runtime query behavior, traces, evals, frontend, and deploys.
- `psxgpt-pipeline` owns corpus generation, extraction, ratios, QC artifacts, and D1 uploads.

Hard invariants:
- P/E = latest market_cap / latest annual_or_LTM net_profit.
- Never use EPS or historical shares for P/E.
- SCS is a reference check only, not a source of truth.
- AGP is a known source-quality caveat unless new evidence says otherwise.
- Do not change production without recording what table/app was updated.
- Do not call a fix done without deployed evidence.

Required live run artifact:
- Copy `docs/goal_run/RUN_STATE_TEMPLATE.md` to a dated run file.
- Keep it updated after every issue classification, production change, and verification.

Loop:
1. Inspect current production traces, health artifacts, and dirty git state.
2. Group issues by root-cause category before editing code.
3. Pick the highest-impact category.
4. Prove the failure with current evidence.
5. Patch the earliest root cause.
6. Rebuild deterministic artifacts or app bundles.
7. Push only required D1/app updates.
8. Run production or test-worker checks that directly cover the fix.
9. Update specs, skills, and changelog when user-visible behavior changed.
10. Commit and push.
11. Update the run-state file with before/after evidence and remaining issues.

Before coding, classify each issue as one of:
- our extraction/math wrong,
- source report wrong,
- stale/missing market data,
- SCS basis mismatch,
- D1 publish/artifact sync failure,
- serve retrieval/reasoning failure,
- out-of-universe/user-scope issue,
- transient provider/runtime issue.

Do not:
- Treat all yellow/red flags as equal.
- Use broad thresholds as proof of data failure.
- Let SCS choose production financial values.
- Stop after local tests if production was affected.
- Mark the goal complete just because one category improved.
```

