# Source context and bounded selection — 7 September 2026

## Implemented

The research engine retains one planner and independently streamed section writers. It
now shares Pakistan scope and an optional company selection before the section research
starts. Each researcher/writer is explicitly assigned only its own question. There is no
final synthesis bottleneck, normalized financial statement lane or financial model builder.

New capabilities:

- Tagged-page discovery with a fixed vocabulary, full-text fallback and explicit annual/quarterly and year filters.
- Direct source-page aggregate index: deposits, total assets and equity; no constituent
  accounts, derived periods or ratios. Original labels, scale, source and coverage remain.
- Raw PSX market-cap filtering and existing price/share snapshots, with provider dates.
- Google Search discovery and URL-context reading through the existing Gemini connection.
  Resolve provider redirects to actual source URLs, then read by URL or a short result ID.
  Web digests and original filing Markdown remain distinguishable. Web sources open as
  external links in the source panel rather than being forced into a PDF frame.
- Visible partial/unsupported evidence coverage and an empty-evidence guard. These do not
  certify semantic correctness; source and answer review remain necessary.

## Data changes

Published a separate `research_aggregates` table. At 2026-03-31, unconsolidated, it contains
15 deposits, 12 assets and 12 equity observations. The application bank roster has 19
companies. Deposit gaps are BML, SBL, SCBPL and SNBL. Do not treat these as zero or claim
complete exchange coverage. The roster's Banking and COMMERCIAL BANKS labels now resolve
to the same selection universe; investment companies are not included.

The direct publisher reads original page PDFs and checks reported label/value presence
against Markdown. All 15 deposit values were independently located in PDF text; the
leading UBL/HBL/NBP columns/period/units were checked and the BAFL page was visually
inspected because PDF text order was awkward. This does not certify every other number
in those documents. Assets/equity remain less widely covered because ambiguous or
unmatched totals are excluded rather than reconstructed.

Retagged 76 candidate pages in March 2026 bank reports. Equity-change pages had been
mislabelled as balance sheets/profit-and-loss statements; Islamic-business notes also
had primary-statement tags. Contents remain searchable but untagged. Unprinted basis
stays unknown. The same 76 review JSONL rows were synchronized upstream so Step 17 does
not undo the corrections. Pipeline instructions now explicitly preserve these distinctions.

No source Markdown, financial_statements or ratios rows were deleted. The full legacy
pipeline was not disabled for other consumers. New utilities do not depend on it. The
76-page correction is not a corpus-wide retagging claim.

## What failed during verification

- The original bank query initially completed with correct numeric inputs but a contradictory
  comparative sentence. Subsequent source-context prompts prohibit unsupported causes and
  unsolicited ratios and require comparisons to agree with supplied numbers. Later inspected
  replays correctly put UBL first by deposits and market cap, MEBL fourth/second respectively.
  This is an observed improvement, not a deterministic guarantee about model prose.
- Web retrieval initially rejected successful redirects. Search also returned opaque Google
  redirect URLs that the researcher replaced with remembered URLs. Resolve provider redirects
  at the tool boundary; use discovery IDs and reject guessed URLs. An empty evidence pack
  cannot generate a plausible answer from memory.
- One bank replay selected only the five companies under the COMMERCIAL BANKS label. Fixing
  the shared roster-label boundary and adding an alias-universe test prevents that exclusion.
- A three-section replay gathered overlapping context and its production section lacked annual
  pages despite execution checks passing. Section ownership is now explicit and the replay
  checks that production has annual-report evidence. A later source review found quarterly substitutions, so report type/year are now explicit retrieval parameters.
- Broader runs also recorded a missing inline citation and one transient HTTP failure. Focused
  KOHC and related-party reruns passed. Earlier failed artifacts are retained, not overwritten.

## Validation and deployment

15 unit/lifecycle tests pass, along with TypeScript, frontend build and script syntax/diff
checks. Tests include duplicate/missing coverage, bank universe labels, shared selection,
provider redirects, unread web results, cancellation and independent section failures.

Evidence is under ignored `eval/outputs/simplification-2026-09-07/` and dated
`eval/outputs/research/` runs. The final replay/deployment details are in the accompanying
run note. Representative successful runs before the final section-scope change:

- Bank comparison: 15 seconds; market-cap selection: 10 seconds.
- Official SBP web statement: 12 seconds, with announcement/retrieval dates distinguished.
- KOHC: 18 seconds; related-party notes: 23 seconds.
- Follow-up: 11 seconds; three-section request: 30 seconds (execution only in that run).

Test Worker and test Pages only. D1 is shared with production, so the additive index and
scoped tag corrections are shared data changes. Admin issue inspection found no d1_lock
entries in the queried one-hour window. Existing source transcription errors, incomplete
coverage and model mistakes remain limitations. Broad corpus repair and scheduled aggregate
refresh have not been performed in this bounded implementation.

Source-link safeguard: two otherwise useful replays omitted filing URLs despite receiving
source metadata. The final section renderer now appends missing links under “Sources read”.
It leaves the model's claims untouched and performs no financial correction or extra model
call. This guarantees access to supplied evidence, not claim-by-claim citation correctness;
the label intentionally distinguishes that limit. Inline citations are still requested.

## Final focused run

Worker `3c1b69f5-4498-4a0e-ab97-59aa4d26d9c3`; Pages `e349e823` on the test project.
Artifact: `eval/outputs/research/1788782796155`. Five turns passed mechanical checks:
banks 13s, web 13s, three sections 16s, UBL note 15s and its follow-up 11s.
The bank answer preserved the correct five-company order, source units, PSX market data,
coverage gaps and distinct dates. The web answer cited the actual official SBP statement.

The production section now retrieved an FY2025 annual-report page rather than substituting
quarterlies. It still disclosed that its evidence lacked enough years for a production
trend, despite the researcher declaring supported coverage. Treat this as an open answer
quality issue: readiness is model-assessed, not a guarantee that the question was fully
answered. Do not report the full suite as factual validation. Broad retagging, recurring
index refresh and further answer-quality work remain outside this first simplified stage.

Commits: the companion pipeline instruction/documentation change is `19d9324`; its unrelated
corpus-browser working changes were preserved. Source utilities and serving changes are
committed separately in this repository.
