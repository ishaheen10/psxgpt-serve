# Simplify PSXGPT into research sections over source documents

Investigated 7 September 2026. This is a design recommendation based on current primary harness documentation, the local serving code, the earlier live-query audit in this task, and additional read-only D1 coverage checks. It is not a benchmark result or an implemented replacement.

## Recommendation

Replace table-specific routing, SQL-writing lanes, full financial models, and mandatory extraction/analyst handoffs with one reusable researcher that answers a bounded question from source documents. For broad questions, make a short section plan and run a few instances of that same researcher independently. Publish each completed section with its own evidence. Add a concluding comparison only when the question calls for one.

The important change is the unit of work: a meaningful research question, not a database table or a financial model template. A section owns finding and explaining its evidence. Splitting only the final writing step while retaining the existing orchestration would preserve most of today's complexity.

## What recent harnesses actually suggest

| Harness or source | Relevant observation | Recommendation for this repo |
|---|---|---|
| Pi, current repository; original design essay November 2025 | A small core toolset and extensible session runtime; subagents and planning are not built into its default product. | Borrow the small-tool philosophy. Do not deploy a terminal coding harness merely to read D1 pages. [Current README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md) |
| Anthropic Managed Agents, April 2026 | Separates durable session events, model loop, and execution infrastructure; explicitly describes model-specific harness workarounds becoming obsolete. | Persist evidence and section state independently of model calls. Remove obsolete compensation logic rather than layering over it. [Engineering article](https://www.anthropic.com/engineering/managed-agents) |
| Anthropic research architecture, June 2025 | Independent research workers isolate context and parallelize breadth; dependent work and shared context complicate coordination and increase token consumption. | Split independent investigations; keep dependent calculations and comparisons downstream. Its internal performance results are not a PSXGPT forecast. [Research system](https://www.anthropic.com/engineering/multi-agent-research-system) |
| Claude Agent SDK, current docs | Subagents provide fresh contexts, bounded tools, and parallel execution. | Useful if adopting its runtime later; not required for a few API workers in the current application. [SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents) |
| OpenAI Agents SDK, current docs | Distinguishes specialist handoffs from agents used as bounded tools; recommends adding specialists when they materially improve the task boundary. | The application owns the report. Section workers return results; they do not hand the user between personas. [Orchestration](https://developers.openai.com/api/docs/guides/agents/orchestration) |
| Vercel AI SDK, current workflow docs | Supports ordinary sequential and parallel functions alongside orchestrator-worker workflows. | Closest implementation style for this TypeScript/React product if an SDK change is warranted. First reuse existing API helpers; avoid a framework migration as a prerequisite. [Workflow patterns](https://ai-sdk.dev/docs/agents/workflows) |
| LangChain Deep Agents, current JS docs | Bundles context offloading, filesystem abstractions, and subagent isolation; task planning is now opt-in from v0.7. | Useful for longer autonomous work, but importing its full abstraction stack is not the immediate simplification. [Overview](https://docs.langchain.com/oss/javascript/deepagents/overview) |

Anthropic's March 2026 application-development harness also uses evaluator feedback and removes a context-reset workaround after a model change. That is evidence for reevaluating machinery, not for copying a multi-hour coding review loop into every research answer. [Harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)

My selection: a small application-owned workflow with a reusable section researcher, using existing model calls initially. If provider streaming/tool-loop maintenance becomes a material burden, trial AI SDK core. OpenAI's own guidance also distinguishes directly owning a response loop from having an SDK own it. [API versus SDK](https://developers.openai.com/api/docs/guides/agents)

## A concrete query flow

User: “Why have OGDC, MARI, and PPL gas production trends diverged, and what can continue?”

1. A short model call produces a plan with three company investigations and a dependent comparison. All receive the original question and the same requested historical window, gas-volume definition, ownership basis where relevant, and annual-versus-quarterly comparison convention.
2. Three researcher calls work independently: OGDC, MARI, PPL. Each can list documents, search pages, and read pages. Each writes its own section, including a source-linked volume history, reported explanations, uncertainty, and implications.
3. Completed sections populate their stable positions immediately. One slow or failed company does not suppress the others.
4. A final call answers the comparative question using those sections and their cited source excerpts. It may read the cited pages. It identifies inconsistent bases instead of presenting incompatible values as comparable. It does not rewrite all three sections.

For ILP, independent sections could cover operating demand/capacity, capex/financing, and profitability/cash conversion. A conclusion about valuation waits for those findings. For “UBL CEO remuneration in 2025,” use one researcher and one section. For “convert that to USD,” update the existing relevant section using its evidence and the requested exchange-rate basis.

The planner does not choose database tables, canonical financial fields, SQL, model templates, or calculation formulas. Its output is small:

```json
{
  "scope": "OGDC, MARI, PPL; requested historical window; comparable gas-volume basis",
  "sections": [
    {"id": "ogdc", "question": "What changed in OGDC gas production and why?"},
    {"id": "mari", "question": "What changed in MARI gas production and why?"},
    {"id": "ppl", "question": "What changed in PPL gas production and why?"}
  ],
  "conclusion_question": "Which drivers explain the divergence and are likely to persist?"
}
```

These are question-specific tasks using one common researcher prompt, not permanent banks/cement/macroeconomics personas. Start with at most three concurrent researchers, no recursive spawning, a bounded search/read budget, and at most one targeted evidence-repair pass. These are experimental defaults, not measured optimal settings. A tool-using researcher can require several provider requests; three sections does not mean precisely three API calls. Measure time to first useful section, total latency, and tokens separately.

## Keep document structure; remove the financial ontology from the critical path

I recommend testing a document-only answering path with zero reads from `financial_statements`, `ratios`, `management_comp`, and model/screen views. Retain the existing datasets during the comparison; deleting them is not required to remove their runtime dependencies.

Additional live D1 checks found:

- 256,607 filing-page rows covering 478 tickers.
- 925,074 structured financial-statement rows covering 478 tickers.
- Zero statement tickers lacking any filing-page row.
- No empty `text` fields by a null/whitespace check. This does not establish parse fidelity.
- 206,144 page rows (80.3%) have empty section tags under the checked representations.
- 18,905 rows have empty search summaries.
- `filings_fts_new` indexes both `search_text` and full `text`; announcement FTS indexes ticker, title, summary, and text.

Evidence: `eval/outputs/review_2026-09-07/document_coverage.json` and `tag_coverage.json`. This verifies ticker overlap, not equal period coverage, complete financial notes, or search quality. The local filing fact pack still describes only 137 covered tickers, illustrating why corpus inventory should come from the live manifest rather than prompt prose.

The desired corpus unit is the original document plus faithful page Markdown. Preserve original financial tables in Markdown; dropping normalized financial rows does not mean discarding tables.

Keep identity metadata: stable document/page ID, company, document class, publication date when known, reporting period, physical page number, original PDF link, and document version/hash. Dates with uncertain provenance should remain uncertain. Page roles and topic tags should be small and source-grounded: income statement, cash flow, borrowings, remuneration, capacity/production, related parties, and so on. Do not turn tags into another inferred financial ontology.

Use tags as ranking aids with lexical search over original text. Apply exact entity and requested period constraints from verified metadata; make tag-only filtering explicit, not the default. Read the relevant page plus adjacent continuation pages so table headings, units, and footnotes survive. A mismatch between metadata and the period printed on a page must remain visible.

Three document tools are enough to begin:

- `list_documents(entities, period, document_type)` returns a compact inventory and links.
- `search_pages(query, entities, period, topic_hints)` returns ranked page snippets with IDs and metadata.
- `read_pages(ids, include_neighbors)` returns faithful Markdown and source references, with a total budget.

Corpus selection can be an optional argument for filings, announcements, or macro documents; workers should not need to know physical table names. Fixed application SQL implements the tools. No model-authored SQL or lane submit protocol is necessary.

If current-price questions remain in scope, keep one thin dated market-snapshot tool. Otherwise label the initial experiment as document-only and omit current valuation claims. Current prices are not usually available in the financial report being read. A market snapshot does not require reviving normalized statement/model machinery.

## Calculations and sections

Let the researcher perform requested calculations in its answer initially, displaying source inputs, units, and formula. Do not restore mandatory extraction or a generic model-building engine. Request-local tables produced while answering remain local cited work, not new canonical facts written into the corpus. A general calculator can be evaluated later if real errors justify it.

Persist each section's question, scope, Markdown, source IDs, evidence snapshot references, status, and revision. Keep raw evidence reloadable; another worker's summary is an interpretation, not a replacement source. On a follow-up, reuse the relevant section and evidence, and refresh the dependent conclusion only if its inputs changed.

The UI needs pending, running, complete, partial, and failed section states. Publish completed sections first rather than interleaving token streams into one Markdown string. Retry a failed section by ID without rerunning successful sections; use revision IDs so an older request cannot overwrite a later edit. These are delivery mechanics, not financial reasoning rules.

Sectioning does not automatically improve correctness. Shared units, periods, and requested scope must travel to every worker; contradictions should be disclosed. Do not always add an evaluator agent. Use a bounded reconciliation call for an actual cross-section conclusion, and evaluate source fidelity offline on representative tasks.

## What changes in this repository

| Current component | Proposed disposition |
|---|---|
| `router.ts`, `contracts.ts`, intent recovery | Replace research routing with a small question/section planner; remove compute-product taxonomy from this path. |
| `lane.ts` SQL/tool/extraction/submit choreography | Replace with one reusable document researcher using fixed retrieval tools. |
| `model_build.ts`, ROIC/dividend/FCF screen engines | Disconnect from the new path, then retire unused runtime and prompts after the comparison. Preserve stored user artifacts. |
| `analyst.ts` | Keep useful citation rendering; replace the large financial rule assembly with a concise section-writing prompt and optional conclusion prompt. |
| `runtime.ts` | Extract page fetch, source mapping, lexical search, and neighbor reads. Remove structured provenance recovery from the new path. |
| `orchestrator.ts` | Replace with plan, bounded worker execution, section persistence, and optional conclusion. No semantic output overrides. |
| `index.ts`, DO, auth, logging | Reuse transport and persistence; add section events/records. Keep internal errors distinct from user messages. |
| SourcePanel, Message, useChat | Reuse the source reader; render independently completed sections inside one answer. Do not require a new dashboard. |

The target maintenance surface is three prompts (plan, research, optional conclusion), three document tools, a small report record, and a generic call loop. The server still owns access, budgets, source identity, retries, and persistence. Financial interpretation lives in the model context.

## A bounded comparison before deleting data

Use the same corpus snapshot and model configuration where possible:

A. Existing engine: retain current outputs as the product baseline.

B. One document researcher: no structured financial reads or model templates.

C. The same document researcher with section decomposition on broad questions.

B versus C isolates whether decomposition helps. A versus B measures the combined impact of changing retrieval/architecture; do not attribute that difference solely to dropping structured rows. If useful, compare B with and without a thin structured lookup separately.

Use approximately twenty real multi-turn tasks, including UBL remuneration, KOHC EV/clinker/USD, TGL/BGL related parties, ILP period-specific capex, company operating drivers, and the multi-company credit-sales question. Include broad CAGR and market-ranking requests to make the losses visible rather than selecting only document-friendly cases.

Judge correctness against the source pages, entity/period coverage, tables and units, citation support, follow-up continuity, latency, and tokens. Check section consistency as well as each section individually. Repeat consequential cases to detect variability. Score content outcomes, not whether the new path reproduces old lane names or compute traces.

Likely tradeoff: document reading is well aligned with company research and note analysis. Exhaustive market-wide numeric ranking, long financial histories, and large exports become slower and harder to make complete. Make that a deliberate product boundary. A future batch export/screening product can be separate if repeat demand warrants it.

No new harness was installed, no model experiment was executed, and no production or application behavior was changed in this investigation. This recommendation narrows the earlier review: unit fidelity should come primarily from faithful source context, not a prerequisite rebuild of the structured-financial system.
