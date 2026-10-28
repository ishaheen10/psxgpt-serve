# psxGPT research

Research Pakistani companies from original reports, PSX announcements and economic documents. Dated PSX market snapshots remain available. The serving application reads the corpus published by the sibling `psxgpt-pipeline` repository; it does not create canonical financial facts.

The [product spec](apps/analysis/spec.md) keeps source context central. A small, source-linked aggregate index supports company selection; web search and page reading supplement the corpus.

> **Status: retired (October 2026).** psxGPT is no longer running. The code is published as-is under the MIT licence for anyone who wants to learn from it or run their own copy. Write-ups and learnings remain at [psxgpt.com](https://psxgpt.com). No support or maintenance is offered.

## Run it yourself

You need a Cloudflare account (Workers, D1, Durable Objects, Pages), a Supabase project for sign-in, and Gemini and DeepSeek API keys. The corpus is not included: build it with [psxgpt-pipeline](https://github.com/ishaheen10/psxgpt-pipeline), which publishes document pages and market data into D1.

1. `pnpm install`
2. Create a D1 database (`npx wrangler d1 create psx`) and put its ID in `apps/analysis/wrangler.toml` and `apps/market-sync/wrangler.toml` in place of `YOUR_D1_DATABASE_ID`. Set `SUPABASE_URL` there too.
3. Populate D1 with the pipeline's publish steps.
4. Copy `apps/analysis/.dev.vars.example` to `.dev.vars` and `apps/web/.env.example` to `.env.local`, then fill in your keys. For deployment, set the same secrets with `npx wrangler secret put <NAME>`.
5. Run the API with `pnpm --dir apps/analysis exec wrangler dev` and the web app with `pnpm --dir apps/web dev`.
6. Admin trace pages are restricted to a hard-coded email in `apps/analysis/src/index.ts` and `apps/web/components/AdminTracesApp.tsx`; change it to yours.

`pnpm --dir apps/web build:archive` builds the static docs-only site now served at psxgpt.com.

## Request flow

```text
Question + conversation + relevant saved evidence
  → small outline (one to three independent questions)
  → select companies by reported aggregates when needed
  → gather original pages, PSX snapshots and relevant web evidence for each question
  → model-written sections, streamed as ready
  → saved answer, source links and research events
```

There is no SQL-generating lane, normalized-statement retrieval, precomputed ratio path, financial model builder, or runtime financial answer rewrite. The separate aggregate index currently covers a bounded March 2026 bank slice. Source tables retain their original Markdown. The model handles requested arithmetic and must show inputs, units and basis.

## Where to work

- `apps/analysis/src/research/`: the research loop, source tools, prompts, provider calls and report types.
- `apps/analysis/src/index.ts`: authentication, chat transport, Durable Object persistence, sharing and trace APIs.
- `apps/analysis/src/admin/`: corpus diagnostics; these do not supply answer evidence.
- `apps/analysis/src/compat/types.ts`: historical trace/model/transport types. Not an execution engine.
- `apps/web/`: chat, company discovery, original source display and progress.
- `apps/analysis/scripts/`: focused tests and deployed research replays.
- `apps/analysis/spec.md`: product contract and simplification boundaries.
- `apps/analysis/runtime.md`: current runtime contract and limits.
- `SKILLS.md`: operating and deployment instructions.

The removed financial engine and its old eval scripts are recoverable from checkpoint commit `1587411`. Historical traces and saved models remain readable. Corpus tables have not been deleted.

## Verify and run

```sh
pnpm --dir apps/analysis typecheck
pnpm --dir apps/analysis test
pnpm --dir apps/web build
pnpm --dir apps/analysis eval:research
```

The deployed eval reads `.admin-token.local` without printing it and writes private evidence under ignored `eval/outputs/research/`. Use `EVAL_CASES=ubl_pay,kohc_units` for a focused run.

Backend deploys default to `psxgpt-serve-test`. Production promotion requires an explicit decision; the production Worker has the older name `psxgpt-api-sqlite`.
