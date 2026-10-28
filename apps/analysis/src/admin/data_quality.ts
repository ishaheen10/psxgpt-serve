import type { Env } from "../types";
import type { AskTable, LaneExecution } from "../compat/types";

export type DataQualitySeverity = "warning" | "blocker";

export interface DataQualityFlag {
  flag_id: string;
  ticker: string;
  severity: DataQualitySeverity;
  status: string;
  category?: string | null;
  affected_table?: string | null;
  failed_stage?: string | null;
  origin_stage?: string | null;
  statement_type?: string | null;
  filing_period?: string | null;
  period_end?: string | null;
  period_duration?: string | null;
  section?: string | null;
  metric?: string | null;
  basis?: string | null;
  source_file?: string | null;
  source_pages?: string | null;
  rule?: string | null;
  message?: string | null;
  user_caution_json?: string | null;
  generated_at?: string | null;
}

export interface ComputeInputQualityScope {
  tickers?: string[];
  affectedTables: Array<"financial_statements" | "ratios" | "market_data">;
  metrics?: string[];
  periodEnds?: string[];
  sections?: string[];
  statementScopes?: Array<{
    statementType: string;
    periodDurations: string[];
    metrics: string[];
  }>;
}

export interface DataQualityCaution {
  ticker?: string;
  metric?: string;
  status?: "yellow" | "red" | string;
  short_message?: string;
  calculation?: {
    formula?: string;
    numerator?: { label?: string; value?: number | string | null; date?: string; period_end?: string };
    denominator?: { label?: string; value?: number | string | null; date?: string; period_end?: string };
    result?: number | string | null;
    result_pct?: number | string | null;
    basis?: string | null;
  };
  reference_check?: Record<string, unknown>;
  basis_notes?: string[];
  [key: string]: unknown;
}

export interface DataQualityMatrixCell {
  period_end: string;
  status: "green" | "yellow" | "red";
  flags: DataQualityFlag[];
}

export interface DataQualityMatrixRow {
  ticker: string;
  status: "green" | "yellow" | "red";
  cells: DataQualityMatrixCell[];
  flags: DataQualityFlag[];
}

export interface DataQualityMatrix {
  ok: true;
  generatedAt: string;
  periods: string[];
  rows: DataQualityMatrixRow[];
  summary: {
    tickers: number;
    periods: number;
    greenCells: number;
    yellowCells: number;
    redCells: number;
    flagCount: number;
  };
}

export interface DataQualityTickerDetail {
  ok: true;
  ticker: string;
  generatedAt: string;
  periods: string[];
  cells: DataQualityMatrixCell[];
  summary: {
    status: "green" | "yellow" | "red";
    greenCells: number;
    yellowCells: number;
    redCells: number;
    flagCount: number;
  };
  statementCoverage: Array<{
    period_end: string;
    statement_type: string;
    section: string;
    period_duration: string;
    rows: number;
    source_files: number;
  }>;
  documents: Array<{
    filing_period: string;
    filing_type: string;
    filing_year: string;
    pages: number;
    first_page: number;
    last_page: number;
  }>;
}

export interface PublicDataHealthFlag {
  severity: DataQualitySeverity;
  category?: string | null;
  affected_table?: string | null;
  period_end?: string | null;
  period_duration?: string | null;
  section?: string | null;
  metric?: string | null;
  message: string;
}

export interface PublicDataHealthRow {
  ticker: string;
  status: "green" | "yellow" | "red";
  earliest_period?: string | null;
  latest_period?: string | null;
  total_periods: number;
  green_periods: number;
  yellow_periods: number;
  red_periods: number;
  cautions: PublicDataHealthFlag[];
}

export interface PublicDataHealth {
  ok: true;
  generatedAt: string;
  corpus: Array<{
    id: "statements" | "filings" | "announcements" | "macro";
    label: string;
    cadence: string;
    rows: number;
    tickers?: number;
    docs?: number;
    sourceType: "statement" | "filing" | "announcement" | "macro";
    description: string;
  }>;
  summary: {
    tickers: number;
    recentPeriodsShown: number;
    totalTickerPeriods: number;
    earliestPeriod?: string | null;
    latestPeriod?: string | null;
    greenCells: number;
    yellowCells: number;
    redCells: number;
    flagCount: number;
    greenTickers: number;
    yellowTickers: number;
    redTickers: number;
  };
  method: string[];
  periods: string[];
  rows: PublicDataHealthRow[];
}

const FLAG_COLUMNS = [
  "flag_id", "ticker", "severity", "status", "category", "affected_table",
  "failed_stage", "origin_stage", "statement_type", "filing_period", "period_end",
  "period_duration", "section", "metric", "basis", "source_file", "source_pages",
  "rule", "message", "user_caution_json", "generated_at",
].join(", ");

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function upper(value: unknown): string {
  return text(value).toUpperCase();
}

function lower(value: unknown): string {
  return text(value).toLowerCase();
}

function isoDate(value: unknown): string {
  return text(value).slice(0, 10);
}

function rowMetric(table: AskTable, row: Record<string, unknown>): string {
  if (table === "ratios") return lower(row.ratio_name);
  if (table === "financial_statements") return lower(row.canonical_name);
  if (table === "market_data") {
    const fields = ["closing_price", "market_cap", "pe_ratio", "dividend_yield", "pb_ratio"];
    return fields.filter((field) => field in row && row[field] !== null && row[field] !== "").join(",");
  }
  return "";
}

function rowPeriodEnd(table: AskTable, row: Record<string, unknown>): string {
  if (table === "market_data") return isoDate(row.date);
  return isoDate(row.period_end);
}

function laneText(lane: LaneExecution): string {
  return [
    lane.artifact.ask,
    lane.artifact.askObject?.ask,
    lane.artifact.askObject?.posture,
    ...(lane.artifact.askObject?.concepts || []),
    ...(lane.artifact.askObject?.ratio_names || []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function flagRelevantToLane(flag: DataQualityFlag, lane: LaneExecution): boolean {
  const category = lower(flag.category || flag.rule);
  if (!category) return true;
  const ask = laneText(lane);
  if (category === "pe_reference_check") {
    return /\bp\s*\/?\s*e\b|price\s*earnings|earnings\s*multiple|valuation\s*multiple|pe\s*ratio/.test(ask);
  }
  if (category === "dividend_yield_reference_check") {
    return /dividend|yield/.test(ask);
  }
  return true;
}

function flagMatchesRow(flag: DataQualityFlag, lane: LaneExecution, row: Record<string, unknown>): boolean {
  const table = lane.artifact.table;
  if (!flagRelevantToLane(flag, lane)) return false;
  const ticker = upper(row.ticker);
  if (!ticker || upper(flag.ticker) !== ticker) return false;
  const affectedTable = lower(flag.affected_table);
  if (affectedTable && affectedTable !== table) return false;

  const flagPeriod = isoDate(flag.period_end);
  const period = rowPeriodEnd(table, row);
  if (flagPeriod && period && flagPeriod !== period) return false;

  if (table === "financial_statements" || table === "ratios") {
    const flagStatement = lower(flag.statement_type);
    const rowStatement = lower(row.statement_type);
    if (flagStatement && rowStatement && flagStatement !== rowStatement) return false;

    const flagDuration = upper(flag.period_duration);
    const rowDuration = upper(row.period_duration);
    if (flagDuration && rowDuration && flagDuration !== rowDuration) return false;

    const flagSection = lower(flag.section);
    const rowSection = lower(row.section);
    if (flagSection && rowSection && flagSection !== rowSection) return false;
  }

  const metric = lower(flag.metric);
  if (metric) {
    const candidate = rowMetric(table, row);
    if (candidate && !candidate.split(",").includes(metric)) return false;
  }

  return true;
}

function compactFlag(flag: DataQualityFlag): DataQualityFlag {
  return {
    flag_id: flag.flag_id,
    ticker: flag.ticker,
    severity: flag.severity,
    status: flag.status,
    category: flag.category || null,
    affected_table: flag.affected_table || null,
    failed_stage: flag.failed_stage || null,
    origin_stage: flag.origin_stage || null,
    statement_type: flag.statement_type || null,
    filing_period: flag.filing_period || null,
    period_end: flag.period_end || null,
    period_duration: flag.period_duration || null,
    section: flag.section || null,
    metric: flag.metric || null,
    basis: flag.basis || null,
    source_file: flag.source_file || null,
    source_pages: flag.source_pages || null,
    rule: flag.rule || null,
    message: flag.message || null,
    user_caution_json: flag.user_caution_json || null,
    generated_at: flag.generated_at || null,
  };
}

export async function fetchComputeInputQualityFlags(
  env: Env,
  scope: ComputeInputQualityScope,
): Promise<DataQualityFlag[]> {
  const tables = [...new Set(scope.affectedTables.map(lower).filter(Boolean))];
  const tickers = [...new Set((scope.tickers || []).map(upper).filter(Boolean))];
  const metrics = new Set((scope.metrics || []).map(lower).filter(Boolean));
  const periodEnds = new Set((scope.periodEnds || []).map(isoDate).filter(Boolean));
  const sections = new Set((scope.sections || []).map(lower).filter(Boolean));
  const statementScopes = (scope.statementScopes || []).map((item) => ({
    statementType: lower(item.statementType),
    periodDurations: new Set(item.periodDurations.map(upper).filter(Boolean)),
    metrics: new Set(item.metrics.map(lower).filter(Boolean)),
  }));
  if (tables.length === 0) return [];

  const tablePlaceholders = tables.map(() => "?").join(", ");
  const tickerClause = tickers.length > 0
    ? `AND ticker IN (${tickers.map(() => "?").join(", ")})`
    : "";
  const result = await env.DB.prepare(`
    SELECT ${FLAG_COLUMNS}
    FROM data_quality_flags
    WHERE status = 'open'
      AND severity IN ('warning', 'blocker')
      AND affected_table IN (${tablePlaceholders})
      ${tickerClause}
    ORDER BY CASE severity WHEN 'blocker' THEN 0 ELSE 1 END, ticker, period_end, metric
    LIMIT 1000
  `).bind(...tables, ...tickers).all();

  return ((result.results || []) as unknown as DataQualityFlag[])
    .filter((flag) => {
      const metric = lower(flag.metric);
      if (metrics.size > 0 && (!metric || !metrics.has(metric))) return false;
      const periodEnd = isoDate(flag.period_end);
      if (periodEnds.size > 0 && (!periodEnd || !periodEnds.has(periodEnd))) return false;
      const section = lower(flag.section);
      if (sections.size > 0 && (!section || !sections.has(section))) return false;
      if (statementScopes.length > 0 && lower(flag.affected_table) === "financial_statements") {
        const statementType = lower(flag.statement_type);
        const periodDuration = upper(flag.period_duration);
        return statementScopes.some((item) =>
          statementType === item.statementType
          && item.periodDurations.has(periodDuration)
          && item.metrics.has(metric)
        );
      }
      return true;
    })
    .map(compactFlag);
}

export function filterComputeInputQualityFlagsToRows(
  flags: DataQualityFlag[],
  rows: Record<string, unknown>[],
): DataQualityFlag[] {
  const matched = new Map<string, DataQualityFlag>();
  for (const flag of flags) {
    const flagTicker = upper(flag.ticker);
    const flagTable = lower(flag.affected_table);
    const flagPeriod = isoDate(flag.period_end);
    if (!flagTicker || !flagTable || !flagPeriod || !lower(flag.metric)) continue;
    const overlaps = rows.some((row) => {
      if (upper(row.ticker) !== flagTicker) return false;
      const rowPeriod = flagTable === "market_data"
        ? isoDate(row.market_date || row.date)
        : isoDate(row.period_end);
      if (!rowPeriod || rowPeriod !== flagPeriod) return false;
      const flagSection = lower(flag.section);
      if (flagSection && lower(row.section) !== flagSection) return false;
      const flagDuration = upper(flag.period_duration);
      const rowDuration = upper(row.period_duration);
      if (flagDuration && rowDuration !== "MIXED" && rowDuration !== flagDuration) return false;
      return true;
    });
    if (overlaps) matched.set(flag.flag_id, compactFlag(flag));
  }
  return [...matched.values()];
}

export async function fetchLatestAnnualModelPeriods(
  env: Env,
  ticker: string,
  limit = 5,
): Promise<string[]> {
  const result = await env.DB.prepare(`
    SELECT DISTINCT period_end
    FROM financial_statements
    WHERE ticker = ?
      AND section = 'consolidated'
      AND period_type = 'annual'
      AND statement_type = 'profit_loss'
      AND period_duration = '12M'
      AND canonical_name = 'net_profit'
    ORDER BY period_end DESC
    LIMIT ?
  `).bind(upper(ticker), limit).all();
  return ((result.results || []) as Array<{ period_end?: unknown }>)
    .map((row) => isoDate(row.period_end))
    .filter(Boolean);
}

function parseCaution(flag: DataQualityFlag): DataQualityCaution | null {
  const raw = flag.user_caution_json;
  if (!raw) return null;
  if (typeof raw === "object") return raw as unknown as DataQualityCaution;
  try {
    const parsed = JSON.parse(String(raw)) as DataQualityCaution;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function formatNumber(value: unknown, suffix = ""): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 2 : 3;
    return `${value.toLocaleString("en-US", { maximumFractionDigits: digits })}${suffix}`;
  }
  if (value === null || value === undefined || value === "") return "n/a";
  return `${value}${suffix}`;
}

function calculationLine(caution: DataQualityCaution): string | null {
  const calc = caution.calculation;
  if (!calc) return null;
  const numerator = calc.numerator;
  const denominator = calc.denominator;
  const result = calc.result ?? calc.result_pct;
  const resultSuffix = calc.result_pct !== undefined ? "%" : caution.metric === "pe_ratio" ? "x" : "";
  if (!numerator && !denominator && result === undefined) return null;
  const pieces = [
    numerator ? `${numerator.label || "Numerator"} ${formatNumber(numerator.value)}` : null,
    denominator ? `${denominator.label || "Denominator"} ${formatNumber(denominator.value)}` : null,
    result !== undefined ? `Result ${formatNumber(result, resultSuffix)}` : null,
  ].filter(Boolean);
  return pieces.length > 0 ? pieces.join(" / ") : null;
}

export function extractDataQualityCautions(flags: DataQualityFlag[], max = 6): DataQualityCaution[] {
  const seen = new Set<string>();
  const cautions: DataQualityCaution[] = [];
  for (const flag of flags) {
    const caution = parseCaution(flag);
    if (!caution) continue;
    const key = [
      upper(caution.ticker || flag.ticker),
      lower(caution.metric || flag.metric),
      caution.short_message || flag.message || flag.flag_id,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    cautions.push(caution);
    if (cautions.length >= max) break;
  }
  return cautions;
}

export function formatDataQualityCautionBlock(flags: DataQualityFlag[], max = 4): string {
  const cautions = extractDataQualityCautions(flags, max);
  if (cautions.length === 0) return "";
  const lines = ["---", "", "**Data checks**"];
  for (const caution of cautions) {
    const ticker = upper(caution.ticker);
    const metric = text(caution.metric).replace(/_/g, " ") || "data";
    lines.push(`- **${ticker} ${metric}:** ${caution.short_message || "This retrieved data point has an open QC caution."}`);
    const calc = calculationLine(caution);
    if (calc) lines.push(`  Calculation: ${calc}.`);
  }
  const totalCautions = extractDataQualityCautions(flags, Number.MAX_SAFE_INTEGER).length;
  if (totalCautions > cautions.length) {
    lines.push(`- ${totalCautions - cautions.length} additional data-check caution(s) are attached to this query trace.`);
  }
  return lines.join("\n");
}

export function appendDataQualityCautions(answer: string, flags: DataQualityFlag[]): string {
  const block = formatDataQualityCautionBlock(flags.filter((flag) => !isMarketDataFreshnessFlag(flag)));
  if (!block) return answer;
  return `${answer.trim()}\n\n${block}`;
}

function publicFlag(flag: DataQualityFlag): PublicDataHealthFlag {
  return {
    severity: flag.severity,
    category: flag.category || null,
    affected_table: flag.affected_table || null,
    period_end: flag.period_end || null,
    period_duration: flag.period_duration || null,
    section: flag.section || null,
    metric: flag.metric || null,
    message: flag.message || "This data point has an open quality caution.",
  };
}

export function formatDataQualityWarnings(flags: DataQualityFlag[], max = 8): string {
  if (flags.length === 0) return "";
  const sorted = [...flags].sort((a, b) => {
    const severity = (a.severity === "blocker" ? 0 : 1) - (b.severity === "blocker" ? 0 : 1);
    if (severity !== 0) return severity;
    return `${a.ticker}${a.period_end}${a.metric}`.localeCompare(`${b.ticker}${b.period_end}${b.metric}`);
  });
  const lines = sorted.slice(0, max).map((flag) => {
    const parts = [
      upper(flag.ticker),
      flag.period_end,
      flag.affected_table,
      flag.statement_type,
      flag.metric,
      flag.rule || flag.category,
    ].filter(Boolean);
    const label = parts.join(" / ");
    return `- ${flag.severity.toUpperCase()}: ${label} - ${flag.message || "pipeline QC flagged this data point"}`;
  });
  if (sorted.length > max) lines.push(`- ${sorted.length - max} additional QC flag(s) are attached to this query trace.`);
  return lines.join("\n");
}

export function isMarketDataFreshnessFlag(flag: DataQualityFlag): boolean {
  return [flag.category, flag.rule].some((value) => lower(value) === "stale_psx_market_price");
}

export function formatMarketDataFreshnessNotes(flags: DataQualityFlag[], max = 8): string {
  const freshnessFlags = flags.filter(isMarketDataFreshnessFlag);
  if (freshnessFlags.length === 0) return "";
  const lines = freshnessFlags.slice(0, max).map((flag) => {
    const label = [upper(flag.ticker), flag.period_end].filter(Boolean).join(" / ");
    return `- ${label}: ${flag.message || "The latest market-price observation is older than the rest of the peer set."}`;
  });
  if (freshnessFlags.length > max) lines.push(`- ${freshnessFlags.length - max} additional freshness note(s) are attached to this query trace.`);
  return lines.join("\n");
}

export async function fetchDataQualityFlagsForLanes(env: Env, lanes: LaneExecution[]): Promise<DataQualityFlag[]> {
  const scoped = lanes.filter((lane) =>
    ["financial_statements", "ratios", "market_data"].includes(lane.artifact.table) && lane.structuredRows.length > 0,
  );
  const tickers = [...new Set(scoped.flatMap((lane) => lane.structuredRows.map((row) => upper(row.ticker))).filter(Boolean))];
  if (tickers.length === 0) return [];

  const placeholders = tickers.map(() => "?").join(", ");
  const result = await env.DB.prepare(`
    SELECT ${FLAG_COLUMNS}
    FROM data_quality_flags
    WHERE status = 'open'
      AND ticker IN (${placeholders})
      AND severity IN ('warning', 'blocker')
    ORDER BY CASE severity WHEN 'blocker' THEN 0 ELSE 1 END, ticker, period_end, metric
    LIMIT 500
  `).bind(...tickers).all();

  const candidates = (result.results || []) as unknown as DataQualityFlag[];
  const matched = new Map<string, DataQualityFlag>();
  for (const flag of candidates) {
    for (const lane of scoped) {
      if (lane.artifact.table !== lower(flag.affected_table)) continue;
      if (lane.structuredRows.some((row) => flagMatchesRow(flag, lane, row))) {
        matched.set(flag.flag_id, compactFlag(flag));
        break;
      }
    }
  }
  return [...matched.values()];
}

export async function buildDataQualityMatrix(env: Env, limitPeriods = 12): Promise<DataQualityMatrix> {
  const periodLimit = Math.max(1, Math.min(24, limitPeriods));
  const periodsResult = await env.DB.prepare(`
    SELECT period_end
    FROM (
      SELECT DISTINCT period_end
      FROM financial_statements
      WHERE period_end IS NOT NULL AND period_end != ''
    )
    ORDER BY period_end DESC
    LIMIT ?
  `).bind(periodLimit).all();
  const periods = ((periodsResult.results || []) as Array<{ period_end?: string }>)
    .map((row) => isoDate(row.period_end))
    .filter(Boolean);

  const tickerResult = await env.DB.prepare(`
    SELECT DISTINCT ticker
    FROM financial_statements
    WHERE ticker IS NOT NULL AND ticker != ''
    ORDER BY ticker
  `).all();
  const tickers = ((tickerResult.results || []) as Array<{ ticker?: string }>)
    .map((row) => upper(row.ticker))
    .filter(Boolean);

  const flagsResult = await env.DB.prepare(`
    SELECT ${FLAG_COLUMNS}
    FROM data_quality_flags
    WHERE status = 'open'
      AND severity IN ('warning', 'blocker')
    ORDER BY CASE severity WHEN 'blocker' THEN 0 ELSE 1 END, ticker, period_end, metric
  `).all();
  const flags = (flagsResult.results || []) as unknown as DataQualityFlag[];
  const byTickerPeriod = new Map<string, DataQualityFlag[]>();
  const byTicker = new Map<string, DataQualityFlag[]>();
  for (const flag of flags) {
    const ticker = upper(flag.ticker);
    if (!ticker) continue;
    byTicker.set(ticker, [...(byTicker.get(ticker) || []), compactFlag(flag)]);
    const period = isoDate(flag.period_end);
    if (!period) {
      for (const candidatePeriod of periods) {
        const key = `${ticker}|${candidatePeriod}`;
        byTickerPeriod.set(key, [...(byTickerPeriod.get(key) || []), compactFlag(flag)]);
      }
      continue;
    }
    const key = `${ticker}|${period}`;
    byTickerPeriod.set(key, [...(byTickerPeriod.get(key) || []), compactFlag(flag)]);
  }

  let greenCells = 0;
  let yellowCells = 0;
  let redCells = 0;
  const rows = tickers.map((ticker) => {
    let rowStatus: DataQualityMatrixRow["status"] = "green";
    const rowFlags = byTicker.get(ticker) || [];
    const cells = periods.map((period) => {
      const cellFlags = byTickerPeriod.get(`${ticker}|${period}`) || [];
      const status: DataQualityMatrixCell["status"] = cellFlags.some((flag) => flag.severity === "blocker")
        ? "red"
        : cellFlags.length > 0 ? "yellow" : "green";
      if (status === "red") redCells += 1;
      else if (status === "yellow") yellowCells += 1;
      else greenCells += 1;
      if (status === "red") rowStatus = "red";
      else if (status === "yellow" && rowStatus === "green") rowStatus = "yellow";
      return { period_end: period, status, flags: cellFlags };
    });
    if (rowFlags.some((flag) => flag.severity === "blocker")) rowStatus = "red";
    else if (rowFlags.length > 0 && rowStatus === "green") rowStatus = "yellow";
    return { ticker, status: rowStatus, cells, flags: rowFlags };
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    periods,
    rows,
    summary: {
      tickers: rows.length,
      periods: periods.length,
      greenCells,
      yellowCells,
      redCells,
      flagCount: flags.length,
    },
  };
}

export async function buildDataQualityTickerDetail(
  env: Env,
  tickerInput: string,
  limitPeriods = 12,
): Promise<DataQualityTickerDetail> {
  const ticker = upper(tickerInput);
  const periodLimit = Math.max(1, Math.min(24, limitPeriods));
  const periodsResult = await env.DB.prepare(`
    SELECT period_end
    FROM (
      SELECT DISTINCT period_end
      FROM financial_statements
      WHERE ticker = ? AND period_end IS NOT NULL AND period_end != ''
    )
    ORDER BY period_end DESC
    LIMIT ?
  `).bind(ticker, periodLimit).all();
  const periods = ((periodsResult.results || []) as Array<{ period_end?: string }>)
    .map((row) => isoDate(row.period_end))
    .filter(Boolean);

  const flagsResult = await env.DB.prepare(`
    SELECT ${FLAG_COLUMNS}
    FROM data_quality_flags
    WHERE status = 'open'
      AND ticker = ?
      AND severity IN ('warning', 'blocker')
    ORDER BY CASE severity WHEN 'blocker' THEN 0 ELSE 1 END, period_end, affected_table, metric
  `).bind(ticker).all();
  const flags = (flagsResult.results || []) as unknown as DataQualityFlag[];
  const periodsWithFlagOnly = flags
    .map((flag) => isoDate(flag.period_end))
    .filter((period) => period && !periods.includes(period));
  for (const period of periodsWithFlagOnly) {
    if (periods.length >= periodLimit) break;
    periods.push(period);
  }
  periods.sort((a, b) => b.localeCompare(a));

  let greenCells = 0;
  let yellowCells = 0;
  let redCells = 0;
  const cells = periods.map((period) => {
    const cellFlags = flags
      .filter((flag) => {
        const flagPeriod = isoDate(flag.period_end);
        return !flagPeriod || flagPeriod === period;
      })
      .map(compactFlag);
    const status: DataQualityMatrixCell["status"] = cellFlags.some((flag) => flag.severity === "blocker")
      ? "red"
      : cellFlags.length > 0 ? "yellow" : "green";
    if (status === "red") redCells += 1;
    else if (status === "yellow") yellowCells += 1;
    else greenCells += 1;
    return { period_end: period, status, flags: cellFlags };
  });

  const statementResult = await env.DB.prepare(`
    SELECT period_end, statement_type, section, period_duration,
           COUNT(*) AS rows,
           COUNT(DISTINCT source_file) AS source_files
    FROM financial_statements
    WHERE ticker = ?
      AND period_end IN (${periods.length > 0 ? periods.map(() => "?").join(", ") : "''"})
    GROUP BY period_end, statement_type, section, period_duration
    ORDER BY period_end DESC, statement_type, section, period_duration
  `).bind(ticker, ...periods).all();

  const docsResult = await env.DB.prepare(`
    SELECT filing_period, filing_type, filing_year,
           COUNT(*) AS pages,
           MIN(pg) AS first_page,
           MAX(pg) AS last_page
    FROM financial_documents_new
    WHERE ticker = ?
    GROUP BY filing_period, filing_type, filing_year
    ORDER BY filing_period DESC, filing_type
    LIMIT 24
  `).bind(ticker).all();

  const status = redCells > 0 ? "red" : yellowCells > 0 ? "yellow" : "green";
  return {
    ok: true,
    ticker,
    generatedAt: new Date().toISOString(),
    periods,
    cells,
    summary: {
      status,
      greenCells,
      yellowCells,
      redCells,
      flagCount: flags.length,
    },
    statementCoverage: ((statementResult.results || []) as Array<Record<string, unknown>>).map((row) => ({
      period_end: isoDate(row.period_end),
      statement_type: text(row.statement_type),
      section: text(row.section),
      period_duration: text(row.period_duration),
      rows: Number(row.rows) || 0,
      source_files: Number(row.source_files) || 0,
    })),
    documents: ((docsResult.results || []) as Array<Record<string, unknown>>).map((row) => ({
      filing_period: text(row.filing_period),
      filing_type: text(row.filing_type),
      filing_year: text(row.filing_year),
      pages: Number(row.pages) || 0,
      first_page: Number(row.first_page) || 0,
      last_page: Number(row.last_page) || 0,
    })),
  };
}

export async function buildPublicDataHealth(env: Env, limitPeriods = 12): Promise<PublicDataHealth> {
  const matrix = await buildDataQualityMatrix(env, limitPeriods);
  const [
    coverageResult,
    flagsResult,
    statementCorpusResult,
    filingCorpusResult,
    announcementCorpusResult,
    macroCorpusResult,
  ] = await Promise.all([
    env.DB.prepare(`
      SELECT ticker,
             MIN(period_end) AS earliest_period,
             MAX(period_end) AS latest_period,
             COUNT(DISTINCT period_end) AS total_periods
      FROM financial_statements
      WHERE ticker IS NOT NULL AND ticker != ''
        AND period_end IS NOT NULL AND period_end != ''
      GROUP BY ticker
      ORDER BY ticker
    `).all(),
    env.DB.prepare(`
      SELECT ${FLAG_COLUMNS}
      FROM data_quality_flags
      WHERE status = 'open'
        AND severity IN ('warning', 'blocker')
      ORDER BY CASE severity WHEN 'blocker' THEN 0 ELSE 1 END, ticker, period_end, metric
    `).all(),
    env.DB.prepare(`
      SELECT COUNT(*) AS rows,
             COUNT(DISTINCT ticker) AS tickers
      FROM financial_statements
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS rows,
             COUNT(DISTINCT ticker) AS tickers,
             COUNT(DISTINCT ticker || '|' || filing_type || '|' || filing_period) AS docs
      FROM financial_documents_new
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS rows,
             COUNT(DISTINCT ticker) AS tickers
      FROM psx_announcements
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS rows,
             COUNT(DISTINCT source_doc || '|' || chapter) AS docs
      FROM macro_documents
    `).first(),
  ]);

  const coverageByTicker = new Map<string, {
    earliest_period: string | null;
    latest_period: string | null;
    total_periods: number;
  }>();
  for (const row of (coverageResult.results || []) as Array<Record<string, unknown>>) {
    const ticker = upper(row.ticker);
    if (!ticker) continue;
    coverageByTicker.set(ticker, {
      earliest_period: isoDate(row.earliest_period) || null,
      latest_period: isoDate(row.latest_period) || null,
      total_periods: Number(row.total_periods) || 0,
    });
  }

  const flagsByTicker = new Map<string, DataQualityFlag[]>();
  for (const flag of (flagsResult.results || []) as unknown as DataQualityFlag[]) {
    const ticker = upper(flag.ticker);
    if (!ticker) continue;
    flagsByTicker.set(ticker, [...(flagsByTicker.get(ticker) || []), compactFlag(flag)]);
  }

  let greenCells = 0;
  let yellowCells = 0;
  let redCells = 0;
  const rows = [...coverageByTicker.keys()].sort().map((ticker) => {
    const coverage = coverageByTicker.get(ticker)!;
    const flags = flagsByTicker.get(ticker) || [];
    const totalPeriods = coverage.total_periods;
    const tickerWideBlocker = flags.some((flag) => flag.severity === "blocker" && !isoDate(flag.period_end));
    const tickerWideWarning = flags.some((flag) => flag.severity === "warning" && !isoDate(flag.period_end));
    const redPeriodSet = new Set(flags
      .filter((flag) => flag.severity === "blocker" && isoDate(flag.period_end))
      .map((flag) => isoDate(flag.period_end)));
    const yellowPeriodSet = new Set(flags
      .filter((flag) => flag.severity === "warning" && isoDate(flag.period_end))
      .map((flag) => isoDate(flag.period_end)));

    const redPeriods = tickerWideBlocker ? totalPeriods : Math.min(totalPeriods, redPeriodSet.size);
    const yellowPeriods = tickerWideWarning
      ? Math.max(0, totalPeriods - redPeriods)
      : [...yellowPeriodSet].filter((period) => !redPeriodSet.has(period)).length;
    const cleanPeriods = Math.max(0, totalPeriods - redPeriods - yellowPeriods);
    greenCells += cleanPeriods;
    yellowCells += yellowPeriods;
    redCells += redPeriods;

    const cautionMap = new Map<string, PublicDataHealthFlag>();
    for (const flag of flags) {
      const item = publicFlag(flag);
      const key = [
        item.severity,
        item.category,
        item.affected_table,
        item.period_end || "all-periods",
        item.period_duration,
        item.section,
        item.metric,
        item.message,
      ].join("|");
      if (!cautionMap.has(key)) cautionMap.set(key, item);
    }
    const cautions = [...cautionMap.values()].slice(0, 8);
    const status: PublicDataHealthRow["status"] = flags.some((flag) => flag.severity === "blocker")
      ? "red"
      : flags.length > 0 ? "yellow" : "green";
    return {
      ticker,
      status,
      earliest_period: coverage.earliest_period,
      latest_period: coverage.latest_period,
      total_periods: totalPeriods,
      green_periods: cleanPeriods,
      yellow_periods: yellowPeriods,
      red_periods: redPeriods,
      cautions,
    };
  });
  const greenTickers = rows.filter((row) => row.status === "green").length;
  const yellowTickers = rows.filter((row) => row.status === "yellow").length;
  const redTickers = rows.filter((row) => row.status === "red").length;
  const totalTickerPeriods = rows.reduce((sum, row) => sum + row.total_periods, 0);
  const allPeriods = [...coverageByTicker.values()]
    .flatMap((row) => [row.earliest_period, row.latest_period])
    .filter((period): period is string => !!period)
    .sort();
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    corpus: [
      {
        id: "statements",
        label: "Statements",
        cadence: "Quarterly",
        rows: Number(statementCorpusResult?.rows) || 0,
        tickers: Number(statementCorpusResult?.tickers) || 0,
        sourceType: "statement",
        description: "Structured P&L, balance sheet, cash flow, ratios, and market-linked data with row-level source-page provenance.",
      },
      {
        id: "filings",
        label: "Filings",
        cadence: "Quarterly",
        rows: Number(filingCorpusResult?.rows) || 0,
        tickers: Number(filingCorpusResult?.tickers) || 0,
        docs: Number(filingCorpusResult?.docs) || 0,
        sourceType: "filing",
        description: "Annual and quarterly filing pages indexed with BM25 search text, raw markdown, PDF pages, and thumbnails.",
      },
      {
        id: "announcements",
        label: "Announcements",
        cadence: "Event-driven",
        rows: Number(announcementCorpusResult?.rows) || 0,
        tickers: Number(announcementCorpusResult?.tickers) || 0,
        sourceType: "announcement",
        description: "Ticker-specific PSX corporate announcements, notices, board results, material disclosures, and attachment text.",
      },
      {
        id: "macro",
        label: "Macro",
        cadence: "Report-driven",
        rows: Number(macroCorpusResult?.rows) || 0,
        docs: Number(macroCorpusResult?.docs) || 0,
        sourceType: "macro",
        description: "Budget, Economic Survey, and SBP report pages split into table/text markdown with source PDFs and thumbnails.",
      },
    ],
    summary: {
      tickers: rows.length,
      recentPeriodsShown: matrix.periods.length,
      totalTickerPeriods,
      earliestPeriod: allPeriods[0] || null,
      latestPeriod: allPeriods[allPeriods.length - 1] || null,
      greenCells,
      yellowCells,
      redCells,
      flagCount: flagsByTicker.size === 0
        ? 0
        : [...flagsByTicker.values()].reduce((sum, flags) => sum + flags.length, 0),
      greenTickers,
      yellowTickers,
      redTickers,
    },
    method: [
      "Source pages are matched back to the filing pages used in the corpus.",
      "Statement arithmetic is checked so subtotals, balance sheets, and cash-flow movements reconcile.",
      "Units, period alignment, and derived ratios are audited before rows are treated as clean.",
      "Warnings are scoped to the affected ticker, period, table, and metric where possible.",
    ],
    periods: matrix.periods,
    rows,
  };
}
