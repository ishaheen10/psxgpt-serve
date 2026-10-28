import TICKERS from "../../data/tickers100.json";
import type { Env } from "../types";
export const aggregateMetrics = [
  "deposits",
  "total_assets",
  "total_equity",
  "market_cap",
] as const;
export interface SelectionRequest {
  metric: string;
  industry?: string;
  period?: string;
  basis?: string;
  direction?: string;
  limit?: number;
  minimum?: number;
  maximum?: number;
}
export async function selectCompanies(env: Env, args: SelectionRequest) {
  if (!aggregateMetrics.includes(args.metric as any))
    throw new Error(
      "Unsupported aggregate. Use deposits, total_assets, total_equity or market_cap.",
    );
  const market = args.metric === "market_cap";
  let industry = (args.industry || (market ? "all" : "banks")).toLowerCase();
  // The roster uses two labels for the same commercial-bank universe.
  if (["banking", "commercial banks"].includes(industry)) industry = "banks";
  const universe = TICKERS.filter((t) =>
    industry === "all"
      ? true
      : industry === "banks"
        ? /^(banking|commercial banks)$/i.test(t.Industry)
        : t.Industry.toLowerCase() === industry,
  );
  if (!universe.length)
    throw new Error("Unknown industry. Use an industry from find_companies.");
  const basis = market ? "market" : args.basis || "unconsolidated";
  if (!market && !["unconsolidated", "consolidated"].includes(basis))
    throw new Error("Specify one consolidation basis.");
  if (args.period && !/^\d{4}-\d{2}-\d{2}$/.test(args.period))
    throw new Error("Use an exact reporting date YYYY-MM-DD.");
  const symbols = universe.map((t) => t.Symbol);
  const placeholders = symbols.map(() => "?").join(",");
  const result = market
    ? await env.DB.prepare(
        "SELECT ticker,date AS period_end,market_cap AS value_rupees,market_cap AS value,'usable' AS status,'PSX market capitalization' AS original_label,'https://dps.psx.com.pk/company/'||ticker AS source_url FROM market_data WHERE date=COALESCE(?,(SELECT MAX(date) FROM market_data))",
      )
        .bind(args.period || null)
        .all<Record<string, any>>()
    : await env.DB.prepare(
        `SELECT * FROM research_aggregates WHERE metric=? AND basis=?${industry === "all" ? "" : ` AND ticker IN (${placeholders})`} ORDER BY period_end DESC`,
      )
        .bind(args.metric, basis, ...(industry === "all" ? [] : symbols))
        .all<Record<string, any>>();
  const all = result.results || [];
  const period = args.period || all[0]?.period_end || null;
  const selectedPeriod = all.filter((r) => r.period_end === period);
  const eligible: any[] = [],
    excluded: any[] = [];
  for (const company of universe) {
    const observations = selectedPeriod.filter(
      (r) => r.ticker === company.Symbol,
    );
    if (
      observations.length !== 1 ||
      observations[0].status !== "usable" ||
      !Number.isFinite(observations[0].value_rupees)
    ) {
      excluded.push({
        ticker: company.Symbol,
        reason:
          observations.length > 1
            ? "conflicting observations"
            : observations[0]?.reason ||
              "no usable observation at this period and basis",
      });
    } else
      eligible.push({ ...observations[0], company: company["Company Name"] });
  }
  for (const bound of [args.minimum, args.maximum])
    if (bound !== undefined && !Number.isFinite(bound))
      throw new Error("Filter bounds must be finite PKR rupee amounts.");
  const matches = eligible.filter(
    (r) =>
      (args.minimum === undefined || r.value_rupees >= args.minimum) &&
      (args.maximum === undefined || r.value_rupees <= args.maximum),
  );
  matches.sort(
    (a, b) =>
      (args.direction === "asc" ? 1 : -1) * (a.value_rupees - b.value_rupees) ||
      a.ticker.localeCompare(b.ticker),
  );
  const limit = Math.max(1, Math.min(8, Math.floor(Number(args.limit) || 5)));
  return {
    metric: args.metric,
    industry,
    period,
    basis,
    comparisonUnit: "PKR rupees",
    universe: symbols,
    universeSource:
      "Application company roster; current exchange membership has not been independently certified",
    covered: eligible.length,
    total: symbols.length,
    excluded,
    matchingCount: matches.length,
    conditions: {
      minimum: args.minimum,
      maximum: args.maximum,
      direction: args.direction || "desc",
      limit,
    },
    truncated: matches.length > limit,
    rows: matches.slice(0, limit),
    caveat:
      "Ranking applies only to covered companies in this roster, period and basis. Read the selected source pages before interpreting the totals. Missing is not zero. Market dates may differ from reporting dates.",
  };
}
