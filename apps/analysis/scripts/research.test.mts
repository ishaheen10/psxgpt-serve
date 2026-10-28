import test from "node:test";
import assert from "node:assert/strict";
import { executeTool, ftsQuery } from "../src/research/tools";
import { runResearch } from "../src/research/engine";

const fakeEnv = (
  answer = (sql: string, _values: unknown[]) =>
    sql.includes("FROM market_data")
      ? [{ ticker: "UBL", date: "2026-09-04", market_cap: 1000 }]
      : ([] as unknown[]),
) => ({
  GEMINI_API_KEY: "test",
  DEEPSEEK_API_KEY: "test",
  DB: {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async all() {
              return { results: answer(sql, values) };
            },
          };
        },
      };
    },
  },
});
test("parameterized source search quotes FTS syntax and never uses financial tables", async () => {
  const captured: any[] = [];
  const env = fakeEnv((sql, v) => {
    captured.push([sql, v]);
    return [];
  });
  await executeTool(
    env as any,
    "search_pages",
    {
      corpus: "filings",
      query: 'CEO " OR *; DROP TABLE x',
      tickers: ["UBL"],
      period: "2025",
      filing_type: "annual",
    },
    new Map(),
  );
  assert.match(captured[0][0], /filings_fts_new/);
  assert.doesNotMatch(captured[0][0], /DROP|CEO|financial_statements|ratios/);
  assert.equal(captured[0][1][1], "UBL");
  assert.match(captured[0][0], /lower\(d.filing_type\)=\?/);
  assert.equal(captured[0][1][3], "annual");
  assert.equal(ftsQuery("ceo pay"), '"ceo" OR "pay"');
  await assert.rejects(
    executeTool(
      env as any,
      "search_pages",
      { corpus: "filings", query: "pay", tickers: "UBL" },
      new Map(),
    ),
    /Specify company/,
  );
  await assert.rejects(
    executeTool(
      env as any,
      "sql",
      { sql: "select * from financial_statements" },
      new Map(),
    ),
    /Unknown/,
  );
});
test("market snapshots omit precomputed ratios and preserve date and rupee basis", async () => {
  let query = "";
  await executeTool(
    fakeEnv((sql) => {
      query = sql;
      return [];
    }) as any,
    "market_snapshot",
    { tickers: ["KOHC"] },
    new Map(),
  );
  assert.match(query, /PKR rupees/);
  assert.match(query, /MAX\(n.date\)/);
  assert.doesNotMatch(
    query,
    /pe_ratio|pb_ratio|enterprise_value|dividend_yield/,
  );
});
test("neighbor pages remain within the same filing and retain table text", async () => {
  const queries: any[] = [];
  const row = {
    id: 123,
    ticker: "KOHC",
    filing_type: "Annual",
    filing_period: "2025-12-31",
    filing_year: "2025",
    pg: 125,
    jpg_path: "KOHC/page_125.jpg",
    text: "PKR thousands\n| Short-term investments | 123 |",
  };
  const env = fakeEnv((sql, v) => {
    queries.push([sql, v]);
    return [row];
  });
  const evidence = new Map();
  await executeTool(
    env as any,
    "read_pages",
    { ids: ["filing:123"], neighbors: true },
    evidence,
  );
  assert.match(
    queries[1][0],
    /ticker=\? AND filing_type=\? AND filing_period=\? AND filing_year=\?/,
  );
  assert.deepEqual(queries[1][1], [
    "KOHC",
    "Annual",
    "2025-12-31",
    "2025",
    124,
    126,
  ]);
  assert.equal(evidence.get("filing:123").text, row.text);
});
test("sections publish independent results and preserve one when another fails; private reasoning never streams", async () => {
  const original = globalThis.fetch;
  let writes = 0;
  const snapshots: any[] = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.response_format)
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                scope: "UBL",
                sections: [
                  { title: "Pay", question: "UBL pay" },
                  { title: "Strategy", question: "UBL strategy" },
                ],
              }),
            },
          },
        ],
      });
    if (request.tools)
      return Response.json({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "market",
                  function: {
                    name: "market_snapshot",
                    arguments: '{"tickers":["UBL"]}',
                  },
                },
                {
                  id: crypto.randomUUID(),
                  function: { name: "finish_research", arguments: "{}" },
                },
              ],
            },
          },
        ],
      });
    if (++writes === 2) return new Response("unavailable", { status: 503 });
    return new Response(
      "data: " +
        JSON.stringify({
          choices: [
            {
              delta: {
                content: "Evidence-backed section",
                reasoning_content: "PRIVATE",
              },
            },
          ],
        }) +
        "\n\ndata: [DONE]\n\n",
    );
  };
  try {
    const result = await runResearch(fakeEnv() as any, {
      query: "UBL pay and strategy",
      history: [],
      onUpdate: async (_s, thinking, content, stream) => {
        assert.equal(thinking, undefined);
        snapshots.push({ content, stream });
      },
    });
    assert.equal(result.researchReport?.sections[0].status, "complete");
    assert.equal(result.researchReport?.sections[1].status, "failed");
    assert.match(result.answer, /Evidence-backed section/);
    assert.ok(
      snapshots.some((x) =>
        x.stream?.research?.sections.some((s: any) => s.status === "queued"),
      ),
    );
    assert.doesNotMatch(JSON.stringify(snapshots), /PRIVATE/);
    assert.ok(
      snapshots.every(
        (s, i) =>
          !i ||
          s.stream.research.revision >
            snapshots[i - 1].stream.research.revision,
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("an interrupted answer stream stays partial and preserves its text", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.response_format)
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                sections: [{ title: "Answer", question: "UBL" }],
              }),
            },
          },
        ],
      });
    if (body.tools)
      return Response.json({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "market",
                  function: {
                    name: "market_snapshot",
                    arguments: '{"tickers":["UBL"]}',
                  },
                },
                {
                  id: "finish",
                  function: { name: "finish_research", arguments: "{}" },
                },
              ],
            },
          },
        ],
      });
    return new Response(
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: "A useful partial answer." } }],
        }) +
        "\n\n",
    );
  };
  try {
    const result = await runResearch(fakeEnv() as any, {
      query: "UBL",
      history: [],
    });
    assert.equal(result.researchReport?.sections[0].status, "partial");
    assert.match(result.answer, /A useful partial answer/);
    assert.match(result.answer, /incomplete/);
  } finally {
    globalThis.fetch = original;
  }
});

test("follow-ups reuse full source evidence", async () => {
  const original = globalThis.fetch;
  let writerBody: any;
  let retrievalCalls = 0;
  const page = {
    id: "filing:123",
    text: "ORIGINAL TABLE",
    retrievedAt: "2026-09-07",
    source: {
      id: "123",
      ticker: "UBL",
      pdfUrl: "https://source.psxgpt.com/page.pdf",
    },
  };
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.response_format)
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                scope: "UBL 2025",
                sections: [
                  {
                    title: "Pay",
                    question: "UBL 2025 pay",
                    reuseEvidenceIds: ["filing:123"],
                  },
                ],
              }),
            },
          },
        ],
      });
    if (body.tools) {
      retrievalCalls++;
      return Response.json({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "market",
                  function: {
                    name: "market_snapshot",
                    arguments: '{"tickers":["UBL"]}',
                  },
                },
                {
                  id: "finish",
                  function: { name: "finish_research", arguments: "{}" },
                },
              ],
            },
          },
        ],
      });
    }
    writerBody = body;
    return new Response(
      "data: " +
        JSON.stringify({ choices: [{ delta: { content: "Cited answer" } }] }) +
        "\n\ndata: [DONE]\n\n",
    );
  };
  try {
    const result = await runResearch(fakeEnv() as any, {
      query: "Break that down",
      history: [],
      previousReport: {
        version: 1,
        id: "previous",
        query: "UBL pay",
        scope: "UBL",
        revision: 1,
        sections: [],
        evidence: [page],
        events: [],
      } as any,
    });
    assert.match(JSON.stringify(writerBody), /ORIGINAL TABLE/);
    assert.equal(result.researchReport?.evidence[0].id, "filing:123");
    assert.equal(retrievalCalls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("cancellation propagates and saves a stopped report without losing completed text", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let saved: any;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.response_format)
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                sections: [{ title: "Answer", question: "UBL" }],
              }),
            },
          },
        ],
      });
    if (body.tools)
      return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        controller.abort();
      });
    throw new Error("Answer call must not start after cancellation");
  };
  try {
    await assert.rejects(
      runResearch(fakeEnv() as any, {
        query: "UBL",
        history: [],
        signal: controller.signal,
        saveReport: (r) => {
          saved = structuredClone(r);
        },
      }),
      (e) => (e as Error).name === "AbortError",
    );
    assert.equal(saved.sections[0].status, "failed");
    assert.match(saved.sections[0].activity, /Stopped by you/);
  } finally {
    globalThis.fetch = original;
  }
});

test("aggregate selection preserves missing coverage, excludes duplicates and never reads full financials", async () => {
  const { selectCompanies } = await import("../src/research/selection");
  const captured: string[] = [];
  const result = await selectCompanies(
    fakeEnv((sql) => {
      captured.push(sql);
      return [
        {
          ticker: "UBL",
          period_end: "2026-03-31",
          status: "usable",
          value_rupees: 5000,
        },
        {
          ticker: "HBL",
          period_end: "2026-03-31",
          status: "usable",
          value_rupees: 4000,
        },
        {
          ticker: "HBL",
          period_end: "2026-03-31",
          status: "usable",
          value_rupees: 4500,
        },
        {
          ticker: "MCB",
          period_end: "2025-12-31",
          status: "usable",
          value_rupees: 9000,
        },
      ];
    }) as any,
    { metric: "deposits", industry: "banks" },
  );
  assert.equal(result.rows[0].ticker, "UBL");
  assert.equal(result.covered, 1);
  assert.ok(
    result.excluded.some(
      (r) => r.ticker === "HBL" && /conflicting/.test(r.reason),
    ),
  );
  assert.ok(result.excluded.some((r) => r.ticker === "MCB"));
  assert.doesNotMatch(captured.join(" "), /financial_statements|ratios/);
  await assert.rejects(
    selectCompanies(fakeEnv() as any, { metric: "ltm_profit" }),
    /Unsupported/,
  );
});

test("web discovery is not evidence; a successful page retrieval is required and private URLs rejected", async () => {
  const { searchWeb, readWeb, publicUrl } = await import("../src/research/web");
  const original = globalThis.fetch;
  const evidence = new Map();
  let retrieved = false;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.ok((init?.headers as any)["x-goog-api-key"]);
    if (body.tools[0].google_search)
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "https://www.sbp.org.pk/report", title: "SBP" } },
              ],
            },
          },
        ],
      });
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: "Retrieved context" }] },
          urlContextMetadata: {
            urlMetadata: [
              {
                retrievedUrl: "https://www.sbp.org.pk/redirected-report",
                urlRetrievalStatus: retrieved
                  ? "URL_RETRIEVAL_STATUS_SUCCESS"
                  : "URL_RETRIEVAL_STATUS_ERROR",
              },
            ],
          },
        },
      ],
    });
  };
  try {
    const found = await searchWeb(fakeEnv() as any, "Pakistan policy rate");
    assert.equal(found.length, 1);
    assert.equal(evidence.size, 0);
    await assert.rejects(
      readWeb(
        fakeEnv() as any,
        "https://www.sbp.org.pk/report",
        "policy",
        evidence,
      ),
      /could not be retrieved/,
    );
    assert.equal(evidence.size, 0);
    retrieved = true;
    await readWeb(
      fakeEnv() as any,
      "https://www.sbp.org.pk/report",
      "policy",
      evidence,
    );
    assert.match(evidence.values().next().value.text, /model-produced/);
    assert.equal(
      evidence.values().next().value.source.pdfUrl,
      "https://www.sbp.org.pk/redirected-report",
    );
    for (const url of [
      "http://example.com",
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://user:pass@example.com/",
      "https://host.internal/",
    ])
      assert.throws(() => publicUrl(url));
  } finally {
    globalThis.fetch = original;
  }
});

test("shared selection precedes section research and reaches every writer without changing country scope", async () => {
  const original = globalThis.fetch;
  const seen: any[] = [];
  let selected = false;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.response_format) {
      assert.match(body.messages[0].content, /PAKISTAN-LISTED/);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                scope: "Pakistan banks",
                selection: { metric: "deposits", industry: "banks" },
                sections: [
                  { title: "Deposits", question: "Bank deposits" },
                  { title: "Market", question: "Selected bank market caps" },
                ],
              }),
            },
          },
        ],
      });
    }
    assert.equal(selected, true);
    if (body.tools)
      return Response.json({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "market",
                  function: {
                    name: "market_snapshot",
                    arguments: '{"tickers":["UBL"]}',
                  },
                },
                {
                  id: "finish",
                  function: {
                    name: "finish_research",
                    arguments: '{"coverage":"partial","gap":"Missing banks"}',
                  },
                },
              ],
            },
          },
        ],
      });
    seen.push(JSON.parse(body.messages[1].content));
    return new Response(
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: "Covered banks only" } }],
        }) +
        "\n\ndata: [DONE]\n\n",
    );
  };
  try {
    const result = await runResearch(
      fakeEnv(() => {
        selected = true;
        return [
          {
            ticker: "UBL",
            period_end: "2026-03-31",
            status: "usable",
            value_rupees: 5000,
          },
        ];
      }) as any,
      {
        query: "Which banks have most deposits and how do valuations compare?",
        history: [],
      },
    );
    assert.equal(seen.length, 2);
    assert.ok(seen.every((s) => s.selection.rows[0].ticker === "UBL"));
    assert.ok(
      result.researchReport?.sections.every((s) => s.status === "partial"),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("empty retrieval cannot produce a plausible answer from model memory", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.response_format)
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                sections: [{ title: "Current news", question: "Current news" }],
              }),
            },
          },
        ],
      });
    if (body.tools)
      return Response.json({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "finish",
                  function: { name: "finish_research", arguments: "{}" },
                },
              ],
            },
          },
        ],
      });
    throw new Error("Writer must not run without evidence");
  };
  try {
    const result = await runResearch(fakeEnv() as any, {
      query: "Current news",
      history: [],
    });
    assert.equal(
      result.researchReport?.sections[0].coverage?.status,
      "unsupported",
    );
    assert.match(result.answer, /couldn’t retrieve readable source evidence/);
  } finally {
    globalThis.fetch = original;
  }
});

test("market cap selection uses PSX values directly, and guessed web links cannot be read", async () => {
  const { selectCompanies } = await import("../src/research/selection");
  let sql = "";
  const result = await selectCompanies(
    fakeEnv((q) => {
      sql = q;
      return [
        {
          ticker: "UBL",
          period_end: "2026-09-04",
          value_rupees: 1234,
          status: "usable",
        },
      ];
    }) as any,
    { metric: "market_cap", industry: "banks" },
  );
  assert.match(sql, /FROM market_data/);
  assert.doesNotMatch(
    sql,
    /financial_statements|research_aggregates|total_shares\s*\*/,
  );
  assert.equal(result.rows[0].value_rupees, 1234);
  await assert.rejects(
    executeTool(
      fakeEnv() as any,
      "read_web",
      { url: "https://www.sbp.org.pk/guessed.pdf" },
      new Map(),
      undefined,
      new Set(),
    ),
    /exact URL/,
  );
});

test("both roster bank labels select the whole commercial-bank universe", async () => {
  const { selectCompanies } = await import("../src/research/selection");
  const banks = await selectCompanies(fakeEnv() as any, {
    metric: "deposits",
    industry: "banks",
  });
  for (const industry of ["Banking", "COMMERCIAL BANKS"]) {
    const result = await selectCompanies(fakeEnv() as any, {
      metric: "deposits",
      industry,
    });
    assert.deepEqual(result.universe, banks.universe);
    assert.ok(
      result.universe.includes("UBL") && result.universe.includes("BOK"),
    );
    assert.ok(!result.universe.includes("JSCL"));
  }
});

test("Google search redirects resolve without fetching arbitrary destinations in the Worker", async () => {
  const { searchWeb } = await import("../src/research/web");
  const original = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = async (url, init) => {
    fetched.push(String(url));
    if (String(url).startsWith("https://generativelanguage.googleapis.com/"))
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/reference",
                    title: "SBP",
                  },
                },
              ],
            },
          },
        ],
      });
    assert.equal(init?.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: { location: "https://www.sbp.org.pk/policy.pdf" },
    });
  };
  try {
    const result: any[] = await searchWeb(fakeEnv() as any, "SBP policy");
    assert.equal(result[0].url, "https://www.sbp.org.pk/policy.pdf");
    assert.equal(fetched.length, 2);
    assert.ok(!fetched.includes(result[0].url));
  } finally {
    globalThis.fetch = original;
  }
});

test("source access survives an omitted inline citation without rewriting answer claims", async () => {
  const { withSourceLinks } = await import("../src/research/engine");
  const evidence: any = [
    {
      source: {
        ticker: "UBL",
        filingPeriod: "2026-03-31",
        pageNumber: 7,
        pdfUrl: "https://source.psxgpt.com/page.pdf",
      },
    },
  ];
  const content = "A model-written finding.";
  const linked = withSourceLinks(content, evidence);
  assert.ok(linked.startsWith(content));
  assert.match(linked, /Sources read/);
  assert.match(linked, /https:\/\/source.psxgpt.com\/page.pdf/);
  assert.equal(withSourceLinks(linked, evidence), linked);
});
