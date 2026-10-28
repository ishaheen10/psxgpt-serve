import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const token =
  process.env.EVAL_TOKEN ||
  process.env.ADMIN_TOKEN ||
  (await readFile(root + ".admin-token.local", "utf8")).trim();
const base =
  process.env.EVAL_BASE_URL ||
  "https://psxgpt-serve-test.isfandiyar-shaheen.workers.dev";
const stamp = Date.now();
const out = root + `eval/outputs/research/${stamp}`;
await mkdir(out, { recursive: true });
const cases = [
  {
    id: "banks",
    queries: [
      "Which banks have the highest deposits, and how do their valuations compare?",
    ],
  },
  {
    id: "market_filter",
    queries: [
      "Which five Pakistani listed banks have the highest PSX market capitalization? Show the stock data as supplied and its date, without calculating ratios.",
    ],
  },
  {
    id: "web",
    queries: [
      "Search the web for the latest State Bank of Pakistan monetary policy announcement. State the announcement date and policy rate, and cite the official source. Distinguish the announcement date from the date you retrieved it.",
    ],
  },
  {
    id: "ubl_pay",
    ticker: "UBL",
    queries: [
      "What was the UBL CEO remuneration in 2025? Cite the original annual-report page.",
      "Break that down into salary, benefits and bonus. Keep the same company and period.",
    ],
  },
  {
    id: "kohc_units",
    ticker: "KOHC",
    queries: [
      "For KOHC, show the latest PSX market capitalization and the cash, short-term investments and borrowings disclosed in its latest annual report. Show the original units and convert the filing amounts into PKR billions. Cite the pages.",
    ],
  },
  {
    id: "ilp_missing",
    ticker: "ILP",
    queries: [
      "What was ILP capital expenditure in the March 2026 quarter? If that report is unavailable, state the latest available reporting period instead.",
    ],
  },
  {
    id: "sections",
    ticker: "MARI",
    queries: [
      "Research MARI in three sections: production trends from annual reports, recent material PSX announcements, and the latest PSX market snapshot. Cite sources and their dates.",
    ],
  },
  {
    id: "related_parties",
    ticker: "TGL",
    queries: [
      "What do TGL and BGL disclose about receivables and payables to each other in their latest annual reports? Identify who owes whom, distinguish closing balances from maximum outstanding during the year, and cite the original pages.",
    ],
  },
  {
    id: "macro",
    queries: [
      "What does the latest available Pakistan Economic Survey say about inflation? Cite its pages and publication period.",
    ],
  },
];
const selected = process.env.EVAL_CASES?.split(",");
let failed = 0;
async function run(c) {
  const history = [];
  for (let i = 0; i < c.queries.length; i++) {
    const query = c.queries[i];
    const start = Date.now();
    try {
      const response = await fetch(base + "/api/internal/eval-query-do", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          user_id: `research-eval-${stamp}-${c.id}`,
          session_id: `research-${stamp}-${c.id}`,
          chat_history: history,
          persist_trace: true,
        }),
        signal: AbortSignal.timeout(180000),
      });
      const data = await response.json();
      await writeFile(
        `${out}/${c.id}-${i}.json`,
        JSON.stringify(data, null, 2),
      );
      const report = data.research_report;
      const errors = [];
      if (!response.ok || !report) errors.push("missing research report");
      if (report) {
        if (
          report.sections.some(
            (s) =>
              s.status === "failed" || (s.status === "partial" && !s.coverage),
          )
        )
          errors.push("unfinished section");
        if (report.events.some((e) => e.error))
          errors.push("source tool error");
        if (c.id === "banks") {
          if (!report.selection?.rows?.length)
            errors.push("missing aggregate selection");
          if (!report.selection?.rows?.some((r) => r.ticker === "UBL"))
            errors.push("UBL missing from selection");
          if (!report.events.some((e) => e.tool === "market_snapshot"))
            errors.push("missing market data");
          if (/global banks|JPMorgan|Bank of America/i.test(report.scope))
            errors.push("wrong universe");
          if (!/UBL|United Bank/i.test(data.answer))
            errors.push("selection not answered");
        }
        if (
          c.id === "market_filter" &&
          report.selection?.metric !== "market_cap"
        )
          errors.push("missing raw market cap selection");
        if (
          c.id === "web" &&
          (!report.events.some((e) => e.tool === "search_web") ||
            !report.evidence.some((e) => e.id.startsWith("web:")))
        )
          errors.push("missing retrieved web evidence");
        if (c.id === "sections") {
          const production = report.sections.find((s) =>
            /production/i.test(s.title),
          );
          if (
            !production?.sourceIds.some((id) =>
              report.evidence.some(
                (e) => e.id === id && /annual/i.test(e.source.filingType),
              ),
            )
          )
            errors.push("production section did not read annual-report pages");
        }
        if (c.id === "sections" && report.sections.length !== 3)
          errors.push("missing independent sections");
        if (
          c.ticker &&
          !report.evidence.some((e) => e.source.ticker === c.ticker) &&
          c.id !== "ilp_missing"
        )
          errors.push("missing target source pages");
        if (
          c.id === "kohc_units" &&
          !report.events.some((e) => e.tool === "market_snapshot")
        )
          errors.push("missing live PSX snapshot");
        if (
          c.id === "ilp_missing" &&
          !/unavailable|not available|not yet|cannot|could not|couldn.t|don.t have|does not include|not in|no .*report/i.test(
            data.answer,
          )
        )
          errors.push("missing requested-period disclosure");
        if (c.id === "ubl_pay" && i === 1 && !/UBL/.test(report.scope))
          errors.push("lost follow-up scope");
        const urls = report.evidence
          .map((e) => e.source.pdfUrl)
          .filter(Boolean);
        if (urls.length && !urls.some((url) => data.answer.includes(url)))
          errors.push("no source-page citation");
      }
      history.push(
        { role: "user", content: query },
        { role: "assistant", content: data.answer || "" },
      );
      console.log(
        JSON.stringify({
          case: c.id,
          turn: i,
          seconds: Math.round((Date.now() - start) / 1000),
          sections: report?.sections.length,
          pages: report?.evidence.length,
          engine: data.engine_id,
          errors,
        }),
      );
      if (errors.length) failed++;
    } catch (error) {
      failed++;
      console.log(JSON.stringify({ case: c.id, error: String(error) }));
    }
  }
}
// Two independent users at a time to avoid artificial provider/DO contention.
const pending = cases.filter((c) => !selected || selected.includes(c.id));
for (let i = 0; i < pending.length; i += 2)
  await Promise.all(pending.slice(i, i + 2).map(run));
console.log(JSON.stringify({ out, failed }));
process.exitCode = failed ? 1 : 0;
