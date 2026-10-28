# PSXGPT: simplify around durable research

Review date: 7 September 2026. Recommendation: retain the evidence infrastructure, narrow the product promise, and make a saved research page the primary object. Stop investing in a general financial assistant until researchers can reliably continue work they have already done.

## Scope and evidence

Reviewed the serving architecture, request lifecycle, router/lane/analyst contracts, history and model persistence, frontend entry points, operating documentation, committed HEAD, and the uncommitted working tree. Queried live remote D1 `psx` read-only. Exported 901 eligible historical engine runs, 315 answer records since 13 July, 400 lane records since 10 August, and selected detailed router/analyst traces. Read the recent query stream and selected multi-turn answers; this is a targeted qualitative review, not a measured accuracy score for all answers or a full security audit.

Activity windows are UTC, start-inclusive/end-exclusive: 13 July–10 August and 10 August–7 September. The partial current day is excluded. Cohorts use normalized email with user ID fallback; exclude the two known owner emails, codex email prefixes, psxgpt.local addresses, and eval/codex/test user-ID prefixes. These are known-identity exclusions, not proof that every remaining account is organic. Both Workers share D1, and logs lack a deployment-environment field, so external-user activity is a proxy for production usage.

Local evidence is in `eval/outputs/review_2026-09-07/`; identifiers are pseudonymized in the activity export, but research text remains private evidence. No application code, deployment, or production data was changed. Existing uncommitted changes were preserved. Backend typecheck and frontend build passed; no deployed replay was run and no behavioral fix is claimed.

## Activity: deeper sessions, limited habit

| Metric | 13 Jul–9 Aug | 10 Aug–6 Sep |
|---|---:|---:|
| Queries | 134 | 198 |
| Users | 38 | 36 |
| Sessions | 65 | 81 |
| Done | 132 (98.5%) | 182 (91.9%) |
| Failed / cancelled | 2 / 0 | 11 / 5 |
| Median completed latency | 31.2 seconds | 30.1 seconds |
| p90 completed latency | 77.8 seconds | 67.4 seconds |
| Users active on multiple days | 6 | 7 |

Query volume rose 48%, but user count did not grow. Two people produced 68 of the latest 198 queries (34%). Twenty-six users asked multiple questions, but only seven came back on another calendar day. Among 17 first-observed users from 10–30 August with seven days of observation, three returned on a later day within seven days. This is first observed in engine history, not necessarily account creation.

The most recent complete week had eight failed runs out of 56. All eleven hard failures in the four-week window persisted the same generic unavailability message; D1 alone cannot establish whether these were provider, network, or other failures. Twenty-seven of the 182 done runs also had at least one explicit lane/model failure (28 failed lane records). A partial answer may still help, but `done` is not an answer-quality measure.

The ten identical bank-deposit comparison queries and five identical MARI snapshot queries match product-provided examples. Treat them as onboarding activity, not fifteen independent discoveries of demand. No feedback records matched the eligible engine messages. The event table contains query_received, query_started, and scout_steered, with no source-use or research-reuse events. No eligible user run in either window was marked steered. This weakens the case for investing in steering, but does not prove the feature has never been used.

## What is valuable

The best product signal is detailed investigation: TGL/BGL related parties and capex, Cherat Packaging's product mix, ILP capacity and financing, FATIMA/FFC economics, cement EV per ton, and E&P operating drivers. These questions are connected research sequences. Users ask for underlying evidence and then change the period, denominator, or assumption. That is the behavior a memex should support.

The repo already has valuable ingredients: source pages and links, narrative search, structured financial rows, scoped quality flags, calculation attachments, trace records, conversation search/folders, shared snapshots, and versioned saved financial models. Keep these assets. The useful response pattern is visible in Cherat Packaging's volume/margin comparison and EFERT's explicit P/E calculation. These are promising forms of evidence assembly; this review does not certify every source or financial conclusion in those answers.

## Confirmed problems, ordered by impact

### 1. The current-data promise exceeds the served corpus

Live D1 on 7 September: latest PSX announcement is 24 June 2026 across 8,847 records; latest market price is 4 September. ILP's latest filing and financial-statement period are 31 December 2025. HBL, UBL, and MEBL are at 31 March 2026 in both surfaces. These maxima establish served coverage, not when the pipeline failed or what was available on an earlier query date.

On 20 August, a user requested June bank results, then objected that at least ten banks had announced them. The system returned March results and unrelated board notices. On 16 August another user repeatedly requested ILP March financials. Improving answer prompts cannot supply absent filings.

Action: define a maintained universe and publish a per-company/source-class coverage manifest. Show prices as of X, statements through Y, announcements through Z before a latest-results answer. Refresh and verify the missing sources in the producing pipeline. Keep request-time retrieval from silently filling the gap with older periods.

### 2. Runtime shortcuts override correct research plans

UBL trace `949f19d9-210b-4c5e-b554-c45f228aa3b6` planned CEO remuneration for UBL in 2025, yet returned quarterly report links. Trace `eea5f8ef-1e09-4c72-97d3-619492cd2a5f` also retained UBL in both raw and final router plans, but its final answer linked PSX's quarterly pages after the user said the annual report was “on the psx.” Earlier trace `df4901be-4002-45e9-9896-a3ee281ad007` planned 2025 remuneration and returned a generic UBL overview.

This is stronger evidence than a bad-router hypothesis: the stored plan was relevant and downstream execution answered another question. Committed HEAD's overview shortcut uses `bareResolvedCompanyTicker`; its report shortcut uses text matching and `mentionedReportTickers`, then fetches latest pages without the requested period. The uncommitted working tree already moves these to typed `company_overview`/`report_source` intents and passes period parameters. That direction is appropriate, but the deployed UBL sequence must pass before calling it fixed.

Action: remove text-triggered semantic shortcuts. Retain direct lookup endpoints for explicit UI actions, and one plan authority for research. Do not add another prompt rule to compensate for runtime substitution.

### 3. The numerical evidence contract permits loss of meaning

KOHC trace `a186d532-efc1-4e64-a09b-968025531718` submitted a mixed-unit table with ticker, period, duration, canonical name, and value, but no unit. Its SQL combined market cap in rupees with statement numbers in thousands. The persisted table contained cash 749,202.214, debt 3,323,206.917, investments 34,076,006.535, and market cap 85,495,503,105. Live D1 confirms the first three have `unit_type='thousands'`.

The answer described investments as PKR 34.1 million instead of PKR 34.1 billion and produced EV around PKR 85.5 billion. After the user's correction, the answer revised EV to PKR 57.9 billion, also adding previously omitted short-term borrowing. Therefore the EV change is not solely a scaling effect. The underlying unit failure is independently established.

Action: every numerical evidence record must carry value, currency/scale, period/duration, reporting basis, metric identity, and source. Reject incomplete numeric payloads at the boundary. Compute EV and conversions from typed inputs. Keep raw source units visible. Do not rely on an analyst instruction to reconstruct metadata discarded by SQL.

### 4. Research state is weaker than model state

The DO stores messages, folders, saved models, and model versions. `getChatHistory` returns only ten role/content messages; router history is the last six, each truncated to 150 characters; analyst history is the last eight. Earlier source artifacts do not travel through this role/content history. There are actual D1 memories (291 inferred and 14 manual), but the context loader treats them as lightweight personalization hints, not saved research evidence.

In the ILP sequence, the router lost company scope even though the analyst recognized that ILP was the topic. In the KOHC sequence, “tell me in USD” triggered fresh retrieval and an answer saying borrowings from the previous turn were unavailable in the current evidence. On 6 September, a multi-company revenue-note follow-up narrowed to MWMP and disclosed that the other companies were not retrieved.

Action: persist an explicit research scope and cited workpaper. Keep selected entities, periods, source IDs, numerical inputs, assumptions, and unresolved questions outside prose chat history. A follow-up should amend this state and retrieve only the missing evidence. Increasing the message limit alone will not solve artifact loss.

### 5. Automatic modeling creates work the user did not request

There were 32 model_build lane records in the latest window. These are executions, not 32 explicit model requests. They appear for a CEO-background question, a Q1 equity lookup, a historical performance review, simple EV edits, and users asking for simpler explanations. FATIMA's historical-trend answer included a five-year forecast and warned that its own model produced implausible negative earnings after 2026.

Action: remove automatic full-model construction from ordinary research. Offer an explicit calculation or scenario action on selected evidence. Preserve existing model snapshots and deterministic code behind that action. Do not delete useful arithmetic or replace it with unconstrained model-generated numbers.

### 6. The interface and instrumentation center the machinery

Primary navigation includes Equities, Traces, and Docs; welcome links include a test query, database checks, and the changelog. The input says “redirect Scout.” Source viewing is implemented, but the primary durable item is a conversation rather than a user-authored research argument.

The backend entry point is roughly 4,900 lines and mixes HTTP/admin routes, schema initialization, logging, sharing, and DO persistence. Runtime/orchestration also contain separate answer-return paths with substantial repeated result/trace construction. The frontend eagerly imports admin/docs/equities surfaces; the build emits a 1.03 MB minified JS bundle (293 KB gzip). These are maintenance and delivery costs, not the primary reason people fail to return.

The failure catch sanitizes errors before persistence and trace writes are best-effort with swallowed failures. Preserve a safe user message separately from structured operator error/stage/provider fields. Add deployment version/environment to logs. Current analytics cannot reliably distinguish useful completion, partial coverage, and successful research reuse.

## What to strip, preserve, and replace

| Decision | Scope |
|---|---|
| Remove from default research | Automatic full financial models, heuristic answer shortcuts, repeated full retrieval for conversion/assumption follow-ups |
| Remove from primary navigation | Admin traces, engineering docs, database internals, changelog, “Scout” vocabulary; retain them in secondary/operator surfaces |
| Stop expanding | Trading signals, price targets, unsupported universes, additional template families, and new retrieval lanes without repeated evidence of need |
| Keep | Original documents, page identity, search, structured source-backed rows, numerical validation, quality flags, traces/evals, sharing/export |
| Reuse | SourcePanel as evidence reader; folders as initial project containers; DO persistence for research pages; model versions for explicit scenarios |
| Retire gradually | Overlapping vision/next-phase documents and duplicated answer assembly; replace with one current product contract and a single evidence-to-answer path |

Fallback disposition: text-based overview/report overrides are routing overrides with high obstruction risk and trace-backed removal justification. Typed explicit overview/report actions are low-risk lookup products. Unit/basis/entity validation guards remain. Failed-lane promotion into evidence remains forbidden. Model computation is an explicit compute product worth retaining when requested; automatic activation should be narrowed. Changes need before/after replays of the cited cases, not blanket deletion of safeguards.

## The smallest memex worth building

Bush's essential feature was connecting material into persistent, revisitable and shareable trails, including the researcher's own annotations. A larger answer generator does not supply that continuity. See his original essay, sections 6–8: https://www.w3.org/History/1945/vbush/vbush7.shtml

Make one saved research page the center. A page can be a question or thesis, not only a ticker: “Does ILP's new capacity justify its valuation?” or “Cement value per ton on a consistent clinker basis.” It contains a short editable conclusion, pinned source excerpts/tables, user notes, calculations with explicit assumptions, and unresolved questions. Each claim links to its evidence; each related question links to another page or section. No graph database or graph visualization is required.

The interaction is: find evidence → inspect source → pin to research page → ask a follow-up using that evidence → save the revised argument → reopen or share. Chat remains an input mechanism. Facts, user assumptions, and analyst interpretations remain distinguishable. New evidence should create a proposed revision with citations rather than silently rewriting the user's thesis.

Start with three actions: Find evidence, Explain/compare, Calculate from selected inputs. Underneath, use bounded tools for page search/fetch, statement history, market snapshot, and calculations. Parameterized SQL should cover frequent numeric operations; keep a constrained exploratory search path for uncommon narrative questions. This is narrower orchestration, not loss of corpus breadth.

## Recommended order and decision gates

1. **Repair the promise.** Verify and refresh the small maintained corpus; expose source-specific freshness. Retire the UBL shortcut behavior. Enforce units/basis on all numeric evidence. Persist useful internal errors. Replay UBL remuneration, KOHC unit/FX/clinker edits, ILP period requests, and multi-company revenue-note scope through test deployment.
2. **Ship one durable research page.** Reuse the existing source reader and persistence. Pin source evidence, edit a short note, preserve scope and arithmetic, reopen across sessions, and export/share. Do not rebuild ingestion, add a graph service, or expand modeling at the same time.
3. **Evaluate research sequences.** Take a bounded set of roughly twenty real multi-turn tasks. Check explicit scope, period fidelity, unit correctness, source relevance, carried-forward evidence, and whether a follow-up unnecessarily re-fetches everything. Maintain hard-failure and partial-answer metrics separately.
4. **Test with five repeat researchers.** Suggested four-week gate: at least three independently reopen and extend saved work on multiple days; zero unresolved unit/entity errors in the audited sample; two express willingness to pay at a stated pilot price. These are proposed decision rules, not statistical validation. If users still only want disposable answers, reconsider the memex hypothesis before adding monitors or more model families.

A cited “what changed?” update becomes useful once pages are reused and the source refresh is dependable. It should follow those two foundations, not lead the next build.
