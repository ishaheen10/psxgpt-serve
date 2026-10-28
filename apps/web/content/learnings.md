# What I built, and what I learned

psxGPT was a research assistant for companies listed on the Pakistan Stock Exchange. You asked a question; it read annual and quarterly reports, PSX announcements and economic documents, and answered with links to the exact pages it used. It ran from 2025 until October 2026, when I retired the live service. The code is open source and these notes stay up.

## What it was

Two systems shared one database:

- **A pipeline** turned thousands of filing PDFs into searchable Markdown pages, tagged them, and extracted financial statements into rows with links back to the source page.
- **A query engine** took a question, found the relevant pages and data, and wrote an answer with citations. Every run left a trace showing what was searched, read and written.

The [methodology](/guides/methodology.html), [pipeline guide](/guides/pipeline_guide.html) and [engine guide](/guides/engine_guide.html) describe that design in detail.

## What worked

- **Traceability first.** Every answer pointed to a document and a page. When something was wrong, I could find out *where* it went wrong instead of guessing. This was the most valuable decision in the project.
- **Every stage writes a file.** In the pipeline, each step's output was the next step's input and also the debugging surface. Any stage could be re-run on its own.
- **Spend compute last.** Free deterministic checks first, a cheap model next, and expensive reasoning only where the cheaper steps couldn't decide.
- **Fix the earliest broken artifact.** Classifying a bad answer as a routing, retrieval, data, compute or writing failure, then repairing the first stage that went wrong, beat patching the final answer every time.
- **Deep investigations were the real use.** The best sessions were connected chains of questions: related-party balances, product mix, capacity and financing, operating drivers. People asked for the underlying evidence, then changed the period or the assumption. That is research, not chat.

## What didn't

**Fresh, complete data was the product.** When a filing wasn't in the corpus, no prompt could make up for it. Users asked for the latest bank results and got the previous quarter. A per-company coverage list ("prices as of X, statements through Y") should have come before any answer quality work.

**Clever runtime shortcuts hid correct plans.** Over time I added routing overrides, recovery paths and answer corrections, each fixing one case. Traces showed the engine sometimes planned the right research and then a shortcut answered a different question. Every fix added more interference. The eventual cure was deleting the router, the table-specific lanes and 29 prompt packs.

**Numbers lose meaning without units.** Statement figures in thousands mixed with market values in rupees, and an answer was off by a factor of a thousand. Any number passed between steps needs its unit, currency, period and source attached, and checked at the boundary. Asking the model to remember isn't enough.

**Chat history is not research state.** Follow-up questions lost the company or the period because only a few truncated messages carried forward. Pages the engine had already read were not carried over. The thing worth saving is the research itself: what's in scope, which sources, which inputs, which open questions.

**Automatic financial modeling created work nobody asked for.** The engine built forecasts for questions that only needed a lookup, and some of those forecasts were implausible. A calculation should be something the user asks for explicitly, on evidence they've chosen.

**Transcribed tables can be wrong in quiet ways.** OCR damaged some headings and column alignments, and the model would still answer confidently. Source fidelity is an upstream problem. Prompts can ask for caution, but they can't repair a bad page.

**Depth didn't become habit.** People who used it went deep, but relatively few came back on another day. A tool for long-running research has to make returning to earlier work easy, and psxGPT never quite did.

## Where it ended

The final version was much simpler than what came before. A question becomes a short outline of up to three independent sections. Each section searches the reports, reads the original pages and writes its part with source links, streaming as it goes. Follow-ups reuse pages already read. Dated PSX market data stayed. Precomputed ratios, normalized statements and model builders were removed. About 950 lines replaced a much larger system, and answers got easier to check.

## If I did it again

1. Publish coverage and freshness before anything else.
2. Start with the simplest loop of search, read and write with citations. Add machinery only when an evaluation shows it's needed.
3. Make every number a typed record with unit, period and source.
4. Make a saved research page, not a conversation, the main object.
5. Build small gold sets for each stage early, and audit answers against the source text, not just automated checks.

## Run it yourself

The code is on GitHub: [psxgpt-serve](https://github.com/ishaheen10/psxgpt-serve) (query engine and this site) and [psxgpt-pipeline](https://github.com/ishaheen10/psxgpt-pipeline) (builds the corpus from filings). You'll need your own Cloudflare account and model API keys. The corpus itself isn't published; the pipeline rebuilds it from public filings.
