import type { D1Database } from "@cloudflare/workers-types";
import TICKERS_JSON from "../tickers100_full.json";
import { fetchLatestPrice, fetchPrices, fetchShares } from "./psx";

// ─────────────────────────────────────────────────────────────────────────────
// Memory Sync - LLM-based extraction from user queries
// ─────────────────────────────────────────────────────────────────────────────

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

interface ExtractedMemory {
  content: string;
  first_name?: string;
}

interface MemorySyncOptions {
  retentionDays?: number;
}

interface MemorySyncResult {
  users: number;
  memories: number;
  cleared: number;
  pruned: number;
  errors: string[];
}

const MAX_QUERIES_PER_USER = 20;
const MAX_INFERRED_MEMORIES_PER_USER = 5;
const DEFAULT_MEMORY_RETENTION_DAYS = 90;

function sanitizeMemoryForStorage(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.replace(/\u0000/g, "").replace(/\r/g, "").trim();
  if (!s) return null;

  // Prevent markdown code-fence injection into downstream prompts.
  s = s.replace(/```+/g, "").replace(/~~~+/g, "");

  // Store as a single line sentence.
  s = s.replace(/\s+/g, " ").trim();

  return s || null;
}

export async function syncMemories(
  db: D1Database,
  deepseekApiKey: string,
  options: MemorySyncOptions = {},
): Promise<MemorySyncResult> {
  const errors: string[] = [];
  let totalMemories = 0;
  let totalCleared = 0;

  // 1. Get users with queries in the last 14 days
  const usersResult = await db
    .prepare(
      `WITH recent AS (
         SELECT
           user_id,
           user_email,
           query,
           created_at,
           COUNT(*) OVER (PARTITION BY user_id) AS recent_count,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
         FROM query_logs
         WHERE created_at > datetime('now', '-14 days')
           AND user_id IS NOT NULL
       )
       SELECT user_id, MAX(user_email) AS user_email, GROUP_CONCAT(query, '|||') AS queries
       FROM (
         SELECT user_id, user_email, query, created_at
         FROM recent
         WHERE recent_count >= 2
           AND rn <= ?
         ORDER BY user_id, created_at DESC
       )
       GROUP BY user_id`
    )
    .bind(MAX_QUERIES_PER_USER)
    .all();

  const users = usersResult.results as Array<{
    user_id: string;
    user_email: string;
    queries: string;
  }>;

  console.log(`[Memory] Processing ${users.length} users with recent queries`);

  // 2. For each user, extract memories via LLM
  for (const user of users) {
    try {
      const queries = user.queries.split("|||").slice(0, MAX_QUERIES_PER_USER);

      // Check if manual memory exists with a preferred first_name
      const manualMemory = await db
        .prepare(
          `SELECT first_name FROM user_memories WHERE user_id = ? AND source = 'manual' LIMIT 1`
        )
        .bind(user.user_id)
        .first() as { first_name: string } | null;

      // Use manual first_name if exists, otherwise extract from email
      let capitalizedName: string;
      if (manualMemory?.first_name) {
        capitalizedName = manualMemory.first_name;
      } else {
        const emailName = user.user_email.split("@")[0];
        const firstName = emailName.split(/[._]/)[0];
        capitalizedName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
      }

      const memories = await extractMemoriesFromQueries(
        queries,
        capitalizedName,
        deepseekApiKey
      );

      // 3. Clear old inferred memories even when the fresh extraction is empty.
      const deleteResult = await db
        .prepare(`DELETE FROM user_memories WHERE user_id = ? AND source = 'inferred'`)
        .bind(user.user_id)
        .run();
      totalCleared += deleteResult.meta.changes || 0;

      for (const memory of memories) {
        await db
          .prepare(
            `INSERT INTO user_memories (id, user_id, content, first_name, source)
             VALUES (?, ?, ?, ?, 'inferred')`
          )
          .bind(
            crypto.randomUUID(),
            user.user_id,
            memory.content,
            memory.first_name || capitalizedName
          )
          .run();
        totalMemories++;
      }

      console.log(`[Memory] ${user.user_email}: ${memories.length} memories`);
    } catch (error) {
      errors.push(`${user.user_email}: ${error}`);
    }

    // Small delay between users
    await new Promise((r) => setTimeout(r, 100));
  }

  const retentionDays = normalizeRetentionDays(options.retentionDays);
  const pruned = await pruneStaleInferredMemories(db, retentionDays);

  console.log(
    `[Memory] Sync complete: ${users.length} users, ${totalMemories} memories, ${totalCleared} cleared, ${pruned} pruned`
  );

  return { users: users.length, memories: totalMemories, cleared: totalCleared, pruned, errors };
}

async function extractMemoriesFromQueries(
  queries: string[],
  firstName: string,
  apiKey: string
): Promise<ExtractedMemory[]> {
  const prompt = `Analyze these user queries from a Pakistan Stock Exchange (PSX) research assistant and extract 2-5 key memories about the user's interests and preferences.

User's queries:
${queries.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Extract specific, actionable memories like:
- Which sectors/industries they follow (cement, banking, power, etc.)
- Which specific companies they're interested in (use ticker symbols like HBL, LUCK, OGDC)
- What type of analysis they prefer (EPS projections, valuations, M&A, ratios)
- Their investment style if apparent (value investing, growth, dividends)

Return ONLY a JSON array of memory strings. Each memory should be a single sentence.
Example: ["Interested in cement sector, especially LUCK and DGKC", "Prefers detailed EPS projections with scenario analysis"]

Return empty array [] if queries are too generic or just greetings.`;

  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices[0]?.message?.content || "[]";

  // Parse JSON from response (handle markdown code blocks)
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const memories = JSON.parse(jsonMatch[0]) as string[];
    const seen = new Set<string>();
    return memories
      .map((m) => sanitizeMemoryForStorage(m))
      .filter((m): m is string => Boolean(m))
      .filter((memory) => {
        const key = memory.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_INFERRED_MEMORIES_PER_USER)
      .map((content) => ({ content, first_name: firstName }));
  } catch {
    return [];
  }
}

function normalizeRetentionDays(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 14) return DEFAULT_MEMORY_RETENTION_DAYS;
  return Math.min(Math.floor(value), 365);
}

async function pruneStaleInferredMemories(db: D1Database, retentionDays: number): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM user_memories
       WHERE source = 'inferred'
         AND created_at < datetime('now', '-' || ? || ' days')`
    )
    .bind(retentionDays)
    .run();
  return result.meta.changes || 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Data Sync - PSX primitives plus derived metrics from D1 fundamentals
// ─────────────────────────────────────────────────────────────────────────────

interface Ticker {
  Symbol: string;
  "Company Name": string;
  Industry: string;
  fiscal_period: string;
}

const TICKERS = (TICKERS_JSON as Ticker[]).map((ticker) => ticker.Symbol);
export const TOTAL_MARKET_BATCHES = 24;
const MARKET_BATCH_SIZE = Math.ceil(TICKERS.length / TOTAL_MARKET_BATCHES);

const MARKET_DATA_DERIVED_COLUMNS = [
  ["pe_ratio", "REAL"],
  ["pb_ratio", "REAL"],
  ["dividend_yield", "REAL"],
  ["enterprise_value", "REAL"],
  ["fundamentals_period_end", "TEXT"],
  ["pe_earnings_section", "TEXT"],
  ["pe_earnings_basis", "TEXT"],
  ["pe_earnings_period_duration", "TEXT"],
] as const;

function getTickerBatch(batch?: number): string[] {
  if (batch === undefined) return TICKERS;
  return TICKERS.slice(batch * MARKET_BATCH_SIZE, (batch + 1) * MARKET_BATCH_SIZE);
}

async function listTableColumns(db: D1Database, tableName: string): Promise<Set<string>> {
  const result = await db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
  return new Set((result.results ?? []).map((row) => String(row.name)));
}

export async function ensureMarketSchema(db: D1Database): Promise<void> {
  const marketDataColumns = await listTableColumns(db, "market_data");
  for (const [columnName, columnType] of MARKET_DATA_DERIVED_COLUMNS) {
    if (!marketDataColumns.has(columnName)) {
      await db.prepare(`ALTER TABLE market_data ADD COLUMN ${columnName} ${columnType}`).run();
    }
  }
}

async function get52Week(
  db: D1Database,
  ticker: string,
  asOfDate: string
): Promise<{ high: number | null; low: number | null }> {
  const row = await db.prepare(`
    SELECT MAX(closing_price) as high, MIN(closing_price) as low
    FROM market_data
    WHERE ticker = ? AND date >= date(?, '-1 year') AND date <= ?
  `).bind(ticker, asOfDate, asOfDate).first<{ high: number | null; low: number | null }>();
  return { high: row?.high ?? null, low: row?.low ?? null };
}

export interface SyncResult {
  updated: number;
  info: string;
  errors: string[];
  batch?: number;
  totalBatches: number;
  diagnostics: {
    reasonCounts: Record<string, number>;
    latestDateHistogram: Array<{ date: string; count: number }>;
    maxFetchedDate: string | null;
    minFetchedDate: string | null;
    usedSharesFallback: number;
  };
}

async function getLastKnownShares(db: D1Database, ticker: string): Promise<number | null> {
  const row = await db.prepare(
    `SELECT total_shares
     FROM market_data
     WHERE ticker = ? AND total_shares IS NOT NULL
     ORDER BY date DESC
     LIMIT 1`
  ).bind(ticker).first<{ total_shares: number | null }>();
  const value = Number(row?.total_shares ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

export async function syncMarketData(
  db: D1Database,
  force = false,
  batch?: number,
  symbols?: string[]
): Promise<SyncResult> {
  await ensureMarketSchema(db);

  const errors: string[] = [];
  const reasonCounts = new Map<string, number>();
  const dateCounts = new Map<string, number>();
  let updated = 0;
  let usedSharesFallback = 0;
  let maxFetchedDate: string | null = null;
  let minFetchedDate: string | null = null;

  const bump = (reason: string): void => {
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  };

  const now = new Date();
  const todayIso = now.toISOString().split("T")[0];
  const day = now.getUTCDay();
  if (!force && (day === 0 || day === 6)) {
    bump("weekend_skip");
    return {
      updated: 0,
      info: "Weekend: skipping",
      errors,
      totalBatches: TOTAL_MARKET_BATCHES,
      diagnostics: {
        reasonCounts: Object.fromEntries(reasonCounts),
        latestDateHistogram: [],
        maxFetchedDate,
        minFetchedDate,
        usedSharesFallback,
      },
    };
  }

  const tickers = symbols && symbols.length > 0 ? symbols : getTickerBatch(batch);
  const batchLabel =
    batch !== undefined
      ? ` (batch ${batch}/${TOTAL_MARKET_BATCHES - 1}, ${tickers.length} tickers)`
      : ` (all ${tickers.length} tickers)`;

  console.log(`[sync] Starting${batchLabel}`);

  for (const ticker of tickers) {
    try {
      const latest = await fetchLatestPrice(ticker);
      if (!latest) {
        bump("no_price");
        errors.push(`${ticker}: no price`);
        continue;
      }

      dateCounts.set(latest.date, (dateCounts.get(latest.date) || 0) + 1);
      if (!maxFetchedDate || latest.date > maxFetchedDate) maxFetchedDate = latest.date;
      if (!minFetchedDate || latest.date < minFetchedDate) minFetchedDate = latest.date;

      let shares = await fetchShares(ticker);
      if (!shares) {
        shares = await getLastKnownShares(db, ticker);
        if (shares) {
          usedSharesFallback += 1;
          bump("shares_fallback_used");
        } else {
          bump("no_shares");
          errors.push(`${ticker}: no shares`);
          continue;
        }
      }

      const marketCap = latest.close * shares;
      const week52 = await get52Week(db, ticker, latest.date);
      const week52High = week52.high !== null ? Math.max(week52.high, latest.close) : latest.close;
      const week52Low = week52.low !== null ? Math.min(week52.low, latest.close) : latest.close;

      await db.prepare(`
        INSERT INTO market_data (
          ticker,
          date,
          closing_price,
          total_shares,
          market_cap,
          week_52_high,
          week_52_low
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ticker, date) DO UPDATE SET
          closing_price = excluded.closing_price,
          total_shares = excluded.total_shares,
          market_cap = excluded.market_cap,
          week_52_high = excluded.week_52_high,
          week_52_low = excluded.week_52_low
      `).bind(ticker, latest.date, latest.close, shares, marketCap, week52High, week52Low).run();

      updated += 1;
      console.log(
        `[sync] ${ticker}: ${latest.close} x ${shares.toLocaleString()} = ${(marketCap / 1e9).toFixed(1)}B`
      );
    } catch (error) {
      bump("symbol_exception");
      errors.push(`${ticker}: ${error}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (maxFetchedDate && maxFetchedDate < todayIso) bump("latest_price_stale_vs_today");

  const latestDateHistogram = [...dateCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([date, count]) => ({ date, count }));

  const diagnostics = {
    reasonCounts: Object.fromEntries([...reasonCounts.entries()].sort((a, b) => b[1] - a[1])),
    latestDateHistogram,
    maxFetchedDate,
    minFetchedDate,
    usedSharesFallback,
  };

  const info = `Synced ${updated}/${tickers.length} tickers${batchLabel}`;
  console.log(`[sync] ${info}` + (errors.length ? `, ${errors.length} errors` : ""));
  console.log("[sync] Diagnostics:", diagnostics);
  return { updated, info, errors, batch, totalBatches: TOTAL_MARKET_BATCHES, diagnostics };
}

export interface DerivedRefreshResult {
  updated: number;
  symbols: number;
  errors: string[];
}

type RefreshMode = "latest" | "all";

interface MarketRow {
  ticker: string;
  date: string;
  market_cap: number | null;
}

interface FundamentalPoint {
  period_end: string;
  value: number;
}

interface FlowPoint extends FundamentalPoint {
  basis: "LTM" | "12M";
}

interface EarningsPoint extends FlowPoint {
  canonical_name: "net_profit_parent" | "net_profit";
}

interface DerivedValues {
  peRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
  enterpriseValue: number | null;
  fundamentalsPeriodEnd: string | null;
  peEarningsSection: string | null;
  peEarningsBasis: string | null;
  peEarningsPeriodDuration: string | null;
}

async function resolveSection(db: D1Database, ticker: string): Promise<string | null> {
  const rows = await db.prepare(`
    SELECT DISTINCT section
    FROM financial_statements
    WHERE ticker = ?
      AND section IN ('consolidated', 'unconsolidated')
  `).bind(ticker).all<{ section: string }>();
  const sections = new Set((rows.results ?? []).map((row) => row.section));
  if (sections.has("consolidated")) return "consolidated";
  if (sections.has("unconsolidated")) return "unconsolidated";
  return null;
}

async function getIndustry(db: D1Database, ticker: string): Promise<string | null> {
  const row = await db.prepare(`
    SELECT industry
    FROM financial_statements
    WHERE ticker = ?
      AND industry IS NOT NULL
      AND industry != ''
    LIMIT 1
  `).bind(ticker).first<{ industry: string | null }>();
  return row?.industry ?? null;
}

function collapseFlowRows(
  rows: Array<{ period_end: string; period_duration: string; value: number | null }>
): FlowPoint[] {
  const byPeriod = new Map<string, FlowPoint>();
  for (const row of rows) {
    if (row.value === null || row.value === undefined) continue;
    const basis = row.period_duration === "LTM" ? "LTM" : "12M";
    const existing = byPeriod.get(row.period_end);
    if (!existing || (basis === "LTM" && existing.basis === "12M")) {
      byPeriod.set(row.period_end, {
        period_end: row.period_end,
        value: Number(row.value),
        basis,
      });
    }
  }
  return [...byPeriod.values()].sort((a, b) => a.period_end.localeCompare(b.period_end));
}

function earningsRank(row: EarningsPoint): number {
  const parentRank = row.canonical_name === "net_profit_parent" ? 10 : 0;
  const basisRank = row.basis === "LTM" ? 2 : 1;
  const positiveRank = row.value > 0 ? 1 : 0;
  return parentRank + basisRank + positiveRank;
}

function collapseEarningsRows(
  rows: Array<{
    period_end: string;
    period_duration: string;
    canonical_name: "net_profit_parent" | "net_profit";
    value: number | null;
  }>
): EarningsPoint[] {
  const byPeriod = new Map<string, EarningsPoint>();
  for (const row of rows) {
    if (row.value === null || row.value === undefined) continue;
    const current: EarningsPoint = {
      period_end: row.period_end,
      value: Number(row.value),
      basis: row.period_duration === "LTM" ? "LTM" : "12M",
      canonical_name: row.canonical_name,
    };
    const existing = byPeriod.get(row.period_end);
    if (!existing || earningsRank(current) > earningsRank(existing)) {
      byPeriod.set(row.period_end, current);
    }
  }
  return [...byPeriod.values()].sort((a, b) => a.period_end.localeCompare(b.period_end));
}

async function loadFlowSeries(
  db: D1Database,
  ticker: string,
  section: string,
  statementType: "profit_loss" | "cash_flow",
  canonicalName: string
): Promise<FlowPoint[]> {
  const rows = await db.prepare(`
    SELECT period_end, period_duration, value
    FROM financial_statements
    WHERE ticker = ?
      AND section = ?
      AND statement_type = ?
      AND canonical_name = ?
      AND period_duration IN ('LTM', '12M')
    ORDER BY period_end
  `).bind(ticker, section, statementType, canonicalName).all<{
    period_end: string;
    period_duration: string;
    value: number | null;
  }>();
  return collapseFlowRows(rows.results ?? []);
}

async function loadEarningsSeries(
  db: D1Database,
  ticker: string,
  section: string
): Promise<EarningsPoint[]> {
  const rows = await db.prepare(`
    SELECT period_end, period_duration, canonical_name, value
    FROM financial_statements
    WHERE ticker = ?
      AND section = ?
      AND statement_type = 'profit_loss'
      AND canonical_name IN ('net_profit_parent', 'net_profit')
      AND period_duration IN ('LTM', '12M')
    ORDER BY period_end
  `).bind(ticker, section).all<{
    period_end: string;
    period_duration: string;
    canonical_name: "net_profit_parent" | "net_profit";
    value: number | null;
  }>();
  return collapseEarningsRows(rows.results ?? []);
}

async function loadPointSeries(
  db: D1Database,
  ticker: string,
  section: string,
  canonicalName: string
): Promise<FundamentalPoint[]> {
  const rows = await db.prepare(`
    SELECT period_end, value
    FROM financial_statements
    WHERE ticker = ?
      AND section = ?
      AND statement_type = 'balance_sheet'
      AND canonical_name = ?
      AND period_duration = 'PIT'
      AND value IS NOT NULL
    ORDER BY period_end
  `).bind(ticker, section, canonicalName).all<{ period_end: string; value: number }>();
  return (rows.results ?? []).map((row) => ({
    period_end: row.period_end,
    value: Number(row.value),
  }));
}

async function loadDebtSeries(
  db: D1Database,
  ticker: string,
  section: string
): Promise<FundamentalPoint[]> {
  const rows = await db.prepare(`
    SELECT period_end, SUM(value) AS value
    FROM financial_statements
    WHERE ticker = ?
      AND section = ?
      AND statement_type = 'balance_sheet'
      AND canonical_name IN ('short_term_debt', 'long_term_debt', 'borrowings')
      AND period_duration = 'PIT'
      AND value IS NOT NULL
    GROUP BY period_end
    ORDER BY period_end
  `).bind(ticker, section).all<{ period_end: string; value: number | null }>();
  return (rows.results ?? [])
    .filter((row) => row.value !== null && row.value !== undefined)
    .map((row) => ({
      period_end: row.period_end,
      value: Number(row.value),
    }));
}

async function loadMarketRows(
  db: D1Database,
  ticker: string,
  mode: RefreshMode
): Promise<MarketRow[]> {
  const sql = mode === "latest"
    ? `
      SELECT ticker, date, market_cap
      FROM market_data
      WHERE ticker = ?
      ORDER BY date DESC
      LIMIT 1
    `
    : `
      SELECT ticker, date, market_cap
      FROM market_data
      WHERE ticker = ?
      ORDER BY date
    `;
  const rows = await db.prepare(sql).bind(ticker).all<MarketRow>();
  const results = rows.results ?? [];
  return mode === "latest" ? results.reverse() : results;
}

function latestAsOf<T extends { period_end: string }>(
  series: T[],
  asOfDate: string,
  startIndex: number
): { item: T | null; index: number } {
  let index = startIndex;
  while (index + 1 < series.length && series[index + 1].period_end <= asOfDate) {
    index += 1;
  }
  const item = index >= 0 && series[index]?.period_end <= asOfDate ? series[index] : null;
  return { item, index };
}

function computeDerivedRow(
  marketRow: MarketRow,
  industry: string | null,
  section: string,
  earnings: EarningsPoint | null,
  dividends: FlowPoint | null,
  equity: FundamentalPoint | null,
  cash: FundamentalPoint | null,
  debt: FundamentalPoint | null
): DerivedValues {
  const marketCap = Number(marketRow.market_cap ?? 0);

  const peRatio =
    marketCap > 0 && earnings && earnings.value > 0
      ? marketCap / (earnings.value * 1000)
      : null;

  const pbRatio =
    marketCap > 0 && equity && equity.value > 0
      ? marketCap / (equity.value * 1000)
      : null;

  const dividendYield =
    marketCap > 0 && dividends
      ? (Math.abs(dividends.value) * 1000 / marketCap) * 100
      : null;

  const enterpriseValue =
    industry && !["Banking", "Insurance"].includes(industry) && marketCap > 0
      ? marketCap + ((debt?.value ?? 0) - (cash?.value ?? 0)) * 1000
      : null;

  return {
    peRatio,
    pbRatio,
    dividendYield,
    enterpriseValue,
    fundamentalsPeriodEnd: earnings?.period_end ?? equity?.period_end ?? null,
    peEarningsSection: earnings ? section : null,
    peEarningsBasis: earnings?.canonical_name ?? null,
    peEarningsPeriodDuration: earnings?.basis ?? null,
  };
}

async function applyDerivedUpdates(
  db: D1Database,
  updates: Array<DerivedValues & { ticker: string; date: string }>
): Promise<number> {
  const batchSize = 200;
  let changed = 0;
  for (let i = 0; i < updates.length; i += batchSize) {
    const slice = updates.slice(i, i + batchSize);
    const statements = slice.map((row) =>
      db.prepare(`
        UPDATE market_data
        SET
          pe_ratio = ?,
          pb_ratio = ?,
          dividend_yield = ?,
          enterprise_value = ?,
          fundamentals_period_end = ?,
          pe_earnings_section = ?,
          pe_earnings_basis = ?,
          pe_earnings_period_duration = ?
        WHERE ticker = ? AND date = ?
      `).bind(
        row.peRatio,
        row.pbRatio,
        row.dividendYield,
        row.enterpriseValue,
        row.fundamentalsPeriodEnd,
        row.peEarningsSection,
        row.peEarningsBasis,
        row.peEarningsPeriodDuration,
        row.ticker,
        row.date
      )
    );
    const results = await db.batch(statements);
    changed += results.reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0);
  }
  return changed;
}

export async function refreshDerivedMarketData(
  db: D1Database,
  symbols?: string[],
  mode: RefreshMode = "all"
): Promise<DerivedRefreshResult> {
  await ensureMarketSchema(db);

  const tickerList = symbols && symbols.length > 0 ? symbols : TICKERS;
  const errors: string[] = [];
  let updated = 0;

  for (const ticker of tickerList) {
    try {
      const section = await resolveSection(db, ticker);
      if (!section) {
        errors.push(`${ticker}: no consolidated/unconsolidated section found`);
        continue;
      }

      const [industry, marketRows, earningsSeries, dividendSeries, equitySeries, cashSeries, debtSeries] =
        await Promise.all([
          getIndustry(db, ticker),
          loadMarketRows(db, ticker, mode),
          loadEarningsSeries(db, ticker, section),
          loadFlowSeries(db, ticker, section, "cash_flow", "dividends_paid"),
          loadPointSeries(db, ticker, section, "total_equity"),
          loadPointSeries(db, ticker, section, "cash_and_equivalents"),
          loadDebtSeries(db, ticker, section),
        ]);

      if (marketRows.length === 0) continue;

      let earningsIndex = -1;
      let dividendIndex = -1;
      let equityIndex = -1;
      let cashIndex = -1;
      let debtIndex = -1;

      const updates = marketRows.map((marketRow) => {
        const earningsState = latestAsOf(earningsSeries, marketRow.date, earningsIndex);
        earningsIndex = earningsState.index;

        const dividendState = latestAsOf(dividendSeries, marketRow.date, dividendIndex);
        dividendIndex = dividendState.index;

        const equityState = latestAsOf(equitySeries, marketRow.date, equityIndex);
        equityIndex = equityState.index;

        const cashState = latestAsOf(cashSeries, marketRow.date, cashIndex);
        cashIndex = cashState.index;

        const debtState = latestAsOf(debtSeries, marketRow.date, debtIndex);
        debtIndex = debtState.index;

        return {
          ticker,
          date: marketRow.date,
          ...computeDerivedRow(
            marketRow,
            industry,
            section,
            earningsState.item,
            dividendState.item,
            equityState.item,
            cashState.item,
            debtState.item
          ),
        };
      });

      updated += await applyDerivedUpdates(db, updates);
    } catch (error) {
      errors.push(`${ticker}: ${error}`);
    }
  }

  return { updated, symbols: tickerList.length, errors };
}

export interface BackfillResult {
  totalInserted: number;
  tickers: number;
  details: string[];
  errors: string[];
}

export async function backfillPrices(
  db: D1Database,
  symbols?: string[]
): Promise<BackfillResult> {
  await ensureMarketSchema(db);

  const tickerList = symbols && symbols.length > 0 ? symbols : TICKERS;
  const details: string[] = [];
  const errors: string[] = [];
  let totalInserted = 0;

  for (const ticker of tickerList) {
    try {
      const shares = await fetchShares(ticker);
      if (!shares) {
        errors.push(`${ticker}: no shares`);
        continue;
      }

      const prices = await fetchPrices(ticker);
      if (prices.length === 0) {
        errors.push(`${ticker}: no prices`);
        continue;
      }

      let inserted = 0;
      for (const price of prices) {
        const marketCap = price.close * shares;
        await db.prepare(`
          INSERT INTO market_data (ticker, date, closing_price, total_shares, market_cap)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(ticker, date) DO UPDATE SET
            closing_price = excluded.closing_price,
            total_shares = excluded.total_shares,
            market_cap = excluded.market_cap
        `).bind(ticker, price.date, price.close, shares, marketCap).run();
        inserted += 1;
      }

      totalInserted += inserted;
      details.push(`${ticker}: ${inserted} days`);
      console.log(`[backfill] ${ticker}: ${inserted} days`);

      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      errors.push(`${ticker}: ${error}`);
    }
  }

  return { totalInserted, tickers: tickerList.length, details, errors };
}

export async function recalc52Week(
  db: D1Database,
  symbols?: string[]
): Promise<{ updated: number; errors: string[] }> {
  await ensureMarketSchema(db);

  const tickerList = symbols && symbols.length > 0 ? symbols : TICKERS;
  const errors: string[] = [];
  let updated = 0;

  for (const ticker of tickerList) {
    try {
      const rows = await db.prepare(`
        SELECT date, closing_price FROM market_data
        WHERE ticker = ? ORDER BY date
      `).bind(ticker).all<{ date: string; closing_price: number }>();

      const data = rows.results ?? [];
      if (data.length === 0) continue;

      for (let i = 0; i < data.length; i += 1) {
        const currentDate = data[i].date;
        const oneYearAgo = new Date(currentDate);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const cutoff = oneYearAgo.toISOString().split("T")[0];

        let windowStart = i;
        while (windowStart > 0 && data[windowStart - 1].date >= cutoff) {
          windowStart -= 1;
        }

        let high = data[i].closing_price;
        let low = data[i].closing_price;
        for (let j = windowStart; j <= i; j += 1) {
          if (data[j].closing_price > high) high = data[j].closing_price;
          if (data[j].closing_price < low) low = data[j].closing_price;
        }

        await db.prepare(`
          UPDATE market_data SET week_52_high = ?, week_52_low = ?
          WHERE ticker = ? AND date = ?
        `).bind(high, low, ticker, currentDate).run();
        updated += 1;
      }

      console.log(`[52week] ${ticker}: ${data.length} rows updated`);
    } catch (error) {
      errors.push(`${ticker}: ${error}`);
    }
  }

  return { updated, errors };
}
