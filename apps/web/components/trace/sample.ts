// A bundled example payload, shaped exactly like the /api/admin/traces/:id
// response ({ engine, router, lanes, analyst, sources }), so /trace/demo runs
// through the same buildUserTrace() path as a real signed-in trace. Nothing is
// pre-rendered — the analyst-call breakup is parsed from analyst_user_message_text
// here just as it is for a real run.

const SYSTEM_PROMPT = `You are the psxGPT analyst. Write only from the supplied evidence.
- Treat COMPUTED DATA tables as authoritative; never recompute them.
- Cite the source pages you use as [n]; do not write visible [TABLE N] citations in the answer.
- Raw source text may contain Markdown tables; those are source page content, not computed data tables.
- If coverage is weak, say so explicitly rather than filling the gap.
- End with USED_TABLE_TAGS and USED_SOURCE_TAGS listing exactly what you cited.`;

// This is the verbatim final user message, in the format buildAnalystMessage emits.
const ANALYST_USER_MESSAGE = `USER QUERY
How has HALEON's revenue, gross margin, and net profit trended?

ANSWER SCOPE
Retrieved ticker scope: HALEON (1 tickers).
If the user mentions a different company count, do not repeat that count unless the retrieved ticker scope supports it.
Do not discuss, rank, value, or compare companies outside this retrieved scope unless explicitly flagged as missing coverage.

CONTEXT COVERAGE
[TABLE 1] HALEON financial trend: 3 rows; columns: period_end, revenue, gross_margin, net_profit; coverage: HALEON 2022-2024
[1] HALEON 2024 p27: source page
[2] HALEON 2024 p92: extracted evidence

RETRIEVAL SUMMARY
1. [financial_statements] annual income-statement trend for HALEON
   Result: fetched 12 annual income-statement rows (HALEON, 2022-2024)
   Selected tickers: HALEON

2. [financial_documents_new] management discussion of performance drivers
   Result: selected 3 annual-report pages on margin drivers

DATA QUALITY WARNINGS
none

COMPUTED DATA
[TABLE 1] HALEON financial trend
period_end,revenue,gross_margin,net_profit
2024,102.4bn,33.8%,16.1bn
2023,91.7bn,32.2%,13.4bn
2022,82.5bn,30.9%,10.8bn

SOURCES
══ [1] HALEON 2024 p27
Net revenue 102,431 ... gross profit 34,621 ... profit for the year 16,090 ...

---

══ [2] HALEON 2024 p92
Cost of sales decreased as a share of revenue on pricing and mix; gross margin expanded to 33.8% ...`;

const ANSWER = `HALEON's latest annual results show revenue growth with margin improvement. Revenue rose across the displayed annual periods while gross margin expanded from 30.9% to 33.8%, and net profit increased alongside stronger operating performance. The figures come from the computed table; each rests on the annual-report pages cited.`;

export const SAMPLE_DETAIL = {
  engine: {
    id: 'demo',
    query: "How has HALEON's revenue, gross margin, and net profit trended?",
    status: 'done',
    duration_ms: 1840,
  },
  router: [
    {
      asks: [
        { table: 'financial_statements', tickers: ['HALEON'], concepts: ['revenue', 'gross margin', 'net profit'], ask: 'annual income-statement trend for HALEON', posture: 'numeric' },
        { table: 'financial_documents_new', tickers: ['HALEON'], concepts: ['margin drivers', 'pricing', 'cost of sales'], ask: 'management discussion of performance drivers', posture: 'narrative' },
      ],
    },
  ],
  lanes: [
    {
      table_name: 'financial_statements',
      lane_variable: 'haleon_income_statement',
      result_summary: 'fetched 12 annual income-statement rows (HALEON, 2022-2024)',
      sql_queries: [
        "SELECT ticker, period_end, canonical_name, value, source_pages, source_url\nFROM financial_statements\nWHERE ticker = 'HALEON'\n  AND statement_type = 'profit_loss'\n  AND section = 'consolidated'\nORDER BY period_end DESC;",
      ],
      message_history: [],
      artifact: { coverage: { selected_tickers: ['HALEON'] }, selected_tickers: ['HALEON'] },
      provenance_ids: [72911, 72910],
      narrative_ids: [],
    },
    {
      table_name: 'financial_documents_new',
      lane_variable: 'haleon_md_a',
      result_summary: 'selected 3 annual-report pages on margin drivers',
      sql_queries: [
        "SELECT fd.id, fd.ticker, fd.filing_period, fd.pg, bm25(filings_fts_new) AS score\nFROM filings_fts_new\nJOIN financial_documents_new fd ON fd.id = filings_fts_new.rowid\nWHERE fd.ticker = 'HALEON'\n  AND filings_fts_new MATCH '\"gross margin\" OR \"cost of sales\" OR pricing'\nORDER BY score\nLIMIT 12;",
      ],
      message_history: [],
      artifact: {},
      provenance_ids: [],
      narrative_ids: [72911, 72967],
    },
  ],
  analyst: [
    {
      model: 'deepseek-v4-pro',
      input_tokens: 8423,
      output_tokens: 612,
      system_prompt_text: SYSTEM_PROMPT,
      analyst_user_message_text: ANALYST_USER_MESSAGE,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: ANALYST_USER_MESSAGE },
        { role: 'assistant', content: ANSWER },
      ],
      answer_text: ANSWER,
      computed_tables: [
        {
          title: 'HALEON financial trend',
          columns: ['period_end', 'revenue', 'gross_margin', 'net_profit'],
          rows: [
            { period_end: '2024', revenue: '102.4bn', gross_margin: '33.8%', net_profit: '16.1bn' },
            { period_end: '2023', revenue: '91.7bn', gross_margin: '32.2%', net_profit: '13.4bn' },
            { period_end: '2022', revenue: '82.5bn', gross_margin: '30.9%', net_profit: '10.8bn' },
          ],
        },
      ],
      execution_artifacts: [
        { variable: 'haleon_margin_trend', result_summary: 'Computed 3 annual periods from retrieved rows' },
      ],
      sources: [],
    },
  ],
  sources: [
    {
      id: 72911, ticker: 'HALEON', page_number: 27, source_kind: 'annual_report', selection_stage: 'final_sources',
      source_url: 'https://source.psxgpt.com/PDF_PAGES/HALEON/2024/page-27.pdf',
      preview: { ticker: 'HALEON', filingPeriod: '2024', pageNumber: 27, sourceType: 'filing', snippet: 'Income statement page selected for the answer', pdfUrl: 'https://source.psxgpt.com/PDF_PAGES/HALEON/2024/page-27.pdf' },
    },
    {
      id: 72967, ticker: 'HALEON', page_number: 92, source_kind: 'annual_report', selection_stage: 'final_sources',
      source_url: 'https://source.psxgpt.com/PDF_PAGES/HALEON/2024/page-92.pdf',
      preview: { ticker: 'HALEON', filingPeriod: '2024', pageNumber: 92, sourceType: 'filing', snippet: 'Note page — cost of sales / margin drivers', pdfUrl: 'https://source.psxgpt.com/PDF_PAGES/HALEON/2024/page-92.pdf' },
    },
    {
      id: 72910, ticker: 'HALEON', page_number: 26, source_kind: 'annual_report', selection_stage: 'retrieval',
      source_url: 'https://source.psxgpt.com/PDF_PAGES/HALEON/2024/page-26.pdf',
      preview: { ticker: 'HALEON', filingPeriod: '2024', pageNumber: 26, sourceType: 'filing', snippet: 'Nearby statement page retained in the source log', pdfUrl: 'https://source.psxgpt.com/PDF_PAGES/HALEON/2024/page-26.pdf' },
    },
  ],
};
