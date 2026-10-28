# psxGPT operating guide

Read the target contract in `apps/analysis/spec.md` and the implemented contract in `apps/analysis/runtime.md`. The user-directed simplification supersedes earlier instructions to add deterministic financial products or repair the legacy router. That implementation is preserved in git checkpoint `1587411`.

- Start from a failing trace, source page, eval or reproducible query. Distinguish serving/reasoning bugs from missing or corrupted corpus data and transient provider failures.
- Keep the active path small: query, optional bounded aggregate selection, source research, model-written sections. The revised spec permits a small source-linked index for filtering; it does not authorize restoring full normalized statements, precomputed ratios, SQL-writing lanes, financial models or query-specific answer rewrites.
- Preserve original page text, source links, units, periods and basis. Tags are hints. Search snippets are not answer authority. Do not normalize corrupt source tables into invented certainty.
- Keep low-risk input, authentication, source identity, budget and cancellation checks. Before introducing a deterministic intervention, document its purpose, obstruction risk and evidence. Valid model plans and answers must not be semantically rewritten by runtime rules.
- Progress must reflect actual work, never private reasoning or fabricated percentages. Completed sections should survive another section failing or the user stopping a request.
- Use distinct eval user IDs for independent cases; reuse an ID/session only to test follow-ups. Credentials come from `.admin-token.local`, `ADMIN_TOKEN` or `EVAL_TOKEN`. Never print or commit them.
- Do not call an issue fixed until a focused replay passes on the test Worker. Automated transport/scope checks do not prove factual correctness; inspect source fidelity separately.
- Keep a dated run note under ignored `eval/outputs/` for broad work, including failures, commands, deployment IDs and next actions. Put durable architectural decisions in the repo docs.
- Public changes need a JSON entry under `changes/`, followed by `node scripts/sync-changelog.mjs`.

## Checks and deployment

```sh
pnpm --dir apps/analysis typecheck
pnpm --dir apps/analysis test
pnpm --dir apps/web build
pnpm --dir apps/analysis exec wrangler deploy --dry-run --outdir /tmp/psxgpt-worker-check
pnpm --dir apps/analysis exec wrangler whoami
pnpm --dir apps/analysis deploy:test
pnpm --dir apps/analysis eval:research
```

The default Worker is `psxgpt-serve-test`, not production. Test frontend project: `psxgpt-serve-test`. Build it with `VITE_API_URL=https://psxgpt-serve-test.isfandiyar-shaheen.workers.dev` before publishing its `dist` directory.

Deploy only test unless the user explicitly asks for production promotion. Production is a manual two-part deploy: Worker `psxgpt-api-sqlite` and Pages project `psxgpt-serve`. A git push is not proof of deployment. Test and production share D1 `psx`; do not delete corpus tables as part of serving cleanup.

Historical traces remain in `engine`, `router`, `lane`, `analyst`, `sources`; new evidence is in `research_runs`. `/api/admin/traces/:engineId` enforces owner/admin access and returns the appropriate research or historical trace. `/api/internal/eval-query-do` accepts the local admin/eval token.
