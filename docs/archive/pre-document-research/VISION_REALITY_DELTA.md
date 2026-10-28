# Vision-to-Reality Delta

**Status:** Current assessment as of 2026-07-16

**Scope:** `psxgpt-pipeline` and `psxgpt-serve`

**Purpose:** Identify the distance between the product vision and the system that exists today, by component and failure boundary.

## North Star

The product should automatically ingest, parse, make searchable, and make modelable any audited statement or PDF issued by an exchange or regulator that researchers and knowledge workers rely on to make decisions.

For any user question, it should identify the most recent and relevant authoritative sources in the shortest practical time, base the answer on those sources, make the sources easy to inspect, and make every material calculation easy to audit.

This is broader than a financial chatbot. It is a continuously refreshed evidence system with chat as its interface.

## Executive assessment

The architecture contains many of the right components, but it is not yet a trustworthy autonomous system. The largest gap is not the absence of stages. It is that a component being implemented is too often treated as equivalent to its contract being proven across the corpus and the deployed path.

The strongest parts today are:

- an explicit source-to-answer architecture across pipeline, D1, retrieval, deterministic compute, analyst synthesis, and source display;
- source provenance, canonical statement fields, typed retrieval asks, curated query surfaces, component traces, scoped data-quality flags, and several deterministic modeling/screening paths;
- increasingly explicit ownership boundaries in both repos, including the rule to repair the earliest bad artifact instead of compensating downstream;
- real failure-driven QC, bounded repair commands, deployed eval entrypoints, and source-panel support.

The weakest parts today are:

1. **Corpus correctness and completeness are not yet continuously certified.** Known route, parse, extraction, unit, source-quality, and coverage cases remain open. Passing a later stage or finding a row in D1 does not prove the row is correct.
2. **Retrieval correctness is not yet consistently proven.** Entity grounding, period selection, table selection, narrative search, multi-ticker coverage, and “latest and relevant” source selection still have known and expected failures.
3. **The publish boundary is operationally fragmented.** Statements, ratios, filing text, FTS, assets, state, and quality flags are separate surfaces. They are intended to act like one release, but they can drift unless the full sequence is run and reconciled.
4. **Runtime non-interference is a live risk.** Router, lane, compute, analyst, and fallback logic now have stronger contracts, but valid model output can still be harmed whenever runtime code silently changes scope, promotes failed evidence, substitutes a source, or rewrites an answer.
5. **The feedback loop is not closed end to end.** Checks can identify many failures, but diagnosis, re-entry, repair, verification, and publication are not uniformly automated or enforced as state transitions.
6. **Automation is partial.** Market data has a scheduled refresh path. The audited filing and document corpus does not yet have a complete discovery-to-production heartbeat with gated retries, quarantine, evaluation, and alerting.

Cron jobs are therefore not the first missing feature. Automating the current system without stronger accuracy and retrieval gates would make wrong or incomplete data arrive faster. The order is: prove stage contracts, prove query behavior, make publishing atomic from the operator's perspective, and then automate the proven loop.

## What “done” requires

A source is not product-ready merely because it has been downloaded, parsed, or inserted into D1. A question is not successfully answered merely because the model returned fluent text.

The North Star requires two end-to-end contracts:

```text
authoritative document
  -> discovered
  -> identity and version verified
  -> parsed faithfully
  -> pages classified correctly
  -> statements and sections routed correctly
  -> values extracted with source evidence
  -> units and periods resolved
  -> QC passed or explicitly quarantined
  -> structured rows, searchable text, and source assets published consistently
  -> retrieval can find the document

user question
  -> entity, intent, period, and comparison scope grounded
  -> evidence plan created
  -> latest and relevant sources retrieved
  -> deterministic calculations executed where supported
  -> analyst synthesizes only supplied evidence
  -> source panel and calculation workpaper match the answer
  -> trace and eval prove the deployed behavior
```

Every transition needs a durable input, output, invariant, failure state, repair owner, re-entry point, and verification command. If one of those is missing, the boundary is descriptive rather than enforceable.

## Component-level delta

### Pipeline: authoritative source to trusted corpus

| Component | Target contract | Current reality and observed failure class | Gap / release gate | Severity |
| --- | --- | --- | --- | --- |
| Source discovery and coverage | Detect every in-scope audited filing or regulator/exchange PDF, including amendments and missing periods, soon after publication. | Coverage reporting exists for the local filing corpus, but discovery and gap closure are not a continuous authoritative feed. “Any audited statement or PDF” is not yet a defined, measured universe. | Define source registries and coverage denominators by issuer, regulator, document class, period, and expected cadence. Alert on missing, late, duplicate, replaced, and amended documents. | Critical |
| Download, identity, and versioning | Preserve the exact original file, issuer, filing type, filing period, publication time, source URL, checksum, and supersession chain. | Source files and provenance exist, but corrupt PDFs and ambiguous or replacement filings still require operator handling. Source availability is not the same as source integrity. | Introduce a document manifest with stable IDs, checksums, source identity, version lineage, download status, and a terminal `source_blocked` state. | High |
| Page parsing / OCR | Produce faithful page text and tables while preserving page identity and layout evidence. | Page parsing is implemented and repairable. Real failures include truncated tables, lost columns, garbled pages, and corrupt PDFs. HBL and TRG examples required page-level reparsing; AGP and KHYT show source-quality limits. | Measure parse fidelity, not just parse completion. Gate thin/garbled/table-loss pages, compare page structure, and route only the exact failed pages to bounded repair. | Critical |
| Page review / classification | Correctly identify statutory statements, notes, schedules, management summaries, basis, and document roles. | Model tagging exists, but summaries, directors' report tables, OCI pages, and statutory statements have collided. Some wrong routes must return to review rather than be corrected downstream. | Maintain a closed page-role vocabulary, adversarial canaries, confidence calibration, and an explicit `needs_review` state when the filing lacks a valid statutory candidate. | Critical |
| Statement routing | Assemble one coherent statement target from the correct page set, basis, role, currency, and period. | Deterministic routing and a route-evidence sidecar now exist. A corpus replay separated summary/statutory and PL/OCI ties, but confirmed and uncertain misroutes remain. Route completion alone does not certify the selected pages. | Require coherent-role and unit evidence before extraction, block incompatible page sets, and report exact re-entry to tagging or routing. Prove changes with whole-corpus route diffs before regeneration. | Critical |
| Structured extraction | Extract every visible target value without inventing or silently dropping rows, periods, signs, or columns. | Registry-driven extraction and source-value coverage checks exist. Empty or incomplete extractions have occurred even on clean routed pages, and low coverage can mean parse failure, extraction failure, unusual source presentation, or a genuinely sparse statement. | Make cell-level source coverage and sign/period alignment first-class. A low-coverage detector must classify the earliest likely boundary before any re-extraction. | Critical |
| Unit and currency resolution | Resolve scale and currency from the exact target statement, preserve literal evidence, and never overwrite a valid extraction without stronger source evidence. | Step 10 is now the declared authority, with later stages intended to preserve or contain. Historical peer fallbacks, document-wide language, source header conflicts, and exceptional issuer labels create residual uncertainty. | Every published statement group needs a decisive, auditable unit decision or quarantine. Later stages must never become silent alternate unit authorities. Overrides must remain exact-source and reviewed. | Critical |
| Normalization and canonical mapping | Preserve source values while mapping issuer labels into stable, industry-aware fields. | Canonical fields and statement sections exist, but unusual issuer labels and sector-specific presentation can still become missing or misclassified inputs. | Track unmapped, multiply mapped, and low-confidence labels by corpus frequency. Require source label, canonical label, mapping version, and provenance on every row. | High |
| Derivation and ratios | Compute quarter/LTM values and ratios deterministically from compatible, correctly scaled inputs. | Deterministic derivation and ratio stages exist. Their outputs inherit upstream period, sign, section, and unit errors; external-reference disagreement is useful evidence but not proof of the correct value. | Require input lineage for every derived value, compatibility checks on duration/basis/section/unit, and exact upstream repair pointers for every failed calculation. | High |
| QC, triage, and quarantine | Detect structural, arithmetic, semantic, coverage, and cross-period failures; identify the earliest implicated stage; end in repaired, caveated, quarantined, or verified-published state. | Many checks and a causal triage queue exist. Recent manual review reduced a queue but left confirmed routes, low-coverage cases, garbled sources, and a corrupt PDF unresolved. Some checks detect symptoms without automatically closing the repair loop. | Make the issue contract universal across stages. No open issue should lack origin stage, owner, exact target, re-entry command, verification command, and terminal disposition. | Critical |
| Publish to D1, FTS, and R2 | Publish only certified scopes, preserve known-good production rows when a repair is blocked, and update all dependent surfaces as one release. | Exact target manifests, SQL-only diffs, quarantine, and state reconciliation exist. Statements, ratios, documents, assets, FTS, and quality flags are still separate operations and can be out of sync. | Add a release manifest and transactional state machine: preflight all affected surfaces, publish idempotently, verify row/source parity, then atomically mark the filing live. Roll back or retain the prior certified version on failure. | Critical |
| Freshness and heartbeat | Continuously discover, process, evaluate, publish, and monitor the corpus within a defined service level. | The filing pipeline remains operator-driven. Serve has a scheduled market-data worker, but not a complete audited-document heartbeat. | Automate only after the accuracy and publish gates above. The heartbeat must report lag and state per document, retry bounded failures, quarantine uncertain scopes, run canaries, and alert rather than silently stall. | High after correctness gates |

### Serve: user question to auditable answer

| Component | Target contract | Current reality and observed failure class | Gap / release gate | Severity |
| --- | --- | --- | --- | --- |
| Entity and scope grounding | Resolve companies, tickers, industries, document families, periods, and follow-up scope exactly; never silently substitute a nearby entity. | Typed scope and guards exist. Past failures include ticker-like acronyms, company-name aliases, unresolved entities, and follow-ups that can unexpectedly change scope. | Maintain canonical entity resolution separate from financial concept detection. Evals must cover aliases, bare names, invalid tickers, acronyms, multi-company asks, and follow-up inheritance. | Critical |
| Router / evidence planning | Select the narrowest correct tables, narrative corpora, compute products, dependencies, and requested periods. | Typed evidence plans and prompt packs exist. Runtime intervention and collision evals were added because deterministic query-text detection and normalization can collide with valid model plans. | A valid model plan must remain authoritative. Runtime may validate structure or request a model-authored retry, but semantic replacement must be exceptional, traced, and fail closed. | Critical |
| Structured lanes | Query curated D1 surfaces with exact period, section, basis, metric, provenance, and coverage. | Curated views and lane contracts exist, but plausible SQL can still return the wrong period, broad rows, incomplete ticker coverage, or data without enough keys for source recovery. | Add query-shape canaries from real failures, enforce exact coverage contracts, and score answer inputs for ticker/period/metric/source alignment before analyst synthesis. | Critical |
| Narrative retrieval | Find the best filing, announcement, note, schedule, or regulator page rather than merely any text match. | Separate corpora, FTS, shaping tools, neighbor expansion, and extraction workpapers exist. Search can still select weak pages, lose multi-ticker balance, or expose candidates that were never validly submitted. | Evaluate source relevance independently of answer quality. Rank by authority, ticker, filing date, requested period, page role, concept fit, and completeness; failed candidates stay trace-only. | Critical |
| Dependency orchestration | Preserve evidence-backed selector outputs, execute independent work in parallel, and never broaden an empty dependency. | Explicit ask IDs and dependency contracts exist. Earlier behavior could allow inferred or empty selections to affect downstream scope. | Enforce artifact lineage for every dependent ask and fail as missing scope when the named selector has no accepted evidence. | High |
| Deterministic compute | Own repeatable arithmetic and models in code, using correctly aligned source inputs and formulas visible to the user. | Model build and several screens exist, but coverage is partial by industry/template. Dividend yield is deliberately a rough cash-flow proxy rather than declaration-accurate DPS yield. Compute remains only as reliable as the pipeline rows and quality preflight. | Define supported products precisely, expose numerator/denominator/formula/period/source, hard-fail relevant blockers, and label proxies and unsupported templates instead of implying precision. | High |
| Runtime intervention boundary | Validate and format without colliding with or overwriting correct router, lane, or analyst output. | The spec, intervention ledger, and ablation eval recognize this risk. Multiple layers of recovery, source backfill, answer disclosure, and deterministic products still increase the collision surface. | Inventory every behavior-changing intervention. For high-risk changes require before/after traces, prompt-only ablation, explicit allowlisting, and proof that valid model output is never superseded. | Critical |
| Analyst synthesis | Explain only retrieved and computed evidence, disclose insufficiency, and preserve authoritative computed tables. | A structured analyst payload, citation tags, source/table selection markers, and correction retry exist. Fluent unsupported claims, recomputation, or generic answers remain possible if upstream context is weak or the output contract is not enforced. | Claim-level evidence checks, correct-insufficiency evals, citation validation, and no fallback to all context when selection markers fail. | Critical |
| Source recovery and source panel | Make the exact evidence behind the answer immediately visible and stable. | Source previews and recovery exist, but structured rows or computed tables can omit keys; fallbacks can recover the right ticker but wrong page, period, or metric; document rows and R2 assets can drift. | Each material answer/table row needs a recoverable source lineage. Test answer citations, analyst-visible sources, UI previews, asset availability, and period/metric match as one contract. | Critical |
| Calculation auditability | Let a user inspect inputs, formulas, transformations, assumptions, and source pages without reverse engineering the prose answer. | Computed tables and model artifacts support this for some paths, but auditability is not uniform across lane calculations, narrative numeric extraction, ratios, and analyst-created transformations. | Standardize a calculation workpaper schema: operation, formula, typed inputs, units, periods, source IDs, exclusions, assumptions, result, and warnings. The UI should render it directly. | High |
| Follow-ups and saved models | Preserve the exact evidence/model state across inspection and assumption changes. | Durable model state and deterministic updates exist for supported templates, but follow-up entity/model selection and unsupported transforms remain a risk. | Version saved state, bind follow-ups to explicit model/evidence IDs, show diffs, and prove that unrelated assumptions and historical inputs do not change. | High |
| Evals and observability | Reproduce historical failures, isolate the first broken boundary, and prove the deployed path rather than just response shape. | Regression, reliability, context-quality, runtime-collision, model-build, trace, and deployed replay tools exist. Suites still include known failures, can time out, and do not yet certify every corpus or source-relevance boundary. | Build a layered matrix: component contract tests, corpus audits, cross-repo integration cases, deployed answer/source checks, and production health canaries. Preserve `XFAIL` as an open defect, not a green result. | Critical |
| Deployment and user-visible state | Test the exact production-shaped bundle, keep frontend/backend/database versions compatible, and show accurate progress or failure. | Test and production Workers/Pages are separate. A push or local pass is not deployment proof, and frontend API targeting or partial progress metadata can drift. | Publish versioned compatibility metadata, smoke the intended backend and frontend together, and block promotion unless deployed evals and source-panel checks pass. | High |

## Where the system is weakest

The weaknesses should be addressed in this order because each later layer depends on the earlier one.

### 1. Trustworthy corpus

The first question is not “is there a row in D1?” It is “did the correct source page produce this row, with the correct statement role, period, section, sign, unit, and canonical mapping?” Recent failure review shows that parse, route, extraction, and source-quality defects can all produce superficially plausible downstream artifacts.

The immediate target is a corpus where every statement group is either certified, caveated with a narrow disclosure, or quarantined without replacing the previous known-good version.

### 2. Trustworthy retrieval

Even perfect data is not useful if the system resolves the wrong company, chooses the wrong surface, substitutes “latest” for an exact period, misses the best filing page, or loses coverage across requested tickers. Retrieval needs independent correctness scoring before answer scoring.

The immediate target is a query eval that can say: the right entity, table, filing, period, page role, and evidence set were selected—even if the final prose answer is withheld.

### 3. Trustworthy answer and calculation boundary

The analyst should explain evidence, not repair retrieval or recreate deterministic arithmetic. Runtime code should validate and disclose, not silently replace correct model output. Every material number should be traceable to a supplied row or an explicit calculation workpaper.

The immediate target is zero silent semantic interventions and claim/source/calc alignment on the deployed eval set.

### 4. Consistent publication

The database is not one table. A ticker-period can have statement rows but stale ratios, missing filing text, absent page assets, an old FTS index, or obsolete quality flags. These are user-visible data defects even if the statement rows themselves are correct.

The immediate target is a per-filing release manifest that proves all required production surfaces are synchronized before the filing becomes eligible for serve.

### 5. Automated freshness and health

Only after the above boundaries are reliable should discovery, processing, QC, publishing, deployed evals, and alerting become a continuous heartbeat.

The immediate target is not “run every script on a cron.” It is “advance each document through an idempotent state machine, stop safely on uncertainty, preserve known-good production data, and make stalled or unhealthy states visible.”

## The missing control plane

Both repos have logs, artifacts, traces, reports, eval outputs, and quality flags. What is still missing is one cross-repo control plane that answers, for every filing and every deployed release:

- What authoritative object is this?
- Which version is current and which version is live?
- Which stages passed, failed, or were skipped?
- What exact artifact did each stage consume and emit?
- What evidence supports the page role, unit, period, and extracted values?
- Is the structured row, searchable text, FTS entry, page PDF, thumbnail, ratio set, and quality state synchronized?
- Which queries and model products depend on this filing?
- Which corpus, retrieval, calculation, citation, and UI canaries passed against the deployed version?
- If it failed, which component owns the repair and where does processing re-enter?

This should be represented as a versioned filing manifest plus a release ledger, not reconstructed from console output after an incident.

## Release sequence

### Release 1: Corpus accuracy and publish integrity

Exit criteria:

- The in-scope document universe and coverage denominator are explicit.
- Every filing has stable identity, checksum, version, and source status.
- Every statement target has route evidence and an exact unit decision or quarantine.
- Parse, route, extraction, normalization, derivation, and QC issues identify the earliest implicated stage and exact repair scope.
- Whole-corpus deterministic audits pass within defined thresholds; remaining cases have reviewed dispositions.
- A target-scoped publish updates statements, ratios, documents, FTS, R2 assets, state, and quality flags as one verified release.
- Production reconciliation proves that no blocked repair overwrote known-good data.

### Release 2: Query correctness and answer auditability

Exit criteria:

- Entity, period, table, source-family, and follow-up-scope evals pass on historical failures and adversarial edge cases.
- “Most recent” and “most relevant” are measured separately, with correct filing/page selection evaluated before final-answer quality.
- Valid router, lane, and analyst output is not silently superseded by runtime code.
- Deterministic products expose formula, inputs, units, periods, exclusions, warnings, and source lineage.
- The final answer, analyst payload, accepted tables, citation tags, and visible source panel agree.
- Deployed test-worker and browser checks pass against the same database/release version before production promotion.

### Release 3: Automated freshness and system heartbeat

Exit criteria:

- Scheduled discovery advances new documents through the same gated contracts used during manual operation.
- Retries are bounded and scoped; uncertain work is quarantined; known-good production data is preserved.
- Corpus audits, retrieval evals, answer/source checks, and deployment smokes run automatically at the appropriate cadence.
- A health view reports source lag, stage backlog, quarantine age, D1/FTS/R2 parity, eval status, deployed version, and user-visible incident scope.
- Alerts identify the earliest failing component and include a repair/replay command.

## Metrics that should define progress

Raw script completion and aggregate eval pass rate are insufficient. The system needs boundary-specific measures.

| Area | Minimum useful metrics |
| --- | --- |
| Coverage and freshness | expected vs discovered documents; missing/late/amended filings; publication-to-live latency; oldest unprocessed and quarantined items |
| Source integrity | download success; checksum/version conflicts; corrupt PDFs; renderable-page rate; source-blocked count |
| Parse and review | page parse fidelity; thin/garbled/table-loss rate; page-role precision/recall on reviewed canaries; basis/period disagreement rate |
| Route and extract | coherent-route pass rate; blocked-route count; exact source-value coverage; empty extraction rate; sign/period alignment failures |
| Units and normalization | exact-header resolution rate; document-policy fallback rate; conflicting/unresolved rate; override count and age; canonical mapping gaps |
| QC and publish | certified/caveated/quarantined statement groups; unresolved issues by origin stage; D1/FTS/R2/state/flag parity; publish rollback/retention events |
| Retrieval | entity grounding accuracy; exact-period adherence; requested-ticker coverage; correct table/source-family rate; latest-source hit rate; source-relevance score |
| Compute and analyst | blocked-input detection; formula/input lineage completeness; unsupported-scope correctness; unsupported-claim rate; runtime intervention and obstruction rate |
| Auditability | material claims with accepted source; calculated outputs with complete workpapers; citation/source-panel agreement; visible source asset availability |
| Evals and operations | pass/fail/XFAIL/XPASS by component; timeouts; deployed canary status; mean time to attribute; mean time to repair; recurrence rate |

## Definition of North Star achieved

The North Star is reached when a newly published in-scope document can enter without manual orchestration, move through explicit evidence-gated stages, stop safely when uncertain, become structured and searchable only after its required contracts pass, and be selected correctly for a real user question.

For the resulting answer, a user must be able to see:

1. why these sources were considered the latest and most relevant;
2. the exact pages and structured rows used;
3. the period, basis, section, currency, and units;
4. the formulas, inputs, assumptions, and exclusions behind calculations;
5. any known limitation or unresolved quality warning; and
6. a trace that lets an operator identify the first failing component without reconstructing the workflow manually.

Until those conditions are routinely proven on the deployed system—not only documented or demonstrated on selected cases—the product has a strong architectural foundation, but not yet the autonomous, trustworthy evidence system in the vision.

## Current reference contracts

This assessment should be read alongside the current implementation contracts:

- Serve North Star and engine contract: [`../apps/analysis/spec.md`](../apps/analysis/spec.md)
- Serve operating and verification model: [`AGENT_OPERATING_MODEL.md`](AGENT_OPERATING_MODEL.md)
- Serve component boundaries: [`component_contracts/`](component_contracts/)
- Near-term serve objectives: [`NEXT_PHASE_OBJECTIVES.md`](NEXT_PHASE_OBJECTIVES.md)
- Pipeline architecture: `psxgpt-pipeline/PIPELINE_SPEC.md`
- Pipeline feedback and re-entry contract: `psxgpt-pipeline/docs/PIPELINE_FEEDBACK_CONTROL.md`
- Latest pipeline manual review evidence: `psxgpt-pipeline/docs/MANUAL_STATEMENT_REVIEW_2026-07-16.md`
