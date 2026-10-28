import type { Env } from "../types";
import type { Evidence } from "./types";
import { rowToSource } from "./sources";
import { searchWeb, readWeb } from "./web";
import TICKERS from "../../data/tickers100.json";
const string = { type: "string" };
const strings = { type: "array", items: string, maxItems: 8 };
const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});
export const researchTools = [
  tool(
    "search_web",
    "Discover public web sources for current information or gaps in the corpus. Read results with read_web before citing.",
    { query: string },
    ["query"],
  ),
  tool(
    "read_web",
    "Read a discovered web page by its web-result-N id. Prefer id over copying opaque URLs. A user-supplied public URL is also allowed. Returns a labelled source digest.",
    { id: string, url: string, question: string },
    ["question"],
  ),
  tool(
    "find_tagged_pages",
    "Find filing pages by section tag and optional basis. If absent, use search_pages; missing tags do not prove missing disclosure.",
    {
      tickers: strings,
      period: string,
      filing_type: { type: "string", enum: ["annual", "quarterly"] },
      tag: {
        type: "string",
        enum: [
          "balance_sheet",
          "profit_loss",
          "cash_flow",
          "changes_in_equity",
          "comprehensive_income",
          "statement_note",
          "ceo_comp",
          "directors_report",
          "auditor_report",
          "operational_metrics",
          "multi_year",
        ],
      },
      basis: { type: "string", enum: ["unconsolidated", "consolidated"] },
    },
    ["tickers", "tag"],
  ),
  tool(
    "find_companies",
    "Find official company symbols or list an industry. Empty query lists all companies.",
    { query: string },
  ),
  tool(
    "list_documents",
    "Inventory available reports, announcements or macro documents. Check availability before claiming a latest or missing period.",
    {
      corpus: { enum: ["filings", "announcements", "macro"], type: "string" },
      tickers: strings,
    },
    ["corpus"],
  ),
  tool(
    "search_pages",
    "Search original text AND search summaries. Returns excerpts and page IDs, not authoritative evidence. Read matching pages before citing. Use a few distinct topic words, not a full question. Tags are hints, never required.",
    {
      corpus: { enum: ["filings", "announcements", "macro"], type: "string" },
      query: string,
      tickers: strings,
      period: string,
      filing_type: { type: "string", enum: ["annual", "quarterly"] },
    },
    ["corpus", "query"],
  ),
  tool(
    "read_pages",
    "Read original Markdown with source metadata. IDs from search: filing:123, announcement:123, macro:123. Filing neighbors include continuation tables. At most 6 IDs per call. Each ID must be a separate array element, never a comma-separated string.",
    {
      ids: {
        ...strings,
        items: {
          type: "string",
          pattern: "^(filing|announcement|macro):[0-9]+$",
        },
        maxItems: 6,
      },
      neighbors: { type: "boolean" },
    },
    ["ids"],
  ),
  tool(
    "market_snapshot",
    "Latest dated PSX price, shares, market capitalization and 52-week range. No precomputed financial ratios. PKR amounts are in rupees.",
    { tickers: strings },
    ["tickers"],
  ),
  tool(
    "finish_research",
    "Finish gathering context. State whether evidence supports the assigned question or only a partial answer. Never equate successful retrieval with complete coverage.",
    {
      coverage: {
        type: "string",
        enum: ["supported", "partial", "unsupported"],
      },
      gap: string,
    },
  ),
];
export function ftsQuery(value: string): string {
  return (
    value
      .match(/[\p{L}\p{N}_]+/gu)
      ?.slice(0, 10)
      .map((w) => `"${w}"`)
      .join(" OR ") || '"__empty__"'
  );
}
const tickersOf = (v: unknown): string[] => {
  if (v === undefined) return [];
  if (
    !Array.isArray(v) ||
    v.length > 8 ||
    v.some((t) => typeof t !== "string" || !/^[A-Za-z0-9.-]{1,16}$/.test(t))
  )
    throw new Error(
      "Specify company symbols as an array of at most eight strings.",
    );
  return v.map((t) => t.toUpperCase());
};
export async function executeTool(
  env: Env,
  name: string,
  args: Record<string, unknown>,
  evidence: Map<string, Evidence>,
  signal?: AbortSignal,
  webUrls?: Set<string>,
): Promise<unknown[]> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (name === "search_web") {
    const results = await searchWeb(env, String(args.query || ""), signal);
    for (const result of results as any[]) webUrls?.add(result.url);
    return results.map((result: any) => ({
      ...result,
      id: `web-result-${[...(webUrls || [])].indexOf(result.url) + 1}`,
    }));
  }
  if (name === "read_web") {
    if (args.id && webUrls) {
      const match = /^web-result-([1-9][0-9]*)$/.exec(String(args.id));
      args = {
        ...args,
        url: match ? [...webUrls][Number(match[1]) - 1] : undefined,
      };
    }
    if (webUrls && !webUrls.has(String(args.url)))
      throw new Error(
        "Use an exact URL returned by search_web or supplied by the user. Do not guess source URLs.",
      );
    return readWeb(
      env,
      args.url,
      String(args.question || ""),
      evidence,
      signal,
    );
  }
  const tickers = tickersOf(args.tickers);
  const rows = async (sql: string, values: unknown[] = []) =>
    (
      await env.DB.prepare(sql)
        .bind(...values)
        .all<Record<string, unknown>>()
    ).results || [];
  const filter = (prefix = "") =>
    tickers.length
      ? ` AND ${prefix}ticker IN (${tickers.map(() => "?").join(",")})`
      : "";
  if (name === "find_tagged_pages") {
    if (!tickers.length) throw new Error("Specify company symbols.");
    return rows(
      `SELECT DISTINCT 'filing:'||d.id AS id,d.ticker,d.filing_period,d.pg,d.section_tags,substr(d.text,1,500) AS heading FROM financial_documents_new d, json_each(CASE WHEN json_valid(d.section_tags) THEN d.section_tags ELSE '[]' END) t WHERE json_extract(t.value,'$.tag')=?${filter("d.")}${args.period ? " AND d.filing_period LIKE ?" : ""}${args.basis ? " AND json_extract(t.value,'$.basis')=?" : ""}${args.filing_type ? " AND lower(d.filing_type)=?" : ""} ORDER BY d.filing_period DESC,d.pg LIMIT 24`,
      [
        String(args.tag),
        ...tickers,
        ...(args.period ? [String(args.period) + "%"] : []),
        ...(args.basis ? [String(args.basis)] : []),
        ...(args.filing_type ? [String(args.filing_type)] : []),
      ],
    );
  }
  if (name === "find_companies") {
    const q = String(args.query || "").toLowerCase();
    return TICKERS.filter((t) =>
      `${t.Symbol} ${t["Company Name"]} ${t.Industry}`
        .toLowerCase()
        .includes(q),
    );
  }
  if (name === "market_snapshot") {
    if (!tickers.length) throw new Error("Specify company symbols.");
    return rows(
      `SELECT m.ticker,m.date,m.closing_price,m.total_shares,m.market_cap,m.week_52_high,m.week_52_low, 'PKR rupees' AS currency_unit,'https://dps.psx.com.pk/company/'||m.ticker AS source_url FROM market_data m WHERE m.date=(SELECT MAX(n.date) FROM market_data n WHERE n.ticker=m.ticker)${filter("m.")}`,
      tickers,
    );
  }
  if (name === "list_documents") {
    if (args.corpus === "filings")
      return rows(
        `SELECT ticker,filing_type,filing_period,filing_year,COUNT(*) AS pages FROM financial_documents_new WHERE 1=1${filter()} GROUP BY ticker,filing_type,filing_period,filing_year ORDER BY filing_period DESC LIMIT 80`,
        tickers,
      );
    if (args.corpus === "announcements")
      return rows(
        `SELECT 'announcement:'||id AS id,ticker,announcement_date,title FROM psx_announcements WHERE 1=1${filter()} ORDER BY announcement_date DESC LIMIT 40`,
        tickers,
      );
    if (args.corpus === "macro")
      return rows(
        "SELECT source_doc,doc_type,fiscal_year,COUNT(*) AS pages FROM macro_documents GROUP BY source_doc,doc_type,fiscal_year ORDER BY fiscal_year DESC LIMIT 50",
      );
    throw new Error("Unknown corpus.");
  }
  if (name === "search_pages") {
    const query = ftsQuery(String(args.query || ""));
    const period = typeof args.period === "string" ? args.period : "";
    if (args.corpus === "filings")
      return rows(
        `SELECT 'filing:'||d.id AS id,d.ticker,d.filing_type,d.filing_period,d.pg,d.section_tags,substr(d.search_text,1,900) AS summary,snippet(filings_fts_new,1,'[',']','…',64) AS excerpt FROM filings_fts_new JOIN financial_documents_new d ON d.id=filings_fts_new.rowid WHERE filings_fts_new MATCH ?${filter("d.")}${period ? " AND d.filing_period LIKE ?" : ""}${args.filing_type ? " AND lower(d.filing_type)=?" : ""} ORDER BY rank LIMIT 16`,
        [
          query,
          ...tickers,
          ...(period ? [period + "%"] : []),
          ...(args.filing_type ? [String(args.filing_type)] : []),
        ],
      );
    if (args.corpus === "announcements")
      return rows(
        `SELECT 'announcement:'||d.id AS id,d.ticker,d.announcement_date,d.title,substr(d.text,1,1400) AS excerpt FROM psx_announcements_fts JOIN psx_announcements d ON d.id=psx_announcements_fts.rowid WHERE psx_announcements_fts MATCH ?${filter("d.")}${period ? " AND d.announcement_date LIKE ?" : ""} ORDER BY rank LIMIT 16`,
        [query, ...tickers, ...(period ? [period + "%"] : [])],
      );
    if (args.corpus === "macro")
      return rows(
        `SELECT 'macro:'||d.id AS id,d.source_doc,d.doc_type,d.fiscal_year,d.page_num,snippet(macro_fts,4,'[',']','…',80) AS excerpt FROM macro_fts JOIN macro_documents d ON d.id=macro_fts.rowid WHERE macro_fts MATCH ?${period ? " AND d.fiscal_year LIKE ?" : ""} ORDER BY rank LIMIT 16`,
        [query, ...(period ? [period + "%"] : [])],
      );
    throw new Error("Unknown corpus.");
  }
  if (name === "read_pages") {
    if (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > 6)
      throw new Error(
        "Use a source ID array with one to six separate page IDs.",
      );
    const ids = args.ids;
    const output: unknown[] = [];
    for (const key of ids) {
      const match = /^(filing|announcement|macro):(\d+)$/.exec(String(key));
      if (!match) throw new Error("Use a source ID returned by search_pages.");
      const [, corpus, id] = match;
      const table =
        corpus === "filing"
          ? "financial_documents_new"
          : corpus === "announcement"
            ? "psx_announcements"
            : "macro_documents";
      let found = await rows(`SELECT * FROM ${table} WHERE id=?`, [Number(id)]);
      if (corpus === "filing" && args.neighbors && found.length) {
        const p = found[0];
        found = await rows(
          "SELECT * FROM financial_documents_new WHERE ticker=? AND filing_type=? AND filing_period=? AND filing_year=? AND pg BETWEEN ? AND ? ORDER BY pg",
          [
            p.ticker,
            p.filing_type,
            p.filing_period,
            p.filing_year,
            Number(p.pg) - 1,
            Number(p.pg) + 1,
          ],
        );
      }
      for (const row of found) {
        const source = rowToSource(row);
        const eid = `${corpus}:${row.id}`;
        if (!evidence.has(eid) && evidence.size >= 24) {
          output.push({
            limit: "Page budget reached. Use the pages already read.",
          });
          break;
        }
        const text = String(row.text || row.content || "");
        const entry: Evidence = {
          id: eid,
          source,
          text: text.slice(0, 20000),
          retrievedAt: new Date().toISOString(),
        };
        evidence.set(eid, entry);
        output.push({
          ...entry,
          truncated: text.length > 20000,
          note: "Metadata dates are indexing hints. Preserve dates, units, columns and consolidation basis printed on the page.",
        });
      }
    }
    return output;
  }
  if (name === "finish_research") return [];
  throw new Error("Unknown research tool.");
}
