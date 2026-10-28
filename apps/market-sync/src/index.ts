import { Hono } from "hono";
import {
  backfillPrices,
  ensureMarketSchema,
  recalc52Week,
  refreshDerivedMarketData,
  syncMarketData,
  syncMemories,
  TOTAL_MARKET_BATCHES,
} from "./sync";
import TICKERS_JSON from "../tickers100_full.json";

type Env = {
  DB: D1Database;
  DEEPSEEK_API_KEY: string;
  ADMIN_TOKEN?: string;
  MEMORY_RETENTION_DAYS?: string;
};

const app = new Hono<{ Bindings: Env }>();
const DEFAULT_TICKERS = TICKERS_JSON.map((ticker: { Symbol: string }) => ticker.Symbol);
const MARKET_BATCH_COUNT = TOTAL_MARKET_BATCHES;
const MARKET_BATCH_SIZE = Math.ceil(DEFAULT_TICKERS.length / MARKET_BATCH_COUNT);
const SCHEDULE_START_UTC_HOUR = 18;
const SCHEDULE_INTERVAL_MINUTES = 5;

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isAuthorized(request: Request, adminToken?: string): boolean {
  if (!adminToken) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  return Boolean(token) && timingSafeEqualString(token, adminToken);
}

function requireAdmin(c: { req: { raw: Request }; env: Env; json: (data: unknown, status?: number) => Response }) {
  if (!c.env.ADMIN_TOKEN) {
    return c.json({ error: "ADMIN_TOKEN not configured" }, 503);
  }
  if (!isAuthorized(c.req.raw, c.env.ADMIN_TOKEN)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
}

// Health check
app.get("/", (c) => {
  return c.json({
    service: "psxgpt-market-sync",
    status: "healthy",
    source: "dps.psx.com.pk",
    endpoints: {
      "/": "Health check",
      "/sync": `Manual PSX market sync trigger (POST, admin token required, ?batch=0-${MARKET_BATCH_COUNT - 1} or ?symbols=ABL,HBL)`,
      "/sync-memories": "Manual memory extraction trigger (POST, admin token required)",
      "/status": "Last sync status",
      "/valuation": "Latest derived market snapshot",
      "/history/:symbol": "Market data history for a symbol",
      "/ratios": "Historical ratios lookup",
      "/refresh-derived": "Recompute market_data derived fields (POST, admin token required)",
      "/backfill": "Historical PSX price backfill (POST, admin token required)",
      "/backfill-52week": "Recalculate 52-week high/low (POST, admin token required)",
    },
  });
});

// Manual sync trigger (for testing) - always forces sync
// Optional: POST /sync?batch=0 to sync the first cron-sized batch.
// Or POST /sync to sync all (may timeout)
app.post("/sync", async (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;

  const batchParam = c.req.query("batch");
  const batch = batchParam !== undefined ? parseInt(batchParam, 10) : undefined;
  const symbolsParam = c.req.query("symbols");
  const symbols = symbolsParam
    ? symbolsParam.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
    : batch !== undefined
    ? DEFAULT_TICKERS.slice(batch * MARKET_BATCH_SIZE, (batch + 1) * MARKET_BATCH_SIZE)
    : undefined;

  const syncResult = await syncMarketData(c.env.DB, true, batch, symbols);
  const derivedResult = await refreshDerivedMarketData(c.env.DB, symbols, "latest");
  return c.json({
    success: syncResult.errors.length === 0 && derivedResult.errors.length === 0,
    sync: syncResult,
    derived: derivedResult,
  });
});

// Manual memory extraction trigger
app.post("/sync-memories", async (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;

  if (!c.env.DEEPSEEK_API_KEY) {
    return c.json({ error: "DEEPSEEK_API_KEY not configured" }, 500);
  }
  const retentionDays = parseInt(c.env.MEMORY_RETENTION_DAYS || "90", 10);
  const result = await syncMemories(c.env.DB, c.env.DEEPSEEK_API_KEY, {
    retentionDays: Number.isFinite(retentionDays) ? retentionDays : 90,
  });
  return c.json({
    success: result.errors.length === 0,
    users: result.users,
    memories: result.memories,
    cleared: result.cleared,
    pruned: result.pruned,
    errors: result.errors,
  });
});

// Get last sync status
app.get("/status", async (c) => {
  try {
    await ensureMarketSchema(c.env.DB);

    const latestMarketData = await c.env.DB.prepare(
      `SELECT date, COUNT(*) as count FROM market_data GROUP BY date ORDER BY date DESC LIMIT 1`
    ).first();

    const marketDataCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM market_data`
    ).first();

    // Get unique symbols count
    const symbolsCount = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT ticker) as count FROM market_data`
    ).first();

    const latestSnapshot = await c.env.DB.prepare(
      `WITH latest AS (
         SELECT ticker, MAX(date) AS date
         FROM market_data
         GROUP BY ticker
       )
       SELECT COUNT(*) AS count
       FROM market_data m
       JOIN latest l ON l.ticker = m.ticker AND l.date = m.date`
    ).first<{ count: number }>();

    const ratiosCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM ratios`
    ).first();

    return c.json({
      tables: {
        market_data: marketDataCount?.count || 0,
        unique_symbols: symbolsCount?.count || 0,
        ratios: ratiosCount?.count || 0,
      },
      latest_snapshot: { rows: latestSnapshot?.count || 0 },
      latest: {
        marketData: latestMarketData,
      },
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

app.get("/valuation", async (c) => {
  await ensureMarketSchema(c.env.DB);
  const ticker = c.req.query("ticker")?.toUpperCase() ?? c.req.query("symbol")?.toUpperCase();
  const sql = `
    WITH latest AS (
      SELECT ticker, MAX(date) AS date
      FROM market_data
      ${ticker ? "WHERE ticker = ?" : ""}
      GROUP BY ticker
    )
    SELECT
      m.ticker,
      m.date,
      m.closing_price,
      m.total_shares,
      m.market_cap,
      m.week_52_high,
      m.week_52_low,
      m.pe_ratio,
      m.pb_ratio,
      m.dividend_yield,
      m.enterprise_value,
      m.fundamentals_period_end,
      m.pe_earnings_section,
      m.pe_earnings_basis,
      m.pe_earnings_period_duration
    FROM market_data m
    JOIN latest l ON l.ticker = m.ticker AND l.date = m.date
    ORDER BY m.market_cap DESC
  `;
  const stmt = ticker ? c.env.DB.prepare(sql).bind(ticker) : c.env.DB.prepare(sql);
  const results = await stmt.all();
  return c.json({ rows: results.results });
});

// Get market data history for a symbol
app.get("/history/:symbol", async (c) => {
  await ensureMarketSchema(c.env.DB);
  const symbol = c.req.param("symbol").toUpperCase();
  const results = await c.env.DB.prepare(
    `SELECT date, closing_price, total_shares, market_cap, pe_ratio, pb_ratio, dividend_yield,
            enterprise_value, fundamentals_period_end, pe_earnings_section,
            pe_earnings_basis, pe_earnings_period_duration,
            week_52_high, week_52_low
     FROM market_data
     WHERE ticker = ?
     ORDER BY date DESC
     LIMIT 90`
  ).bind(symbol).all();
  return c.json(results.results);
});

app.get("/ratios", async (c) => {
  const ticker = c.req.query("ticker")?.toUpperCase() ?? c.req.query("symbol")?.toUpperCase();
  const ratio = (c.req.query("ratio") || "roe").toLowerCase();
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const sql = ticker
    ? `SELECT ticker, period_end, period_duration, section, ratio_name, value, computed_at
       FROM ratios
       WHERE ticker = ? AND ratio_name = ?
       ORDER BY period_end DESC
       LIMIT ?`
    : `SELECT ticker, period_end, period_duration, section, ratio_name, value, computed_at
       FROM ratios
       WHERE ratio_name = ?
       ORDER BY period_end DESC
       LIMIT ?`;
  const stmt = ticker
    ? c.env.DB.prepare(sql).bind(ticker, ratio, limit)
    : c.env.DB.prepare(sql).bind(ratio, limit);
  const results = await stmt.all();
  return c.json({ rows: results.results });
});

app.post("/refresh-derived", async (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;

  const symbolsParam = c.req.query("symbols");
  const symbols = symbolsParam ? symbolsParam.split(",").map((symbol) => symbol.trim().toUpperCase()) : undefined;
  const mode = c.req.query("mode") === "latest" ? "latest" : "all";
  const result = await refreshDerivedMarketData(c.env.DB, symbols, mode);
  return c.json(result);
});

app.post("/backfill", async (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;

  const symbolsParam = c.req.query("symbols");
  const symbols = symbolsParam ? symbolsParam.split(",").map((symbol) => symbol.trim().toUpperCase()) : undefined;
  const priceResult = await backfillPrices(c.env.DB, symbols);
  const [week52Result, derivedResult] = await Promise.all([
    recalc52Week(c.env.DB, symbols),
    refreshDerivedMarketData(c.env.DB, symbols, "all"),
  ]);
  return c.json({ prices: priceResult, week52: week52Result, derived: derivedResult });
});

app.post("/backfill-52week", async (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;

  const symbolsParam = c.req.query("symbols");
  const symbols = symbolsParam ? symbolsParam.split(",").map((symbol) => symbol.trim().toUpperCase()) : undefined;
  const result = await recalc52Week(c.env.DB, symbols);
  return c.json(result);
});

// Export for Cloudflare Workers
export default {
  // HTTP requests
  fetch: app.fetch,

  // Scheduled trigger: 24 five-minute batches from 18:00 through 19:55 UTC.
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const triggerTime = new Date(event.scheduledTime);
    const elapsedMinutes =
      (triggerTime.getUTCHours() - SCHEDULE_START_UTC_HOUR) * 60
      + triggerTime.getUTCMinutes();
    const batch = elapsedMinutes >= 0 && elapsedMinutes % SCHEDULE_INTERVAL_MINUTES === 0
      ? elapsedMinutes / SCHEDULE_INTERVAL_MINUTES
      : undefined;
    if (batch === undefined) {
      console.log(`Skipping unsupported scheduled time ${triggerTime.toISOString()}`);
      return;
    }
    if (batch < 0 || batch >= MARKET_BATCH_COUNT) {
      console.log(`Skipping out-of-range scheduled batch ${batch} at ${triggerTime.toISOString()}`);
      return;
    }
    const tickerList = DEFAULT_TICKERS.slice(batch * MARKET_BATCH_SIZE, (batch + 1) * MARKET_BATCH_SIZE);

    console.log(`Scheduled sync triggered at ${triggerTime.toISOString()}, batch ${batch}`);

    ctx.waitUntil(
      syncMarketData(env.DB, false, batch).then(async (result) => {
        console.log(`Market sync batch ${batch} result:`, result);
        const derivedResult = await refreshDerivedMarketData(env.DB, tickerList, "latest");
        console.log(`Derived market refresh batch ${batch} result:`, derivedResult);
      })
    );

    // Memory extraction runs only on the first market-sync batch.
    if (batch === 0 && env.DEEPSEEK_API_KEY) {
      const retentionDays = parseInt(env.MEMORY_RETENTION_DAYS || "90", 10);
      ctx.waitUntil(
        syncMemories(env.DB, env.DEEPSEEK_API_KEY, {
          retentionDays: Number.isFinite(retentionDays) ? retentionDays : 90,
        }).then((result) => {
          console.log("Memory sync result:", result);
        })
      );
    }
  },
};
