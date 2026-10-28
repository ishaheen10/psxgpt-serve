import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { DurableObjectState } from "@cloudflare/workers-types";
import { customAlphabet } from "nanoid";

import type { Env, SourcePreview } from "./types";
import type {
  AnalystContext as EngineAnalystContext,
  AnalystTrace,
  ExecutionArtifact,
  LaneTrace,
  RouterTrace,
  SavedModelSnapshot,
  SavedModelSummary,
  ThoughtProcessCheckpoint,
  UserWorkspace,
} from "./compat/types";
import { getUser } from "./supabase";
import { runResearch } from "./research/engine";
import type { ResearchReport, ResearchSummary } from "./research/types";
import type { DeepSeekResult as EngineDeepSeekResult } from "./compat/types";
import { buildDataQualityMatrix, buildDataQualityTickerDetail, buildPublicDataHealth } from "./admin/data_quality";
import TICKERS_JSON from "../data/tickers100.json";
// URL-safe, lowercase alphanumeric share ID generator.
const generateShareId = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 16);
const SHARE_ID_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{8,32}$/;
const SAFE_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_QUERY_CHARS = 4_000;
const MAX_STEER_CONTEXT_CHARS = 6_000;
const MAX_CHAT_HISTORY_MESSAGES = 20;
const MAX_CHAT_HISTORY_CHARS = 12_000;
const MAX_EVENT_TYPE_CHARS = 80;
const MAX_EVENT_DATA_CHARS = 4_000;
const MAX_FEEDBACK_COMMENT_CHARS = 1_000;
const ALLOWED_ORIGINS = new Set([
  "https://psxgpt.com",
  "https://www.psxgpt.com",
  "https://psxgpt-serve.pages.dev",
  "https://psxgpt-serve-test.pages.dev",
  "https://psxclientcf.pages.dev",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  sources: SourcePreview[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface JobPayload {
  sessionId: string;
  query: string;
  userId: string;
  userEmail?: string;
  steerContext?: string;  // Scout's reasoning so far, if user is steering/redirecting
  deepseekImpl?: DeepSeekImplementation;
}

interface WsMessage {
  type: "message_update" | "session_update" | "connected";
  messageId?: string;
  sessionId?: string;
  data?: unknown;
}

type DeepSeekImplementation = "v5";

function isDeepSeekImplementation(value: unknown): value is DeepSeekImplementation {
  return value === "v5" || value === "5";
}


// ─────────────────────────────────────────────────────────────────────────────
// Hono App
// ─────────────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors({
  origin: (origin) => trustedOrigin(origin),
  allowHeaders: ["Authorization", "Content-Type"],
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  maxAge: 600,
}));

const TRACE_ADMIN_EMAILS = new Set(["isfandiyar.shaheen@gmail.com"]);
const VALID_TICKERS = new Set(
  (TICKERS_JSON as Array<Record<string, unknown>>)
    .map((row) => String(row.Symbol || "").trim().toUpperCase())
    .filter(Boolean),
);
const MANUAL_COMPANY_ALIASES: Record<string, string[]> = {
  HUBC: ["hubco"],
};
const COMPANY_ALIAS_TO_TICKER = new Map<string, string>();
for (const row of TICKERS_JSON as Array<Record<string, unknown>>) {
  const ticker = String(row.Symbol || "").trim().toUpperCase();
  const company = normalizeCompanyAlias(String(row["Company Name"] || ""));
  if (!ticker || !company) continue;
  const aliases = new Set([
    company,
    company.replace(/\blimited\b/g, "").replace(/\bltd\b/g, "").trim(),
    company.replace(/\([^)]*\)/g, "").trim(),
  ]);
  for (const alias of MANUAL_COMPANY_ALIASES[ticker] || []) aliases.add(normalizeCompanyAlias(alias));
  for (const alias of aliases) {
    if (alias.length >= 3) COMPANY_ALIAS_TO_TICKER.set(alias, ticker);
  }
}
const COMMON_UPPERCASE_WORDS = new Set([
  "PSX", "KSE", "FY", "Q", "QTR", "LTM", "TTM", "DCF", "PKR", "RS", "USD",
  "EPS", "DPS", "ROE", "ROA", "ROCE", "ROIC", "PE", "P/E", "PB", "P/B",
  "EV", "EBIT", "EBITDA", "PBT", "PAT", "NIM", "NPL", "CASA", "CAR", "ADR",
  "CAGR", "IRR", "CFO", "FCF", "FCFE", "CAPEX", "OPEX", "COGS", "NAV", "NPAT", "NOPAT", "GM",
  "SBP", "STI", "QC",
  "BMR", "GPT",
  "SQL", "DB", "D1", "R2", "DO", "DIR", "LLM", "API", "URL", "JSON", "CSV",
  "HTML", "PDF", "TXT", "ID", "IDS", "FORMAT", "TABLE", "TABLES", "HOLDING", "HOLDINGS", "LIMITED",
]);
const INDUSTRY_WORDS = new Set(["BANK", "BANKS", "BANKING", "CEMENT", "CHEMICAL", "FERTILIZER", "FERTILISER", "FOOD", "INSURANCE", "INVESTMENT", "LEASING", "MODARABA", "OMC", "PACKAGING", "PHARMA", "PHARMACEUTICAL", "PHARMACEUTICALS", "POWER", "PROPERTY", "REFINERY", "REFINERIES", "STEEL", "ENGINEERING", "SUGAR", "TECHNOLOGY", "TEXTILE", "TRANSPORT", "LOGISTICS", "AUTOMOBILE"]);

function allowInternalRequest(env: Env, request: Request): boolean {
  const host = new URL(request.url).hostname;
  const isLocalHost = host === "127.0.0.1" || host === "localhost";
  if (isLocalHost) return true;
  return hasAdminBearerToken(env, request.headers.get("authorization"));
}

function trustedOrigin(origin: string | undefined | null): string | undefined {
  if (!origin) return undefined;
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
  } catch {
    return undefined;
  }
  return ALLOWED_ORIGINS.has(origin) ? origin : undefined;
}

function publicBaseUrl(origin: string | undefined | null): string {
  return trustedOrigin(origin) || "https://psxgpt.com";
}

function validateSafeId(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SAFE_ID_RE.test(trimmed)) throw new Error(`${label} contains invalid characters`);
  return trimmed;
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function validateShareId(value: string): string | null {
  const trimmed = value.trim();
  return SHARE_ID_RE.test(trimmed) ? trimmed : null;
}

function truncateText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function normalizeChatHistory(value: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(value)) return [];
  let remainingChars = MAX_CHAT_HISTORY_CHARS;
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const item of value.slice(-MAX_CHAT_HISTORY_MESSAGES)) {
    if ((item?.role !== "user" && item?.role !== "assistant") || typeof item?.content !== "string") continue;
    if (remainingChars <= 0) break;
    const content = item.content.slice(0, remainingChars);
    remainingChars -= content.length;
    out.push({ role: item.role, content });
  }
  return out;
}

function jsonSizeBound(value: unknown, maxChars: number): string | null {
  if (value === undefined || value === null) return null;
  const text = JSON.stringify(value);
  if (text.length > maxChars) throw new Error(`JSON payload exceeds ${maxChars} characters`);
  return text;
}

function renderContextPacksFlowPage(_origin: string): Response {
  return new Response(`<!doctype html><html><meta name="viewport" content="width=device-width"><title>Research flow</title><body style="font:18px system-ui;max-width:760px;margin:60px auto;padding:24px"><h1>From question to sources</h1><p>A small outline breaks broad questions into up to three independent sections.</p><ol><li>Find companies and available reports.</li><li>Search original filings, announcements and macro documents.</li><li>Read full pages, retaining source dates, units and links.</li><li>Write each section from its evidence as soon as it is ready.</li></ol><p>Dated PSX prices and market capitalizations remain available. Normalized statements, precomputed ratios and saved financial models are bypassed.</p><p>Follow-ups reuse relevant saved pages. Progress describes actual searches and reading, never private model reasoning.</p></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function allowEvalRequest(env: Env, request: Request): boolean {
  const host = new URL(request.url).hostname;
  const isLocalHost = host === "127.0.0.1" || host === "localhost";
  if (isLocalHost) return true;
  const authorization = request.headers.get("authorization");
  return hasAdminBearerToken(env, authorization) || hasEvalBearerToken(env, authorization);
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function hasAdminBearerToken(env: Env, authorization: string | null | undefined): boolean {
  if (!env.ADMIN_TOKEN) return false;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  const expected = env.ADMIN_TOKEN.trim();
  return Boolean(token) && Boolean(expected) && timingSafeEqualString(token, expected);
}

function hasEvalBearerToken(env: Env, authorization: string | null | undefined): boolean {
  if (!env.EVAL_TOKEN) return false;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  const expected = env.EVAL_TOKEN.trim();
  return Boolean(token) && Boolean(expected) && timingSafeEqualString(token, expected);
}

function isTraceAdminEmail(email?: string): boolean {
  return !!email && TRACE_ADMIN_EMAILS.has(email.trim().toLowerCase());
}

function isInternalInfoQuery(query: string): boolean {
  const lower = query.toLowerCase();
  const asksForRawDb = /\b(schema|table|tables|database|db|query_logs|user queries|metadata|configuration|config|internal path|internal paths|source\.psxgpt\.com|\/pdf_pages\/|directory|dir|first row|250th row|165,?000th row)\b/.test(lower)
    || /\bdatabase[_-]?[a-z0-9_]*\b/.test(lower);
  const asksForInfra = /\b(sql|cloudflare|supabase|worker|durable object|d1|r2|wrangler|gemini|which llm|who trained|internet outbound|system prompt)\b/.test(lower);
  const userSafeDataAsk = /\b(company|ticker|stock|financial|valuation|dividend|revenue|profit|market cap|pe|p\/e|report|filing|annual|quarterly)\b/.test(lower);
  if (/\bmarket data schema\b|\bmarket_data\b|\bquery_logs\b|\buser_events\b|\buser_memories\b/.test(lower)) return true;
  if (asksForRawDb && !userSafeDataAsk) return true;
  return asksForInfra && !userSafeDataAsk;
}

function internalInfoResponse(): string {
  return [
    "I can’t provide internal database schemas, raw table rows, runtime logs, file-system paths, model configuration, or infrastructure details.",
    "",
    "I can help with PSX company research using the supported sources: original filings, announcements, economic documents and dated PSX market data. If you want coverage information, ask in business terms, for example: “which tickers are covered?” or “show HBL’s latest annual report evidence.”",
  ].join("\n");
}

function isProductCapabilitiesQuery(query: string): boolean {
  const lower = query.toLowerCase();
  const asksCapabilities = /\b(what can you do|how (?:do|can) i use|first time using|new to psxgpt|help me use|getting started|what is psxgpt|what does psxgpt do)\b/.test(lower);
  if (!asksCapabilities) return false;
  return !/\b(?:tell me about|analy[sz]e|compare|valuation|forecast|model|ratio|revenue|profit|market cap|dividend|price|report|filing)\b/.test(lower);
}

function productCapabilitiesResponse(): string {
  return "psxGPT researches Pakistan-listed companies from original filings, announcements and economic documents, with dated PSX market data. Ask a focused question or a broader question that can be answered in sections. Open the linked source pages, then follow up to refine the research. Include company names and periods where possible. Financial models and precomputed ratio screens are currently paused.";
}

function sanitizeUserFacingError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "Unknown error");
  if (/long-running import|currently processing|D1_ERROR|database is locked|SQLITE_BUSY/i.test(raw)) {
    return "The financial database is temporarily busy while an update is running. Please retry in a minute.";
  }
  if (/Gemini error|503|UNAVAILABLE|temporarily unavailable|fetch failed/i.test(raw)) {
    return "psxGPT is temporarily unavailable. Please try again.";
  }
  return raw.length > 500 ? `${raw.slice(0, 497)}...` : raw;
}

type TraceAccess = {
  user: NonNullable<Awaited<ReturnType<typeof getUser>>>;
  isAdmin: boolean;
};

async function requireTraceAccess(c: Context<{ Bindings: Env }>): Promise<TraceAccess | Response> {
  const user = await getUser(c.env, c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return { user, isAdmin: isTraceAdminEmail(user.email) };
}

let ensureEngineLogsSchemaPromise: Promise<void> | null = null;

function jsonText(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

function parseJsonField<T = unknown>(value: unknown): T | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function extractTickerLikeTokens(query: string): string[] {
  const industryContext = /\b(sector|industry|industries|companies|stocks)\b/i.test(query);
  return [...new Set((query.match(/\b[A-Z][A-Z0-9]{1,7}\b/g) || [])
    .map((token) => token.toUpperCase())
    .filter((token) => !COMMON_UPPERCASE_WORDS.has(token))
    .filter((token) => !(industryContext && INDUSTRY_WORDS.has(token))))];
}

function normalizeCompanyAlias(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\blimited\b/g, " limited")
    .replace(/\bltd\.?\b/g, " ltd")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTickerDiagnosticToken(value: string, query = ""): boolean {
  const token = String(value || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,7}$/.test(token)) return false;
  if (COMMON_UPPERCASE_WORDS.has(token)) return false;
  if (COMPANY_ALIAS_TO_TICKER.has(normalizeCompanyAlias(token))) return false;
  const industryContext = /\b(sector|industry|industries|companies|stocks)\b/i.test(query);
  if (industryContext && INDUSTRY_WORDS.has(token)) return false;
  return true;
}

function extractMentionedTickers(query: string): string[] {
  return extractTickerLikeTokens(query).filter((ticker) => VALID_TICKERS.has(ticker));
}

function extractUnresolvedTickerRequests(query: string): string[] {
  return extractTickerLikeTokens(query).filter((ticker) =>
    !VALID_TICKERS.has(ticker)
    && !COMPANY_ALIAS_TO_TICKER.has(normalizeCompanyAlias(ticker))
  );
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (__, j) => i === 0 ? j : j === 0 ? i : 0),
  );
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

function isLikelyTickerSubstitution(invalidTicker: string, usedTicker: string): boolean {
  if (!invalidTicker || !usedTicker || invalidTicker === usedTicker) return false;
  const aliasTicker = COMPANY_ALIAS_TO_TICKER.get(normalizeCompanyAlias(invalidTicker));
  if (aliasTicker && aliasTicker === usedTicker) return false;
  const distance = editDistance(invalidTicker, usedTicker);
  return distance <= 1 || (distance <= 2 && Math.min(invalidTicker.length, usedTicker.length) >= 5);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function addCount(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) || 0) + amount);
}

function topCounts(map: Map<string, number>, limit = 20): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function classifyError(rawValue: unknown): string {
  const raw = String(rawValue || "");
  if (!raw) return "none";
  if (/long-running import|currently processing|D1_ERROR|database is locked|SQLITE_BUSY/i.test(raw)) return "d1_lock";
  if (/location is not supported|FAILED_PRECONDITION/i.test(raw)) return "gemini_geo";
  if (/429|high traffic|rate.?limit/i.test(raw)) return "rate_limit";
  if (/Gemini error|503|UNAVAILABLE|temporarily unavailable|fetch failed|5\d\d/i.test(raw)) return "gemini_5xx";
  if (/cancelled|canceled|aborted|AbortError/i.test(raw)) return "cancelled";
  return "other";
}

function issueExample(params: {
  type: string;
  label: string;
  severity?: "low" | "medium" | "high";
  engine: Record<string, unknown>;
  detail?: string;
}): Record<string, unknown> {
  const error = String(params.engine.error || "");
  return {
    type: params.type,
    label: params.label,
    severity: params.severity || "medium",
    engine_id: params.engine.engine_id || params.engine.id,
    query: params.engine.query,
    user_email: params.engine.user_email,
    created_at: params.engine.created_at,
    status: params.engine.status,
    error,
    error_class: classifyError(error || params.detail || params.engine.status),
    detail: params.detail || "",
  };
}

function evalSuggestionsForIssues(issueCounts: Map<string, number>, unresolvedTickerCounts: Map<string, number>): Array<Record<string, unknown>> {
  const suggestions: Array<Record<string, unknown>> = [];
  const add = (issueKey: string, title: string, query: string, assertion: string, priority: "low" | "medium" | "high" = "medium") => {
    const count = issueCounts.get(issueKey) || 0;
    if (count <= 0) return;
    suggestions.push({ issueKey, title, query, assertion, priority, count });
  };

  add(
    "wrong_ticker_substitution",
    "Unresolved ticker must not map to nearest valid ticker",
    "Tell me about <UNKNOWN_TICKER>. The symbol is <UNKNOWN_TICKER>.",
    "Router marks the ticker out-of-universe; no SQL or selected_tickers contain a close valid ticker.",
    "high",
  );
  add(
    "unresolved_ticker_request",
    "Unknown ticker closes as coverage gap",
    `Tell me about ${topCounts(unresolvedTickerCounts, 1)[0]?.key || "<UNKNOWN_TICKER>"}.`,
    "Answer discloses missing coverage and lanes do not retrieve substitute company data.",
    "high",
  );
  add(
    "coverage_missing_tickers",
    "Multi-ticker coverage cannot silently drop a company",
    "Compare <TICKER_A> and <TICKER_B> on revenue, earnings, and valuation.",
    "Coverage shows requested_tickers are all present, or answer explicitly scopes the limitation.",
    "high",
  );
  add(
    "model_build_failed_or_unsupported",
    "Model-build failure surfaces as limitation, not invented forecast",
    "Build me a financial model for a holding company.",
    "Trace records model_build failed/unsupported and answer avoids forecast tables not produced by compute.",
    "high",
  );
  add(
    "missing_scope",
    "Scopeless ask should ask/route for scope rather than fabricate",
    "Give me the latest result.",
    "Router/lane returns missing scope or asks for ticker; no broad unrelated data is used.",
    "medium",
  );
  add(
    "failed_or_incomplete_run",
    "Transient failures return friendly retryable errors",
    "Tell me about OGDC.",
    "User-facing answer/error is sanitized; trace records failed dependency without internal stack/schema leakage.",
    "medium",
  );
  add(
    "feedback_down",
    "User downvote becomes an eval candidate",
    "Replay the downvoted query from trace examples.",
    "Expected behavior should be derived from trace issue detail before adding to regression suite.",
    "medium",
  );

  const priorityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  return suggestions.sort((a, b) =>
    (priorityRank[String(b.priority)] || 0) - (priorityRank[String(a.priority)] || 0)
    || Number(b.count || 0) - Number(a.count || 0),
  );
}

function lastUserMessageContent(messages: Array<{ role: string; content?: string }>): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return message.content || null;
  }
  return null;
}

function analystUserPayloadFromTrace(analyst: AnalystTrace): string | null {
  const explicit = analyst.analystUserMessage?.trim();
  if (explicit) return explicit;
  const messageContent = lastUserMessageContent(analyst.messages);
  if (messageContent?.trim()) return messageContent;
  return JSON.stringify(analyst.analystContext);
}

function analystUserPayloadFromRow(row: Record<string, unknown>): string | null {
  const stored = typeof row.analyst_user_message_text === "string"
    ? row.analyst_user_message_text.trim()
    : "";
  if (stored) return stored;
  const messages = parseJsonField(row.messages_json) as Array<{ role: string; content?: string }> | null;
  const messageContent = lastUserMessageContent(Array.isArray(messages) ? messages : []);
  if (messageContent?.trim()) return messageContent;
  const analystContext = parseJsonField(row.analyst_context_json) as EngineAnalystContext | null;
  if (!analystContext) return null;
  try {
    return JSON.stringify(analystContext);
  } catch {
    return null;
  }
}

async function ensureEngineLogsSchema(env: Env): Promise<void> {
  if (!ensureEngineLogsSchemaPromise) {
    ensureEngineLogsSchemaPromise = (async () => {
      await env.DB.batch([
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS engine (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            user_email TEXT,
            session_id TEXT,
            message_id TEXT,
            deepseek_impl TEXT,
            run_kind TEXT,
            query TEXT,
            chat_history_json TEXT,
            steer_context TEXT,
            status TEXT,
            error TEXT,
            iterations INTEGER,
            duration_ms INTEGER,
            scout_input_tokens INTEGER,
            scout_output_tokens INTEGER,
            analyst_input_tokens INTEGER,
            analyst_output_tokens INTEGER,
            was_steered INTEGER DEFAULT 0,
            surfaced_sources_json TEXT,
            created_at TEXT DEFAULT (datetime('now'))
          )`
        ),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_engine_created_at ON engine(created_at DESC)`),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_engine_message ON engine(message_id)`),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS query_logs (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            user_email TEXT,
            session_id TEXT,
            message_id TEXT,
            query TEXT NOT NULL,
            answer TEXT,
            status TEXT,
            iterations INTEGER,
            duration_ms INTEGER,
            error TEXT,
            scout_input_tokens INTEGER,
            scout_output_tokens INTEGER,
            analyst_input_tokens INTEGER,
            analyst_output_tokens INTEGER,
            was_steered INTEGER DEFAULT 0,
            feedback TEXT,
            feedback_comment TEXT,
            feedback_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
          )`
        ),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_query_logs_user_created ON query_logs(user_id, created_at DESC)`),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_query_logs_created_user ON query_logs(created_at DESC, user_id)`),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_query_logs_message_user ON query_logs(message_id, user_id)`),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS user_events (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            user_email TEXT,
            event_type TEXT NOT NULL,
            event_data TEXT,
            session_id TEXT,
            created_at TEXT DEFAULT (datetime('now'))
          )`
        ),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_events_created ON user_events(created_at DESC)`),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_events_type_created ON user_events(event_type, created_at DESC)`),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS shared_conversations (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            user_email TEXT,
            session_id TEXT,
            title TEXT,
            message_count INTEGER DEFAULT 0,
            conversation_snapshot TEXT NOT NULL,
            view_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`
        ),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_shared_conversations_user_created ON shared_conversations(user_id, created_at DESC)`),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS user_memories (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            first_name TEXT,
            source TEXT DEFAULT 'inferred',
            created_at TEXT DEFAULT (datetime('now'))
          )`
        ),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_memories_user_source_created ON user_memories(user_id, source, created_at DESC)`),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_memories_source_created ON user_memories(source, created_at DESC)`),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS router (
          id TEXT PRIMARY KEY,
          engine_id TEXT NOT NULL,
          model TEXT,
          system_prompt_text TEXT,
          user_message_text TEXT,
          compressed_history_text TEXT,
          ticker_reference_text TEXT,
          raw_response_text TEXT,
          reasoning_text TEXT,
          asks_json TEXT,
          raw_plan_json TEXT,
          normalized_plan_json TEXT,
          final_plan_json TEXT,
          resolution_context_json TEXT,
          runtime_interventions_json TEXT,
          input_tokens INTEGER,
          output_tokens INTEGER,
          created_at TEXT DEFAULT (datetime('now'))
        )`
      ),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_router_engine_id ON router(engine_id)`),
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS lane (
          id TEXT PRIMARY KEY,
          engine_id TEXT NOT NULL,
          lane_variable TEXT NOT NULL,
          table_name TEXT NOT NULL,
          ask TEXT NOT NULL,
          model TEXT,
          system_prompt_text TEXT,
          message_history_json TEXT,
          sql_queries_json TEXT,
          result_summary TEXT,
          artifact_json TEXT,
          analysis_attachment_json TEXT,
          provenance_ids_json TEXT,
          narrative_ids_json TEXT,
          runtime_interventions_json TEXT,
          candidate_preview_json TEXT,
          reasoning_text TEXT,
          input_tokens INTEGER,
          output_tokens INTEGER,
          created_at TEXT DEFAULT (datetime('now'))
        )`
      ),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_lane_engine_id ON lane(engine_id)`),
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS analyst (
          id TEXT PRIMARY KEY,
          engine_id TEXT NOT NULL,
          model TEXT,
          system_prompt_text TEXT,
          messages_json TEXT,
          analyst_user_message_text TEXT,
          memory_context_text TEXT,
          execution_artifacts_json TEXT,
          computed_tables_json TEXT,
          analyst_context_json TEXT,
          answer_text TEXT,
          sources_json TEXT,
          attachments_json TEXT,
          citation_trace_json TEXT,
          answer_interventions_json TEXT,
          reasoning_text TEXT,
          input_tokens INTEGER,
          output_tokens INTEGER,
          duration_ms INTEGER,
          created_at TEXT DEFAULT (datetime('now'))
        )`
      ),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_analyst_engine_id ON analyst(engine_id)`),
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS sources (
          id TEXT PRIMARY KEY,
          engine_id TEXT NOT NULL,
          lane_variable TEXT,
          source_id TEXT NOT NULL,
          source_kind TEXT,
          selected_for_analyst INTEGER DEFAULT 0,
          selected_for_panel INTEGER DEFAULT 0,
          selection_stage TEXT,
          ticker TEXT,
          filing_type TEXT,
          filing_period TEXT,
          page_number INTEGER,
          preview_json TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )`
      ),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sources_engine_id ON sources(engine_id)`),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sources_source_id ON sources(source_id)`),
      ]);

      const tableInfo = await env.DB.prepare("PRAGMA table_info(engine)").all();
      const columns = new Set(
        ((tableInfo.results || []) as Array<Record<string, unknown>>)
          .map((row) => String(row.name || "")),
      );
      if (!columns.has("surfaced_sources_json")) {
        await env.DB.prepare("ALTER TABLE engine ADD COLUMN surfaced_sources_json TEXT").run();
      }

      const routerInfo = await env.DB.prepare("PRAGMA table_info(router)").all();
      const routerColumns = new Set(
        ((routerInfo.results || []) as Array<Record<string, unknown>>)
          .map((row) => String(row.name || "")),
      );
      if (!routerColumns.has("raw_plan_json")) {
        await env.DB.prepare("ALTER TABLE router ADD COLUMN raw_plan_json TEXT").run();
      }
      if (!routerColumns.has("normalized_plan_json")) {
        await env.DB.prepare("ALTER TABLE router ADD COLUMN normalized_plan_json TEXT").run();
      }
      if (!routerColumns.has("runtime_interventions_json")) {
        await env.DB.prepare("ALTER TABLE router ADD COLUMN runtime_interventions_json TEXT").run();
      }
      if (!routerColumns.has("final_plan_json")) {
        await env.DB.prepare("ALTER TABLE router ADD COLUMN final_plan_json TEXT").run();
      }
      if (!routerColumns.has("resolution_context_json")) {
        await env.DB.prepare("ALTER TABLE router ADD COLUMN resolution_context_json TEXT").run();
      }

      const analystInfo = await env.DB.prepare("PRAGMA table_info(analyst)").all();
      const analystColumns = new Set(
        ((analystInfo.results || []) as Array<Record<string, unknown>>)
          .map((row) => String(row.name || "")),
      );
      if (!analystColumns.has("analyst_user_message_text")) {
        await env.DB.prepare("ALTER TABLE analyst ADD COLUMN analyst_user_message_text TEXT").run();
      }
      if (!analystColumns.has("citation_trace_json")) {
        await env.DB.prepare("ALTER TABLE analyst ADD COLUMN citation_trace_json TEXT").run();
      }
      if (!analystColumns.has("answer_interventions_json")) {
        await env.DB.prepare("ALTER TABLE analyst ADD COLUMN answer_interventions_json TEXT").run();
      }

      const laneInfo = await env.DB.prepare("PRAGMA table_info(lane)").all();
      const laneColumns = new Set(
        ((laneInfo.results || []) as Array<Record<string, unknown>>)
          .map((row) => String(row.name || "")),
      );
      if (!laneColumns.has("artifact_json")) {
        await env.DB.prepare("ALTER TABLE lane ADD COLUMN artifact_json TEXT").run();
      }
      if (!laneColumns.has("runtime_interventions_json")) {
        await env.DB.prepare("ALTER TABLE lane ADD COLUMN runtime_interventions_json TEXT").run();
      }
    })().then(() => undefined);
  }

  await ensureEngineLogsSchemaPromise;
}

function buildSourceLogRows(
  engineId: string,
  analystContext: EngineAnalystContext | undefined,
  finalSources: SourcePreview[],
) {
  const rows: Array<{
    sourceId: string;
    sourceKind: string;
    selectedForAnalyst: number;
    selectedForPanel: number;
    selectionStage: string;
    preview: SourcePreview;
  }> = [];

  const analystMap = new Map<string, SourcePreview>();
  for (const source of analystContext?.sources || []) {
    analystMap.set(String(source.preview.id), source.preview);
  }

  const panelMap = new Map<string, SourcePreview>();
  for (const source of finalSources || []) {
    panelMap.set(String(source.id), source);
  }

  const seen = new Set<string>();
  const addRow = (sourceId: string, preview: SourcePreview) => {
    const key = sourceId;
    if (seen.has(key)) return;
    seen.add(key);

    const selectedForAnalyst = analystMap.has(sourceId) ? 1 : 0;
    const selectedForPanel = 1;
    const selectionStage = selectedForAnalyst ? "surfaced_and_used" : "surfaced_only";

    rows.push({
      sourceId,
      sourceKind: "surfaced_source",
      selectedForAnalyst,
      selectedForPanel,
      selectionStage,
      preview,
    });
  };

  for (const [sourceId, preview] of panelMap.entries()) {
    addRow(sourceId, preview);
  }

  return rows.map((row) => ({
    id: crypto.randomUUID(),
    engineId,
    laneVariable: null,
    sourceId: row.sourceId,
    sourceKind: row.sourceKind,
    selectedForAnalyst: row.selectedForAnalyst,
    selectedForPanel: row.selectedForPanel,
    selectionStage: row.selectionStage,
    ticker: row.preview.ticker || null,
    filingType: row.preview.filingType || null,
    filingPeriod: row.preview.filingPeriod || null,
    pageNumber: row.preview.pageNumber ?? null,
    previewJson: jsonText(row.preview),
  }));
}

async function persistEngineLogs(
  env: Env,
  params: {
    runKind: "user" | "eval" | "router" | "structured" | "narrative" | "analyst" | "context";
    deepseekImpl: DeepSeekImplementation;
    query: string;
    chatHistory: Array<{ role: string; content: string }>;
    userId?: string;
    userEmail?: string;
    sessionId?: string;
    messageId?: string;
    steerContext?: string;
    status: "done" | "failed" | "cancelled";
    error?: string;
    durationMs: number;
    iterations: number;
    result?: EngineDeepSeekResult;
    routerTrace?: RouterTrace;
    laneTraces?: LaneTrace[];
    analystTrace?: AnalystTrace;
    executionArtifacts?: ExecutionArtifact[];
    analystContext?: EngineAnalystContext;
    sources?: SourcePreview[];
    scoutInputTokens?: number;
    scoutOutputTokens?: number;
    analystInputTokens?: number;
    analystOutputTokens?: number;
    wasSteered?: boolean;
  }
): Promise<string> {
  await ensureEngineLogsSchema(env);

  const engineId = crypto.randomUUID();
  const statements = [];
  const result = params.result;
  const routerTrace = params.routerTrace || result?.engineTrace?.router;
  const laneTraces = params.laneTraces || result?.engineTrace?.lanes || [];
  const analystTrace = params.analystTrace || result?.engineTrace?.analyst;
  const analystContext = params.analystContext || result?.analystContext;
  const finalSources = params.sources || result?.sources || [];

  statements.push(
    env.DB.prepare(
      `INSERT INTO engine (
        id, user_id, user_email, session_id, message_id, deepseek_impl, run_kind,
        query, chat_history_json, steer_context, status, error, iterations, duration_ms,
        scout_input_tokens, scout_output_tokens, analyst_input_tokens, analyst_output_tokens,
        was_steered, surfaced_sources_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      engineId,
      params.userId || null,
      params.userEmail || null,
      params.sessionId || null,
      params.messageId || null,
      result?.researchReport ? "research-v1" : params.deepseekImpl,
      params.runKind,
      params.query,
      jsonText(params.chatHistory),
      params.steerContext || null,
      params.status,
      params.error || null,
      params.iterations,
      params.durationMs,
      params.scoutInputTokens ?? result?.scoutInputTokens ?? 0,
      params.scoutOutputTokens ?? result?.scoutOutputTokens ?? 0,
      params.analystInputTokens ?? result?.analystInputTokens ?? 0,
      params.analystOutputTokens ?? result?.analystOutputTokens ?? 0,
      (params.wasSteered ?? result?.wasSteered) ? 1 : 0,
      jsonText(finalSources),
    )
  );

  if (result?.researchReport) {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS research_runs (engine_id TEXT PRIMARY KEY, report_json TEXT NOT NULL)').run();
    statements.push(env.DB.prepare('INSERT INTO research_runs (engine_id,report_json) VALUES (?,?)').bind(engineId, JSON.stringify(result.researchReport)));
  }

  if (routerTrace) {
    const router = routerTrace;
    statements.push(
      env.DB.prepare(
        `INSERT INTO router (
          id, engine_id, model, system_prompt_text, user_message_text, compressed_history_text,
          ticker_reference_text, raw_response_text, reasoning_text, asks_json, raw_plan_json,
          normalized_plan_json, final_plan_json, resolution_context_json, runtime_interventions_json,
          input_tokens, output_tokens, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        crypto.randomUUID(),
        engineId,
        router.model,
        router.systemPrompt,
        router.userMessage,
        router.compressedHistory,
        router.tickerReference,
        router.rawResponse,
        router.reasoning,
        jsonText(router.asks),
        jsonText(router.rawPlan || null),
        jsonText(router.normalizedPlan || null),
        jsonText(router.finalPlan || null),
        jsonText(router.resolutionContext || null),
        jsonText(router.runtimeInterventions || []),
        router.inputTokens,
        router.outputTokens,
      )
    );
  }

  for (const lane of laneTraces) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO lane (
          id, engine_id, lane_variable, table_name, ask, model, system_prompt_text,
          message_history_json, sql_queries_json, result_summary, artifact_json, analysis_attachment_json,
          provenance_ids_json, narrative_ids_json, runtime_interventions_json, candidate_preview_json, reasoning_text,
          input_tokens, output_tokens, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        crypto.randomUUID(),
        engineId,
        lane.laneVariable,
        lane.table,
        lane.ask,
        lane.model,
        lane.systemPrompt,
        jsonText(lane.messageHistory),
        jsonText(lane.sqlQueries),
        lane.resultSummary,
        jsonText(lane.artifact),
        jsonText(lane.artifact.analysisAttachment),
        jsonText(lane.artifact.provenanceIds),
        jsonText(lane.artifact.narrativeIds),
        jsonText(lane.runtimeInterventions || []),
        jsonText(lane.candidatePreview),
        lane.reasoning,
        lane.inputTokens,
        lane.outputTokens,
      )
    );
  }

  if (analystTrace) {
    const analyst = analystTrace;
    statements.push(
      env.DB.prepare(
        `INSERT INTO analyst (
          id, engine_id, model, system_prompt_text, messages_json, analyst_user_message_text, memory_context_text,
          execution_artifacts_json, computed_tables_json, analyst_context_json, answer_text,
          sources_json, attachments_json, citation_trace_json, answer_interventions_json, reasoning_text, input_tokens, output_tokens,
          duration_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        crypto.randomUUID(),
        engineId,
        analyst.model,
        analyst.systemPrompt,
        jsonText(analyst.messages),
        analystUserPayloadFromTrace(analyst),
        analyst.memoryContext,
        jsonText(analyst.analystContext.executions),
        jsonText(analyst.analystContext.computedTables),
        jsonText(analyst.analystContext),
        analyst.answer,
        jsonText(analyst.sources),
        jsonText(analyst.attachments),
        jsonText(analyst.citationTrace || null),
        jsonText(analyst.answerInterventions || []),
        analyst.reasoning,
        analyst.inputTokens,
        analyst.outputTokens,
        analyst.durationMs,
      )
    );
  }

  for (const source of buildSourceLogRows(engineId, analystContext, finalSources)) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO sources (
          id, engine_id, lane_variable, source_id, source_kind, selected_for_analyst,
          selected_for_panel, selection_stage, ticker, filing_type, filing_period,
          page_number, preview_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        source.id,
        source.engineId,
        source.laneVariable,
        source.sourceId,
        source.sourceKind,
        source.selectedForAnalyst,
        source.selectedForPanel,
        source.selectionStage,
        source.ticker,
        source.filingType,
        source.filingPeriod,
        source.pageNumber,
        source.previewJson,
      )
    );
  }

  await env.DB.batch(statements);
  return engineId;
}

// Health check
app.get("/healthz", (c) => c.json({ status: "ok", engine: "research-v1" }));
app.get("/context-pack-flow", (c) => renderContextPacksFlowPage(new URL(c.req.url).origin));

// Tickers list for frontend
app.get("/api/tickers", (c) => c.json(TICKERS_JSON));

app.get("/api/data-health", async (c) => {
  const url = new URL(c.req.url);
  const periods = boundedInt(url.searchParams.get("periods") || undefined, 12, 1, 24);
  try {
    return c.json(await buildPublicDataHealth(c.env, periods));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "data health failed");
    return c.json({ ok: false, error: message }, 500);
  }
});

app.get("/api/admin/traces", async (c) => {
  const access = await requireTraceAccess(c);
  if (access instanceof Response) return access;
  await ensureEngineLogsSchema(c.env);
  const url = new URL(c.req.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 25) || 25));
  const query = String(url.searchParams.get("q") || "").trim();
  const requestedUserId = String(url.searchParams.get("user_id") || "").trim();
  const requestedUserEmail = String(url.searchParams.get("user_email") || "").trim();
  const where: string[] = [];
  const binds: unknown[] = [];

  if (query) {
    where.push("query LIKE ?");
    binds.push(`%${query}%`);
  }

  if (access.isAdmin) {
    if (requestedUserId && requestedUserId !== "__all") {
      where.push("user_id = ?");
      binds.push(requestedUserId);
    } else if (requestedUserEmail && requestedUserEmail !== "__all") {
      where.push("LOWER(COALESCE(user_email, '')) = LOWER(?)");
      binds.push(requestedUserEmail);
    }
  } else {
    where.push("user_id = ?");
    binds.push(access.user.id);
  }

  const sql = `
    SELECT id, user_id, user_email, session_id, message_id, deepseek_impl, run_kind,
           query, status, error, iterations, duration_ms, scout_input_tokens,
           scout_output_tokens, analyst_input_tokens, analyst_output_tokens,
           was_steered, surfaced_sources_json, created_at
    FROM engine
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  const result = await c.env.DB.prepare(sql).bind(...binds, limit).all();
  const traces = ((result.results || []) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    surfaced_sources: parseJsonField(row.surfaced_sources_json) || [],
    surfaced_sources_json: undefined,
  }));

  let users: Array<Record<string, unknown>> = [];
  if (access.isAdmin) {
    const usersResult = await c.env.DB.prepare(`
      SELECT user_id, user_email, COUNT(*) AS trace_count, MAX(created_at) AS last_trace_at
      FROM engine
      WHERE user_id IS NOT NULL
      GROUP BY user_id, user_email
      ORDER BY last_trace_at DESC
      LIMIT 200
    `).all();
    users = (usersResult.results || []) as Array<Record<string, unknown>>;
  }

  return c.json({
    ok: true,
    traces,
    users,
    isAdmin: access.isAdmin,
    currentUser: { id: access.user.id, email: access.user.email || null },
  });
});

app.get("/api/admin/issues", async (c) => {
  const tokenAdmin = hasAdminBearerToken(c.env, c.req.header("authorization"));
  if (!tokenAdmin) {
    const access = await requireTraceAccess(c);
    if (access instanceof Response) return access;
    if (!access.isAdmin) return c.json({ error: "Forbidden" }, 403);
  }
  await ensureEngineLogsSchema(c.env);

  const url = new URL(c.req.url);
  const hours = Math.max(1, Math.min(24 * 30, Number(url.searchParams.get("hours") || 48) || 48));
  const limit = Math.max(25, Math.min(500, Number(url.searchParams.get("limit") || 250) || 250));
  const windowBind = `-${hours} hours`;

  const [engineResult, laneResult, feedbackResult] = await Promise.all([
    c.env.DB.prepare(`
      SELECT e.id, e.user_id, e.user_email, e.query, e.status, e.error, e.duration_ms,
             e.iterations, e.created_at, r.resolution_context_json
      FROM engine e
      LEFT JOIN router r ON r.engine_id = e.id
      WHERE e.run_kind IN ('user', 'eval')
        AND e.created_at >= datetime('now', ?)
      ORDER BY e.created_at DESC
      LIMIT ?
    `).bind(windowBind, limit).all(),
    c.env.DB.prepare(`
      SELECT e.id AS engine_id, e.user_id, e.user_email, e.query, e.status, e.error, e.created_at,
             l.table_name, l.ask, l.result_summary, l.artifact_json, l.sql_queries_json,
             r.resolution_context_json
      FROM lane l
      JOIN engine e ON e.id = l.engine_id
      LEFT JOIN router r ON r.engine_id = e.id
      WHERE e.run_kind IN ('user', 'eval')
        AND e.created_at >= datetime('now', ?)
      ORDER BY e.created_at DESC
      LIMIT ?
    `).bind(windowBind, limit * 8).all(),
    c.env.DB.prepare(`
      SELECT id, user_id, user_email, session_id, message_id, query, status, error,
             feedback, feedback_comment, created_at
      FROM query_logs
      WHERE created_at >= datetime('now', ?)
        AND (status != 'done' OR error IS NOT NULL OR feedback IS NOT NULL)
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(windowBind, limit).all(),
  ]);

  const engines = (engineResult.results || []) as Array<Record<string, unknown>>;
  const lanes = (laneResult.results || []) as Array<Record<string, unknown>>;
  const feedbackRows = (feedbackResult.results || []) as Array<Record<string, unknown>>;
  const issueCounts = new Map<string, number>();
  const tickerCounts = new Map<string, number>();
  const unresolvedTickerCounts = new Map<string, number>();
  const outOfUniverseCounts = new Map<string, number>();
  const examples: Record<string, unknown>[] = [];
  const maxExamples = 80;

  const pushExample = (example: Record<string, unknown>) => {
    if (examples.length < maxExamples) examples.push(example);
  };

  for (const engine of engines) {
    const query = String(engine.query || "");
    for (const ticker of extractMentionedTickers(query)) addCount(tickerCounts, ticker);
    const resolutionContext = parseJsonField<{ unresolvedMentions?: unknown[] }>(engine.resolution_context_json);
    const unresolvedRequests = resolutionContext
      ? asStringArray(resolutionContext.unresolvedMentions)
      : extractUnresolvedTickerRequests(query);
    for (const ticker of unresolvedRequests) {
      addCount(unresolvedTickerCounts, ticker);
      addCount(issueCounts, "unresolved_ticker_request");
      pushExample(issueExample({
        type: "unresolved_ticker_request",
        label: ticker,
        severity: "medium",
        engine,
        detail: "User named a ticker-like symbol that is not in the current coverage universe.",
      }));
    }
    const engineStatus = String(engine.status || "");
    if (engineStatus !== "done") {
      const cancelled = engineStatus === "cancelled" || classifyError(engine.error) === "cancelled";
      addCount(issueCounts, cancelled ? "cancelled_run" : "failed_or_incomplete_run");
      pushExample(issueExample({
        type: cancelled ? "cancelled_run" : "failed_or_incomplete_run",
        label: String(engine.status || "unknown"),
        severity: cancelled ? "low" : "high",
        engine,
        detail: String(engine.error || ""),
      }));
    }
  }

  for (const lane of lanes) {
    const artifact = parseJsonField<Record<string, unknown>>(lane.artifact_json) || {};
    const coverage = (artifact.coverage || {}) as Record<string, unknown>;
    const askObject = (artifact.askObject || {}) as Record<string, unknown>;
    const sqlText = asStringArray(parseJsonField(lane.sql_queries_json)).join("\n");
    const query = String(lane.query || "");
    const resolutionContext = parseJsonField<{ unresolvedMentions?: unknown[] }>(lane.resolution_context_json);
    const unresolvedTickerRequests = resolutionContext
      ? asStringArray(resolutionContext.unresolvedMentions)
      : extractUnresolvedTickerRequests(query);
    const usedTickers = [...new Set([
      ...asStringArray(artifact.selected_tickers),
      ...asStringArray(coverage.selected_tickers),
      ...asStringArray(askObject.tickers),
      ...((sqlText.match(/\b[A-Z][A-Z0-9]{1,7}\b/g) || []).filter((ticker) => VALID_TICKERS.has(ticker))),
    ].map((ticker) => ticker.toUpperCase()))];

    for (const unresolvedTicker of unresolvedTickerRequests) {
      const suspicious = usedTickers.filter((ticker) => isLikelyTickerSubstitution(unresolvedTicker, ticker));
      if (suspicious.length > 0) {
        addCount(issueCounts, "wrong_ticker_substitution");
        pushExample(issueExample({
          type: "wrong_ticker_substitution",
          label: `${unresolvedTicker} -> ${suspicious.join(", ")}`,
          severity: "high",
          engine: lane,
          detail: `${lane.table_name || "lane"} used a close valid ticker for an unresolved user ticker.`,
        }));
      }
    }

    const outOfUniverse = [
      ...asStringArray(artifact._out_of_universe),
      ...asStringArray(askObject._out_of_universe),
    ].filter((token) => isTickerDiagnosticToken(token, query));
    if (outOfUniverse.length > 0) {
      addCount(issueCounts, "out_of_universe_disclosed");
      for (const item of outOfUniverse) addCount(outOfUniverseCounts, item);
    }

    const unresolved = [
      ...asStringArray(artifact._unresolved_tickers),
      ...asStringArray(askObject._unresolved_tickers),
    ].filter((token) => isTickerDiagnosticToken(token, query));
    if (unresolved.length > 0) {
      addCount(issueCounts, "unresolved_ticker");
      pushExample(issueExample({
        type: "unresolved_ticker",
        label: unresolved.join(", "),
        severity: "medium",
        engine: lane,
        detail: String(lane.result_summary || lane.ask || ""),
      }));
    }

    if (artifact._missing_scope || askObject._missing_scope) {
      addCount(issueCounts, "missing_scope");
      pushExample(issueExample({
        type: "missing_scope",
        label: String(artifact._missing_scope || askObject._missing_scope),
        severity: "medium",
        engine: lane,
        detail: String(lane.ask || ""),
      }));
    }

    const missingTickers = asStringArray(coverage.missing_tickers);
    if (missingTickers.length > 0) {
      const notes = asStringArray(coverage.notes);
      const disclosedComputeNarrativeGap = String(askObject.dependency || "").startsWith("selected_tickers_from_compute:")
        && notes.some((note) => /partial narrative coverage/i.test(note));
      const issueType = disclosedComputeNarrativeGap
        ? "coverage_partial_disclosed"
        : "coverage_missing_tickers";
      addCount(issueCounts, issueType);
      pushExample(issueExample({
        type: issueType,
        label: missingTickers.join(", "),
        severity: disclosedComputeNarrativeGap ? "low" : "high",
        engine: lane,
        detail: String(lane.result_summary || ""),
      }));
    }

    if (String(lane.table_name || "") === "model_build" && /failed|unsupported|not implemented/i.test(String(lane.result_summary || ""))) {
      addCount(issueCounts, "model_build_failed_or_unsupported");
      pushExample(issueExample({
        type: "model_build_failed_or_unsupported",
        label: String(lane.result_summary || "model_build issue"),
        severity: "high",
        engine: lane,
        detail: String(lane.ask || ""),
      }));
    }
    if (
      String(lane.table_name || "") !== "model_build"
      && /lane_failed_no_valid_submit|failed|error/i.test(String(lane.result_summary || ""))
    ) {
      addCount(issueCounts, "lane_failure");
      pushExample(issueExample({
        type: "lane_failure",
        label: `${lane.table_name || "lane"}: ${lane.result_summary || "failed"}`,
        severity: "high",
        engine: lane,
        detail: String(lane.ask || ""),
      }));
    }
  }

  for (const row of feedbackRows) {
    if (row.feedback) addCount(issueCounts, `feedback_${String(row.feedback)}`);
    const rowStatus = String(row.status || "");
    const rowCancelled = rowStatus === "cancelled" || classifyError(row.error) === "cancelled";
    if (rowCancelled && !row.feedback) continue;
    if (row.feedback || rowStatus !== "done" || row.error) {
      if (row.feedback) {
        // Feedback rows are handled by their feedback-specific issue count above.
      } else {
        addCount(issueCounts, "query_log_failure");
      }
    }
    pushExample(issueExample({
      type: row.feedback ? `feedback_${String(row.feedback)}` : rowCancelled ? "cancelled_run" : "query_log_failure",
      label: String(row.feedback_comment || row.error || row.status || "feedback"),
      severity: rowCancelled ? "low" : row.feedback === "down" || row.error ? "high" : "low",
      engine: row,
      detail: String(row.query || ""),
    }));
  }

  return c.json({
    ok: true,
    window_hours: hours,
    scanned: {
      engine_rows: engines.length,
      lane_rows: lanes.length,
      feedback_rows: feedbackRows.length,
    },
    issueCounts: topCounts(issueCounts, 30),
    tickerRequests: topCounts(tickerCounts, 50),
    unresolvedTickerRequests: topCounts(unresolvedTickerCounts, 50),
    outOfUniverseRequests: topCounts(outOfUniverseCounts, 50),
    evalSuggestions: evalSuggestionsForIssues(issueCounts, unresolvedTickerCounts),
    examples,
  });
});

app.get("/api/admin/data-quality/matrix", async (c) => {
  const tokenAdmin = hasAdminBearerToken(c.env, c.req.header("authorization"));
  if (!tokenAdmin) {
    const access = await requireTraceAccess(c);
    if (access instanceof Response) return access;
    if (!access.isAdmin) return c.json({ error: "Forbidden" }, 403);
  }

  const url = new URL(c.req.url);
  const periods = boundedInt(url.searchParams.get("periods") || undefined, 12, 1, 24);
  try {
    return c.json(await buildDataQualityMatrix(c.env, periods));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "data quality matrix failed");
    if (/no such table: data_quality_flags/i.test(message)) {
      return c.json({ ok: false, error: "data_quality_flags table is not loaded in D1 yet" }, 503);
    }
    return c.json({ ok: false, error: message }, 500);
  }
});

app.get("/api/admin/data-quality/ticker/:ticker", async (c) => {
  const tokenAdmin = hasAdminBearerToken(c.env, c.req.header("authorization"));
  if (!tokenAdmin) {
    const access = await requireTraceAccess(c);
    if (access instanceof Response) return access;
    if (!access.isAdmin) return c.json({ error: "Forbidden" }, 403);
  }

  const ticker = c.req.param("ticker").trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,16}$/.test(ticker)) return c.json({ ok: false, error: "Unknown ticker" }, 404);
  const url = new URL(c.req.url);
  const periods = boundedInt(url.searchParams.get("periods") || undefined, 12, 1, 24);
  try {
    const existsResult = await c.env.DB.prepare(`
      SELECT 1 AS found
      WHERE EXISTS (SELECT 1 FROM financial_statements WHERE ticker = ? LIMIT 1)
         OR EXISTS (SELECT 1 FROM financial_documents_new WHERE ticker = ? LIMIT 1)
         OR EXISTS (SELECT 1 FROM data_quality_flags WHERE ticker = ? LIMIT 1)
      LIMIT 1
    `).bind(ticker, ticker, ticker).first<{ found: number }>();
    if (!existsResult?.found) return c.json({ ok: false, error: "Unknown ticker" }, 404);
    return c.json(await buildDataQualityTickerDetail(c.env, ticker, periods));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "data quality ticker detail failed");
    if (/no such table: data_quality_flags/i.test(message)) {
      return c.json({ ok: false, error: "data_quality_flags table is not loaded in D1 yet" }, 503);
    }
    return c.json({ ok: false, error: message }, 500);
  }
});

app.get("/api/admin/traces/:engineId", async (c) => {
  const access = await requireTraceAccess(c);
  if (access instanceof Response) return access;
  await ensureEngineLogsSchema(c.env);
  const engineId = c.req.param("engineId");
  const engineResult = access.isAdmin
    ? await c.env.DB.prepare(`SELECT * FROM engine WHERE id = ? LIMIT 1`).bind(engineId).all()
    : await c.env.DB.prepare(`SELECT * FROM engine WHERE id = ? AND user_id = ? LIMIT 1`).bind(engineId, access.user.id).all();
  const engine = ((engineResult.results || []) as Array<Record<string, unknown>>)[0];
  if (!engine) return c.json({ error: "Trace not found" }, 404);

  const [routerResult, laneResult, analystResult, sourceResult, researchResult] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM router WHERE engine_id = ? ORDER BY created_at ASC`).bind(engineId).all(),
    c.env.DB.prepare(`SELECT * FROM lane WHERE engine_id = ? ORDER BY created_at ASC`).bind(engineId).all(),
    c.env.DB.prepare(`SELECT * FROM analyst WHERE engine_id = ? ORDER BY created_at ASC`).bind(engineId).all(),
    c.env.DB.prepare(`SELECT * FROM sources WHERE engine_id = ? ORDER BY created_at ASC`).bind(engineId).all(),
    c.env.DB.prepare(`SELECT report_json FROM research_runs WHERE engine_id = ?`).bind(engineId).first<{report_json:string}>().catch(() => null),
  ]);

  const routers = ((routerResult.results || []) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    asks: parseJsonField(row.asks_json) || [],
    raw_plan: parseJsonField(row.raw_plan_json),
    normalized_plan: parseJsonField(row.normalized_plan_json),
    final_plan: parseJsonField(row.final_plan_json),
    resolution_context: parseJsonField(row.resolution_context_json),
    runtime_interventions: parseJsonField(row.runtime_interventions_json) || [],
  }));
  const lanes = ((laneResult.results || []) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    message_history: parseJsonField(row.message_history_json) || [],
    sql_queries: parseJsonField(row.sql_queries_json) || [],
    artifact: parseJsonField(row.artifact_json),
    analysis_attachment: parseJsonField(row.analysis_attachment_json),
    provenance_ids: parseJsonField(row.provenance_ids_json) || [],
    narrative_ids: parseJsonField(row.narrative_ids_json) || [],
    runtime_interventions: parseJsonField(row.runtime_interventions_json) || [],
    candidate_preview: parseJsonField(row.candidate_preview_json) || [],
  }));
  const analysts = ((analystResult.results || []) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    analyst_user_message_text: analystUserPayloadFromRow(row),
    messages: parseJsonField(row.messages_json) || [],
    execution_artifacts: parseJsonField(row.execution_artifacts_json) || [],
    computed_tables: parseJsonField(row.computed_tables_json) || [],
    analyst_context: parseJsonField(row.analyst_context_json),
    sources: parseJsonField(row.sources_json) || [],
    attachments: parseJsonField(row.attachments_json) || [],
    citation_trace: parseJsonField(row.citation_trace_json),
    answer_interventions: parseJsonField(row.answer_interventions_json) || [],
  }));
  const sources = ((sourceResult.results || []) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    preview: parseJsonField(row.preview_json),
  }));

  return c.json({
    ok: true,
    trace: {
      engine: {
        ...engine,
        chat_history: parseJsonField(engine.chat_history_json) || [],
        surfaced_sources: parseJsonField(engine.surfaced_sources_json) || [],
      },
      research: researchResult ? JSON.parse(researchResult.report_json) : null,
      router: routers,
      lanes,
      analyst: analysts,
      sources,
    },
  });
});

app.post("/api/internal/eval-query-do", async (c) => {
  if (!allowEvalRequest(c.env, c.req.raw)) {
    return c.json({ error: "Forbidden" }, 403);
  }
	  type EvalDoBody = {
	    query?: string;
	    user_id?: string;
	    user_email?: string;
	    session_id?: string;
	    chat_history?: Array<{ role: string; content: string }>;
	    persist_trace?: boolean;
	  };
  const body: EvalDoBody = await c.req.json<EvalDoBody>().catch(() => ({} as EvalDoBody));
  const query = truncateText(body.query, MAX_QUERY_CHARS);
  if (!query) return c.json({ error: "query required" }, 400);
  let userId: string;
  let sessionId: string;
  try {
    userId = validateSafeId(body.user_id?.trim() || "internal-workspace-test", "user_id");
    sessionId = validateSafeId(body.session_id?.trim() || "internal-workspace-session", "session_id");
  } catch {
    return c.json({ error: "Invalid eval identifiers" }, 400);
  }
  const doId = c.env.CHAT_DO.idFromName(userId);
  const stub = c.env.CHAT_DO.get(doId);
  const response = await stub.fetch("https://do/debug/eval-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      query,
	      chat_history: normalizeChatHistory(body.chat_history),
	      user_id: userId,
	      session_id: sessionId,
	      persist_trace: Boolean(body.persist_trace),
	    }),
	  });
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

app.post("/api/internal/debug-chat-folders", async (c) => {
  if (!allowEvalRequest(c.env, c.req.raw)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  type DebugBody = {
    user_id?: string;
    session_id?: string;
    folder_name?: string;
    search_term?: string;
  };
  const body: DebugBody = await c.req.json<DebugBody>().catch(() => ({} as DebugBody));
  let userId: string;
  let sessionId: string;
  try {
    userId = validateSafeId(body.user_id?.trim() || `debug-folders-${Date.now()}`, "user_id");
    sessionId = validateSafeId(body.session_id?.trim() || `debug-session-${Date.now()}`, "session_id");
  } catch {
    return c.json({ error: "Invalid debug identifiers" }, 400);
  }
  const folderName = truncateText(body.folder_name, 80) || `Debug ${Date.now()}`;
  const searchTerm = truncateText(body.search_term, 80) || "working capital";
  const doId = c.env.CHAT_DO.idFromName(userId);
  const stub = c.env.CHAT_DO.get(doId);
  const now = new Date().toISOString();

  const importResponse = await stub.fetch("https://do/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      messages: [
        {
          id: crypto.randomUUID(),
          session_id: sessionId,
          role: "user",
          content: "Start a test chat about a company.",
          created_at: now,
        },
        {
          id: crypto.randomUUID(),
          session_id: sessionId,
          role: "assistant",
          content: `This internal test mentions ${searchTerm} so content search can find it even when the title does not.`,
          metadata: { status: "done" },
          created_at: now,
        },
      ],
    }),
  });
  const imported = await importResponse.json().catch(() => ({}));

  const createResponse = await stub.fetch("https://do/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: folderName }),
  });
  const folder = await createResponse.json<{ id?: string; name?: string }>().catch((): { id?: string; name?: string } => ({}));
  if (!createResponse.ok || !folder.id) {
    return c.json({ ok: false, step: "create_folder", imported, folder }, 500);
  }

  const assignResponse = await stub.fetch(`https://do/sessions/${encodeURIComponent(sessionId)}/folder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId: folder.id }),
  });
  const assigned = await assignResponse.json().catch(() => ({}));

  const folderSessionsResponse = await stub.fetch(`https://do/sessions?folder=${encodeURIComponent(folder.id)}`);
  const folderSessions = await folderSessionsResponse.json().catch(() => []);
  const searchResponse = await stub.fetch(`https://do/sessions?q=${encodeURIComponent(searchTerm)}`);
  const searchResults = await searchResponse.json().catch(() => []);

  return c.json({
    ok: importResponse.ok && createResponse.ok && assignResponse.ok && folderSessionsResponse.ok && searchResponse.ok,
    userId,
    sessionId,
    folder,
    imported,
    assigned,
    folderSessions,
    searchResults,
  });
});

app.get("/api/models", async (c) => {
  const user = await getUser(c.env, c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const ticker = c.req.query("ticker");
  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);
  const response = await stub.fetch(`https://do/models${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ""}`);
  return new Response(response.body, { status: response.status, headers: response.headers });
});

app.get("/api/models/:modelId", async (c) => {
  const user = await getUser(c.env, c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  let modelId: string;
  try {
    modelId = validateSafeId(c.req.param("modelId"), "modelId");
  } catch {
    return c.json({ error: "Invalid modelId" }, 400);
  }
  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);
  const response = await stub.fetch(`https://do/models/${encodeURIComponent(modelId)}`);
  return new Response(response.body, { status: response.status, headers: response.headers });
});

app.post("/api/models/:modelId/assumptions", async (c) => {
  const user = await getUser(c.env, c.req.header("Authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  let modelId: string;
  try {
    modelId = validateSafeId(c.req.param("modelId"), "modelId");
  } catch {
    return c.json({ error: "Invalid modelId" }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  let bodyText: string;
  try {
    bodyText = jsonSizeBound(body, MAX_EVENT_DATA_CHARS) || "{}";
  } catch {
    return c.json({ error: "assumptions payload too large" }, 400);
  }
  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);
  const response = await stub.fetch(`https://do/models/${encodeURIComponent(modelId)}/assumptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyText,
  });
  return new Response(response.body, { status: response.status, headers: response.headers });
});

app.get("/api/internal/models", async (c) => {
  if (!allowInternalRequest(c.env, c.req.raw)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const url = new URL(c.req.url);
  let userId: string;
  try {
    userId = validateSafeId(url.searchParams.get("user_id")?.trim() || "internal-workspace-test", "user_id");
  } catch {
    return c.json({ error: "Invalid user_id" }, 400);
  }
  const ticker = url.searchParams.get("ticker");
  const doId = c.env.CHAT_DO.idFromName(userId);
  const stub = c.env.CHAT_DO.get(doId);
  const response = await stub.fetch(`https://do/models${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ""}`);
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

// Internal single-query eval endpoint for local/admin benchmarking.
app.post("/api/internal/eval-query", async (c) => {
  if (!allowEvalRequest(c.env, c.req.raw)) {
    return c.json({ error: "Forbidden" }, 403);
  }

	  type EvalQueryBody = {
	    query?: string;
	    user_id?: string;
	    impl?: DeepSeekImplementation;
	    steer_context?: string;
	    chat_history?: Array<{ role: string; content: string }>;
	  };
  const body: EvalQueryBody = await c.req.json<EvalQueryBody>().catch(() => ({} as EvalQueryBody));

  const query = truncateText(body.query, MAX_QUERY_CHARS);
  if (!query) return c.json({ error: "query required" }, 400);
  if (body.impl !== undefined && !isDeepSeekImplementation(body.impl)) {
    return c.json({ error: "impl must be: v5" }, 400);
  }

  const impl = body.impl || "v5";
  let userId = "";
  try {
    userId = typeof body.user_id === "string" ? validateSafeId(body.user_id, "user_id") : "";
  } catch {
    return c.json({ error: "Invalid user_id" }, 400);
  }
  const steerContext = truncateText(body.steer_context, MAX_STEER_CONTEXT_CHARS);
  const chatHistory = normalizeChatHistory(body.chat_history);

  const startedAt = Date.now();
  try {
    const result = await runResearch(c.env, { query, history: chatHistory });
    await persistEngineLogs(c.env, {
      runKind: "eval",
      deepseekImpl: impl,
      query,
      chatHistory,
      userId,
      sessionId: undefined,
      messageId: undefined,
      steerContext,
      status: "done",
      durationMs: Date.now() - startedAt,
      iterations: result.iterations,
      result,
    }).catch(() => {});
    return c.json({
      ok: true,
      impl,
      duration_ms: Date.now() - startedAt,
      iterations: result.iterations,
      answer: result.answer,
      research_report: result.researchReport,
      source_count: result.sources.length,
      sources: result.sources,
      attachment_count: result.attachments.length,
      source_ids: result.sources.map((s) => s.id),
      attachment_summaries: result.attachments.map((a) => ({
        id: a.id,
        title: a.title,
        rows: a.rows.length,
        columns: a.headers.length,
      })),
      data_quality_flags: result.dataQualityFlags || [],
      data_quality_cautions: result.dataQualityCautions || [],
      context_used: result.contextUsed,
      context_percent_used: result.contextPercentUsed,
      scout_input_tokens: result.scoutInputTokens,
      scout_output_tokens: result.scoutOutputTokens,
      analyst_input_tokens: result.analystInputTokens,
      analyst_output_tokens: result.analystOutputTokens,
      scout_context_preview: result.scoutContext
        ? {
            query: (result.scoutContext as { query?: string }).query || "",
            chat_history_count: Array.isArray((result.scoutContext as { chatHistory?: unknown[] }).chatHistory)
              ? ((result.scoutContext as { chatHistory?: unknown[] }).chatHistory as unknown[]).length
              : 0,
            was_steered: !!(result.scoutContext as { steerContext?: string }).steerContext,
          }
        : null,
      analyst_context_preview: result.analystContext
        ? {
            source_count: result.analystContext.sources.length,
            table_count: result.analystContext.computedTables.length,
            sources: result.analystContext.sources.map((s) => ({
              tag: s.tag,
              id: s.preview.id,
              source_type: s.preview.sourceType || null,
              ticker: s.preview.ticker,
              filing_type: s.preview.filingType,
              filing_period: s.preview.filingPeriod,
              filing_year: s.preview.filingYear,
              page_number: s.preview.pageNumber,
              pdf_url: s.preview.pdfUrl,
              thumbnail_url: s.preview.thumbnailUrl,
              snippet: s.preview.snippet,
              content_kind: s.contentKind || "raw_page",
              text_preview: String(s.text || "").slice(0, 220),
            })),
            tables: result.analystContext.computedTables.map((a) => ({
              id: a.id,
              title: a.title,
              row_count: a.rows.length,
              headers: a.headers,
              csv_preview: String(a.csv || "").slice(0, 800),
            })),
          }
        : null,
      execution_artifacts: result.executionArtifacts,
      engine_trace: result.engineTrace,
      analyst_context: result.analystContext,
    });
  } catch (error) {
    return c.json({
      ok: false,
      impl,
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Retired stage-specific execution endpoints. Historical trace reads remain available.
app.post("/api/internal/debug-v5/*", (c) => {
  if (!allowEvalRequest(c.env, c.req.raw)) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ error: "Legacy financial stages are retired. Use /api/internal/eval-query-do for document research." }, 410);
});

// Generate endpoint - now just dispatches to DO
app.post("/api/generate", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  type GenerateBody = { user_prompt?: string; session_id?: string; steer_context?: string; deepseek_impl?: DeepSeekImplementation };
  const body: GenerateBody = await c.req.json<GenerateBody>().catch(() => ({} as GenerateBody));
  const query = truncateText(body.user_prompt, MAX_QUERY_CHARS);
  if (!query) return c.json({ error: "user_prompt required" }, 400);
  if (body.deepseek_impl !== undefined && !isDeepSeekImplementation(body.deepseek_impl)) {
    return c.json({ error: "deepseek_impl must be: v5" }, 400);
  }

  let sessionId: string;
  try {
    sessionId = body.session_id ? validateSafeId(body.session_id, "session_id") : crypto.randomUUID();
  } catch {
    return c.json({ error: "Invalid session_id" }, 400);
  }
  const deepseekImpl = body.deepseek_impl || "v5";

  // Extract steer context if user is redirecting Scout mid-stream
  const steerContext = truncateText(body.steer_context, MAX_STEER_CONTEXT_CHARS);

  // Log that we received the query (fire and forget)
  c.env.DB.prepare(
    `INSERT INTO user_events (id, user_id, user_email, event_type, event_data, session_id, created_at)
     VALUES (?, ?, ?, 'query_received', ?, ?, datetime('now'))`
  )
    .bind(
      crypto.randomUUID(),
      user.id,
      user.email || null,
      JSON.stringify({ query: query.slice(0, 500), steered: !!steerContext, deepseek_impl: deepseekImpl }),
      sessionId
    )
    .run()
    .catch(() => {});

  // Dispatch to user's Durable Object
  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);

  const payload: JobPayload = { sessionId, query, userId: user.id, userEmail: user.email, steerContext, deepseekImpl };

  // Fire and forget - DO processes in background
  const response = await stub.fetch("https://do/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const result = await response.json<{ sessionId: string; assistantMessageId: string }>();
  return c.json(result);
});

// Get sessions list (with optional search)
app.get("/api/sessions", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);

  // Pass search query to DO if provided
  const searchQuery = truncateText(c.req.query("q"), 200) || "";
  const folderId = truncateText(c.req.query("folder"), 100) || "";
  const params = new URLSearchParams();
  if (searchQuery) params.set("q", searchQuery);
  if (folderId) params.set("folder", folderId);
  const doUrl = params.size ? `https://do/sessions?${params.toString()}` : "https://do/sessions";

  const response = await stub.fetch(doUrl);
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});

app.get("/api/folders", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);
  const response = await stub.fetch("https://do/folders");
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});

app.post("/api/folders", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ name?: string }>().catch((): { name?: string } => ({}));
  const name = truncateText(body.name, 80);
  if (!name) return c.json({ error: "Folder name is required" }, 400);

  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);
  const response = await stub.fetch("https://do/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});

// Get messages for a session
app.get("/api/sessions/:sessionId/messages", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  let sessionId: string;
  try {
    sessionId = validateSafeId(c.req.param("sessionId"), "sessionId");
  } catch {
    return c.json({ error: "Invalid sessionId" }, 400);
  }
  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);

  const response = await stub.fetch(`https://do/sessions/${sessionId}/messages`);
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});

// Get single message (for polling fallback)
app.get("/api/messages/:messageId", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  let messageId: string;
  try {
    messageId = validateSafeId(c.req.param("messageId"), "messageId");
  } catch {
    return c.json({ error: "Invalid messageId" }, 400);
  }
  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);

  const response = await stub.fetch(`https://do/messages/${messageId}`);
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});

// Delete a session
app.delete("/api/sessions/:sessionId", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  let sessionId: string;
  try {
    sessionId = validateSafeId(c.req.param("sessionId"), "sessionId");
  } catch {
    return c.json({ error: "Invalid sessionId" }, 400);
  }
  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);

  const response = await stub.fetch(`https://do/sessions/${sessionId}`, {
    method: "DELETE",
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});

app.patch("/api/sessions/:sessionId/folder", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  let sessionId: string;
  try {
    sessionId = validateSafeId(c.req.param("sessionId"), "sessionId");
  } catch {
    return c.json({ error: "Invalid sessionId" }, 400);
  }
  const body = await c.req.json<{ folderId?: string | null }>().catch((): { folderId?: string | null } => ({}));
  let folderId: string | null = null;
  try {
    folderId = typeof body.folderId === "string" && body.folderId.trim()
      ? validateSafeId(body.folderId, "folderId")
      : null;
  } catch {
    return c.json({ error: "Invalid folderId" }, 400);
  }

  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);
  const response = await stub.fetch(`https://do/sessions/${sessionId}/folder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});

app.delete("/api/folders/:folderId", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  let folderId: string;
  try {
    folderId = validateSafeId(c.req.param("folderId"), "folderId");
  } catch {
    return c.json({ error: "Invalid folderId" }, 400);
  }

  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);
  const response = await stub.fetch(`https://do/folders/${folderId}`, { method: "DELETE" });
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});

// Share a session (creates public shareable link)
app.post("/api/sessions/:sessionId/share", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  let sessionId: string;
  try {
    sessionId = validateSafeId(c.req.param("sessionId"), "sessionId");
  } catch {
    return c.json({ error: "Invalid sessionId" }, 400);
  }

  // Fetch messages from user's DO
  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);
  const response = await stub.fetch(`https://do/sessions/${sessionId}/messages`);

  if (!response.ok) return c.json({ error: "Session not found" }, 404);

  const messages = ((await response.json()) as Message[]).slice(0, 100);
  if (!messages.length) return c.json({ error: "Session has no messages" }, 400);

  const shareId = generateShareId();

  const snapshot = {
    messages,
    sharedAt: new Date().toISOString(),
    originalSessionId: sessionId,
  };

  const firstUserMsg = messages.find((m) => m.role === "user");
  const title = firstUserMsg?.content?.slice(0, 100) || "Shared conversation";

  await c.env.DB.prepare(`
    INSERT INTO shared_conversations (id, user_id, user_email, session_id, title, message_count, conversation_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(shareId, user.id, user.email || null, sessionId, title, messages.length, JSON.stringify(snapshot))
    .run();

  // Return a path-based URL so link preview crawlers can see per-conversation metadata.
  // The Pages edge route serves Open Graph tags and forwards browsers into the SPA.
  const baseUrl = publicBaseUrl(c.req.header("origin"));
  return c.json({
    shareId,
    shareUrl: `${baseUrl}/s/${shareId}`,
    canonicalShareUrl: `${baseUrl}/s/${shareId}`,
    legacyShareUrl: `${baseUrl}/#/s/${shareId}`,
  });
});

// Get shared conversation (PUBLIC - no auth required)
app.get("/api/shared/:shareId", async (c) => {
  const shareId = validateShareId(c.req.param("shareId"));
  if (!shareId) return c.json({ error: "Invalid share id" }, 400);

  const result = await c.env.DB.prepare(`
    SELECT title, conversation_snapshot, message_count, created_at
    FROM shared_conversations WHERE id = ?
  `)
    .bind(shareId)
    .first();

  if (!result) return c.json({ error: "Not found" }, 404);

  // Increment view count (fire and forget)
  c.env.DB.prepare(`UPDATE shared_conversations SET view_count = view_count + 1 WHERE id = ?`)
    .bind(shareId)
    .run()
    .catch(() => {});

  const snapshot = JSON.parse(result.conversation_snapshot as string);
  return c.json({
    title: result.title,
    messages: snapshot.messages,
    sharedAt: result.created_at,
    messageCount: result.message_count,
  });
});

// Import a shared conversation into user's account (creates new session)
app.post("/api/sessions/import/:shareId", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const shareId = validateShareId(c.req.param("shareId"));
  if (!shareId) return c.json({ error: "Invalid share id" }, 400);

  // Fetch the shared conversation from D1
  const result = await c.env.DB.prepare(`
    SELECT conversation_snapshot FROM shared_conversations WHERE id = ?
  `)
    .bind(shareId)
    .first();

  if (!result) return c.json({ error: "Shared conversation not found" }, 404);

  const snapshot = JSON.parse(result.conversation_snapshot as string);
  const messages = snapshot.messages as Message[];

  if (!messages || messages.length === 0) {
    return c.json({ error: "No messages to import" }, 400);
  }

  // Create new session ID for this user
  const newSessionId = crypto.randomUUID();

  // Send to user's DO to import the messages
  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);

  const response = await stub.fetch("https://do/import", {
    method: "POST",
    body: JSON.stringify({ sessionId: newSessionId, messages }),
  });

  if (!response.ok) {
    return c.json({ error: "Failed to import conversation" }, 500);
  }

  return c.json({ sessionId: newSessionId, messageCount: messages.length });
});

// Submit feedback for a message
app.post("/api/messages/:messageId/feedback", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  let messageId: string;
  try {
    messageId = validateSafeId(c.req.param("messageId"), "messageId");
  } catch {
    return c.json({ error: "Invalid messageId" }, 400);
  }
  const body = await c.req.json<{ feedback: "positive" | "negative"; comment?: string }>().catch(() => ({} as { feedback?: "positive" | "negative"; comment?: string }));

  if (!body.feedback || !["positive", "negative"].includes(body.feedback)) {
    return c.json({ error: "Invalid feedback value" }, 400);
  }

  try {
    await c.env.DB.prepare(
      `UPDATE query_logs SET feedback = ?, feedback_comment = ?, feedback_at = datetime('now') WHERE message_id = ? AND user_id = ?`
    )
      .bind(body.feedback, truncateText(body.comment, MAX_FEEDBACK_COMMENT_CHARS) || null, messageId, user.id)
      .run();

    return c.json({ success: true });
  } catch {
    return c.json({ error: "Failed to save feedback" }, 500);
  }
});

// Log user engagement events (for funnel analysis)
app.post("/api/events", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ event_type: string; event_data?: Record<string, unknown>; session_id?: string }>().catch(() => ({} as { event_type?: string; event_data?: Record<string, unknown>; session_id?: string }));

  const eventType = truncateText(body.event_type, MAX_EVENT_TYPE_CHARS);
  if (!eventType || !/^[A-Za-z0-9:_-]+$/.test(eventType)) {
    return c.json({ error: "event_type required" }, 400);
  }
  let eventData: string | null = null;
  try {
    eventData = jsonSizeBound(body.event_data, MAX_EVENT_DATA_CHARS);
  } catch {
    return c.json({ error: "event_data too large" }, 400);
  }
  const sessionId = body.session_id ? truncateText(body.session_id, 128) : undefined;

  try {
    await c.env.DB.prepare(
      `INSERT INTO user_events (id, user_id, user_email, event_type, event_data, session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        user.email || null,
        eventType,
        eventData,
        sessionId || null
      )
      .run();

    return c.json({ success: true });
  } catch {
    return c.json({ error: "Failed to log event" }, 500);
  }
});

// Cancel a specific running request
app.post("/api/cancel", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ message_id?: string }>().catch(() => ({ message_id: undefined }));
  let messageId: string;
  try {
    messageId = body.message_id ? validateSafeId(body.message_id, "message_id") : "";
  } catch {
    return c.json({ error: "Invalid message_id" }, 400);
  }
  if (!messageId) {
    return c.json({ error: "message_id required" }, 400);
  }

  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);

  const response = await stub.fetch("https://do/cancel", {
    method: "POST",
    body: JSON.stringify({ message_id: messageId }),
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});


// Debug endpoint - dump all SQLite data
app.get("/api/debug/sqlite", async (c) => {
  const user = await getUser(c.env, c.req.header("authorization"));
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (!isTraceAdminEmail(user.email) && !hasAdminBearerToken(c.env, c.req.header("authorization"))) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const doId = c.env.CHAT_DO.idFromName(user.id);
  const stub = c.env.CHAT_DO.get(doId);

  const response = await stub.fetch("https://do/debug/dump");
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin Endpoints (protected by ADMIN_TOKEN)
// ─────────────────────────────────────────────────────────────────────────────

const adminAuth = (c: { env: Env; req: { header: (name: string) => string | undefined } }) => {
  return hasAdminBearerToken(c.env, c.req.header("authorization"));
};

// Get all query logs (paginated)
app.get("/admin/logs", async (c) => {
  if (!adminAuth(c)) return c.json({ error: "Unauthorized" }, 401);

  const limit = boundedInt(c.req.query("limit"), 50, 1, 200);
  const offset = boundedInt(c.req.query("offset"), 0, 0, 10_000);
  const userId = c.req.query("user_id");

  let sql = `SELECT * FROM query_logs`;
  const params: (string | number)[] = [];

  if (userId) {
    sql += ` WHERE user_id = ?`;
    params.push(userId);
  }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const result = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ logs: result.results, limit, offset });
});

// Get user engagement events
app.get("/admin/events", async (c) => {
  if (!adminAuth(c)) return c.json({ error: "Unauthorized" }, 401);

  const limit = boundedInt(c.req.query("limit"), 100, 1, 500);
  const eventType = c.req.query("event_type");

  let sql = `SELECT * FROM user_events`;
  const params: (string | number)[] = [];

  if (eventType) {
    sql += ` WHERE event_type = ?`;
    params.push(eventType);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const result = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ events: result.results, limit });
});

// Get funnel stats - users who signed up vs queried
app.get("/admin/funnel", async (c) => {
  if (!adminAuth(c)) return c.json({ error: "Unauthorized" }, 401);

  const stats = await c.env.DB.batch([
    // Users who started a query (from events)
    c.env.DB.prepare(`SELECT COUNT(DISTINCT user_email) as started FROM user_events WHERE event_type = 'query_started'`),
    // Users who completed a query (from query_logs)
    c.env.DB.prepare(`SELECT COUNT(DISTINCT user_email) as completed FROM query_logs WHERE status = 'done'`),
    // Users who had failures
    c.env.DB.prepare(`SELECT COUNT(DISTINCT user_email) as failed FROM query_logs WHERE status = 'failed'`),
    // Users who cancelled
    c.env.DB.prepare(`SELECT COUNT(DISTINCT user_email) as cancelled FROM query_logs WHERE status = 'cancelled'`),
    // Users who started but never completed (started - completed)
    c.env.DB.prepare(`
      SELECT COUNT(DISTINCT e.user_email) as started_never_completed
      FROM user_events e
      WHERE e.event_type = 'query_started'
      AND e.user_email NOT IN (SELECT DISTINCT user_email FROM query_logs WHERE user_email IS NOT NULL)
    `),
  ]);

  return c.json({
    started: (stats[0].results?.[0] as { started?: number })?.started ?? 0,
    completed: (stats[1].results?.[0] as { completed?: number })?.completed ?? 0,
    failed: (stats[2].results?.[0] as { failed?: number })?.failed ?? 0,
    cancelled: (stats[3].results?.[0] as { cancelled?: number })?.cancelled ?? 0,
    startedNeverCompleted: (stats[4].results?.[0] as { started_never_completed?: number })?.started_never_completed ?? 0,
  });
});

// Get aggregate stats
app.get("/admin/logs/stats", async (c) => {
  if (!adminAuth(c)) return c.json({ error: "Unauthorized" }, 401);

  const stats = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT COUNT(*) as total_queries FROM query_logs`),
    c.env.DB.prepare(`SELECT COUNT(DISTINCT user_id) as unique_users FROM query_logs`),
    c.env.DB.prepare(`SELECT status, COUNT(*) as count FROM query_logs GROUP BY status`),
    c.env.DB.prepare(`SELECT AVG(duration_ms) as avg_duration, AVG(iterations) as avg_iterations FROM query_logs WHERE status = 'done'`),
    c.env.DB.prepare(`SELECT user_email, COUNT(*) as query_count FROM query_logs GROUP BY user_id ORDER BY query_count DESC LIMIT 10`),
    c.env.DB.prepare(`SELECT DATE(created_at) as date, COUNT(*) as count FROM query_logs GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 14`),
  ]);

  return c.json({
    totalQueries: (stats[0].results?.[0] as { total_queries?: number })?.total_queries ?? 0,
    uniqueUsers: (stats[1].results?.[0] as { unique_users?: number })?.unique_users ?? 0,
    byStatus: stats[2].results,
    averages: stats[3].results?.[0],
    topUsers: stats[4].results,
    dailyCounts: stats[5].results,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Handler (outside Hono for proper upgrade handling)
// ─────────────────────────────────────────────────────────────────────────────

async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  // Extract token from query string (WebSocket can't use headers easily)
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response("Missing token", { status: 401 });
  }

  // Verify token via Supabase
  const user = await getUser(env, `Bearer ${token}`);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Forward to user's DO for WebSocket handling
  const doId = env.CHAT_DO.idFromName(user.id);
  const stub = env.CHAT_DO.get(doId);

  return stub.fetch(request);
}

// ─────────────────────────────────────────────────────────────────────────────
// Durable Object with SQLite Storage + WebSocket
// ─────────────────────────────────────────────────────────────────────────────

export class ChatSessionDO {
  private sql: SqlStorage;
  // Track abort controllers per message for concurrent request support
  private activeRequests = new Map<string, AbortController>();

  constructor(
    private state: DurableObjectState,
    private env: Env
  ) {
    this.sql = state.storage.sql;
    this.initSchema();
    this.state.blockConcurrencyWhile(async () => {
      await ensureEngineLogsSchema(this.env);
    });
  }

  private initSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS research_reports (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, report_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_research_session ON research_reports(session_id, updated_at);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT DEFAULT '',
        sources TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

      CREATE TABLE IF NOT EXISTS user_models (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        ticker TEXT NOT NULL,
        template_id TEXT NOT NULL,
        title TEXT NOT NULL,
        latest_version INTEGER NOT NULL DEFAULT 1,
        summary_json TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        source_trace_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_user_models_ticker ON user_models(ticker, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_user_models_session ON user_models(session_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS user_model_versions (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        change_note TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_user_model_versions_model ON user_model_versions(model_id, version DESC);

      CREATE TABLE IF NOT EXISTS chat_folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS session_folder_assignments (
        session_id TEXT PRIMARY KEY,
        folder_id TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_session_folder_assignments_folder ON session_folder_assignments(folder_id, updated_at DESC);

    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    // Route requests
    if (request.method === "POST" && path === "/generate") {
      return this.handleGenerate(request);
    }
    if (request.method === "GET" && path === "/sessions") {
      const searchQuery = url.searchParams.get("q") || "";
      const folderId = url.searchParams.get("folder") || "";
      return this.handleGetSessions(searchQuery, folderId);
    }
    if (request.method === "GET" && path === "/folders") {
      return this.handleGetFolders();
    }
    if (request.method === "POST" && path === "/folders") {
      return this.handleCreateFolder(request);
    }
    if (request.method === "DELETE" && path.startsWith("/folders/")) {
      const folderId = decodeURIComponent(path.split("/")[2] || "");
      return this.handleDeleteFolder(folderId);
    }
    if (request.method === "GET" && path.startsWith("/sessions/") && path.endsWith("/messages")) {
      const sessionId = path.split("/")[2];
      return this.handleGetMessages(sessionId);
    }
    if (request.method === "PATCH" && path.startsWith("/sessions/") && path.endsWith("/folder")) {
      const sessionId = decodeURIComponent(path.split("/")[2] || "");
      return this.handleAssignSessionFolder(sessionId, request);
    }
    if (request.method === "GET" && path.startsWith("/messages/")) {
      const messageId = path.split("/")[2];
      return this.handleGetMessage(messageId);
    }
    if (request.method === "GET" && path === "/debug/dump") {
      return this.handleDebugDump();
    }
    if (request.method === "POST" && path === "/debug/eval-query") {
      return this.handleDebugEvalQuery(request);
    }
    if (request.method === "GET" && path === "/models") {
      const ticker = url.searchParams.get("ticker") || undefined;
      return this.handleListModels(ticker);
    }
    if (request.method === "GET" && path.startsWith("/models/")) {
      const modelId = decodeURIComponent(path.split("/")[2] || "");
      return this.handleGetModel(modelId);
    }
    if (request.method === "POST" && path.startsWith("/models/") && path.endsWith("/assumptions")) {
      const modelId = decodeURIComponent(path.split("/")[2] || "");
      return this.handleUpdateModelAssumptions(modelId, request);
    }
    if (request.method === "DELETE" && path.startsWith("/sessions/")) {
      const sessionId = path.split("/")[2];
      return this.handleDeleteSession(sessionId);
    }
    if (request.method === "POST" && path === "/cancel") {
      return this.handleCancel(request);
    }
    if (request.method === "POST" && path === "/import") {
      return this.handleImport(request);
    }

    return new Response("Not found", { status: 404 });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WebSocket Handling
  // ─────────────────────────────────────────────────────────────────────────

  private handleWebSocketUpgrade(_request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket and attach to hibernation API
    this.state.acceptWebSocket(server);

    // Send connected confirmation
    server.send(JSON.stringify({ type: "connected" } as WsMessage));

    return new Response(null, { status: 101, webSocket: client });
  }

  // Called when a WebSocket message is received
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Handle ping/pong or subscribe messages if needed
    if (typeof message === "string") {
      try {
        const data = JSON.parse(message);
        if (data.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // Ignore invalid JSON
      }
    }
  }

  // Called when a WebSocket is closed
  async webSocketClose(_ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    // Cleanup handled automatically by hibernation API
    console.log(`WebSocket closed: ${code} ${reason}`);
  }

  // Called when a WebSocket error occurs
  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error("WebSocket error:", error);
  }

  // Broadcast a message to all connected WebSocket clients
  private broadcast(message: WsMessage): void {
    const sockets = this.state.getWebSockets();
    const payload = JSON.stringify(message);
    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch {
        // Socket might be closed, ignore
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Message Generation
  // ─────────────────────────────────────────────────────────────────────────

  private async handleGenerate(request: Request): Promise<Response> {
    const payload = (await request.json()) as JobPayload;
    const { sessionId, query, userId, userEmail, steerContext, deepseekImpl } = payload;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return Response.json({ error: "user_prompt required" }, { status: 400 });
    }

    // Create user message
    const userMsgId = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, 'user', ?)`,
      userMsgId,
      sessionId,
      query
    );

    // Create assistant message placeholder
    const assistantMsgId = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO messages (id, session_id, role, content, metadata) VALUES (?, ?, 'assistant', '', ?)`,
      assistantMsgId,
      sessionId,
      JSON.stringify({ status: "running" })
    );

    // Broadcast new message to WebSocket clients
    this.broadcast({
      type: "message_update",
      messageId: assistantMsgId,
      sessionId,
      data: { status: "running", content: "" },
    });

    // Run request concurrently (no queue - each window runs independently)
    this.state.waitUntil(
      this.process(sessionId, assistantMsgId, userMsgId, query, userId, userEmail, steerContext, deepseekImpl)
    );

    return Response.json({ sessionId, assistantMessageId: assistantMsgId });
  }

  private async process(
    sessionId: string,
    messageId: string,
    userMessageId: string,
    query: string,
    userId?: string,
    userEmail?: string,
    steerContext?: string,
    deepseekImpl: DeepSeekImplementation = "v5"
  ): Promise<void> {
    const startTime = Date.now();
    let status: "done" | "failed" | "cancelled" = "done";
    let iterations = 0;
    let errorMsg: string | undefined;
    let answerText: string | undefined;
    let scoutInputTokens: number | undefined;
    let scoutOutputTokens: number | undefined;
    let analystInputTokens: number | undefined;
    let analystOutputTokens: number | undefined;
    let wasSteered = !!steerContext;  // Track if user steered Scout
    let engineResult: EngineDeepSeekResult | undefined;
    let latestCheckpoints: ThoughtProcessCheckpoint[] | undefined;
    let latestResearch: ResearchSummary | undefined;
    let partialContent = "";
    let history: Array<{ role: string; content: string }> = [];
    let priorHistory: Array<{ role: string; content: string }> = [];
    let isFollowOn = false;

    // Create and track AbortController for this request
    const abortController = new AbortController();
    this.activeRequests.set(messageId, abortController);

    try {
      history = this.getChatHistory(sessionId);
      priorHistory = this.getChatHistoryBeforeMessage(sessionId, userMessageId);
      isFollowOn = priorHistory.length > 0;

      // Update status to running
      this.updateMessage(messageId, sessionId, { status: "running" });

      const deterministicGuardrail = !isTraceAdminEmail(userEmail) && isInternalInfoQuery(query)
        ? { name: "internal_info", answer: internalInfoResponse() }
        : isProductCapabilitiesQuery(query)
          ? { name: "product_capabilities", answer: productCapabilitiesResponse() }
          : null;
      if (deterministicGuardrail) {
        answerText = deterministicGuardrail.answer;
        iterations = 0;
        const finalMetadata = {
          isFollowOn,
          status: "done",
          deepseekImpl,
          completedAt: new Date().toISOString(),
          guardrail: deterministicGuardrail.name,
          attachments: [],
          executionArtifacts: [],
          checkpoints: latestCheckpoints,
        };
        this.sql.exec(
          `UPDATE messages SET content = ?, sources = ?, metadata = ? WHERE id = ?`,
          answerText,
          JSON.stringify([]),
          JSON.stringify(finalMetadata),
          messageId
        );
        this.broadcast({
          type: "message_update",
          messageId,
          sessionId,
          data: {
            status: "done",
            content: answerText,
            sources: [],
            attachments: [],
            metadata: finalMetadata,
          },
        });
        return;
      }

      // Research original documents and publish independently completing sections.
      const result = await runResearch(this.env, {
        query,
        history: priorHistory,
        onUpdate: async (statusUpdate, _thinking, content, stream) => {
          if (abortController.signal.aborted) return;
          if (stream?.checkpoints) latestCheckpoints = stream.checkpoints;
          if (stream?.research) latestResearch = stream.research;
          if (content) { partialContent = content; answerText = content; }
          const streamMetadata = {
            step: statusUpdate,
            research: latestResearch,
            checkpoints: stream?.checkpoints ?? latestCheckpoints,
          };
          // Persist visible progress so reload/cancellation retains completed sections.
          this.sql.exec('UPDATE messages SET content=?, sources=?, metadata=? WHERE id=?', partialContent, JSON.stringify(stream?.sources || []), JSON.stringify({status:'running',...streamMetadata}), messageId);
          // Broadcast streaming content if available
          if (content) {
            this.broadcast({
              type: "message_update",
              messageId,
              sessionId,
              data: {
                status: "running",
                content,
                sources: stream?.sources,
                metadata: streamMetadata,
              },
            });
          } else {
            this.updateMessage(messageId, sessionId, {
              status: "running",
              metadata: streamMetadata,
            });
          }
        },
        signal: abortController.signal,
        previousReport: this.getResearchReport(sessionId),
        saveReport: (report) => this.saveResearchReport(sessionId, report),
      });
      engineResult = result;
      status = result.researchReport?.sections.every(s => s.status === "failed") ? "failed" : "done";

      iterations = result.iterations;
      answerText = result.answer;
      scoutInputTokens = result.scoutInputTokens;
      scoutOutputTokens = result.scoutOutputTokens;
      analystInputTokens = result.analystInputTokens;
      analystOutputTokens = result.analystOutputTokens;
      wasSteered = result.wasSteered;

      // Save final result
      const finalMetadata = {
        status,
        partial: result.researchReport?.sections.some(s => s.status !== "complete"),
        deepseekImpl,
        completedAt: new Date().toISOString(),
        iterations: result.iterations,
        scoutReasoning: result.scoutReasoning,
        analystReasoning: result.analystReasoning,
        // Per-turn context (includes reasoning - internal metric)
        contextUsed: result.contextUsed,
        contextRemaining: result.contextRemaining,
        contextPercentUsed: result.contextPercentUsed,
        // Conversation-level context (excludes reasoning - user-facing metric)
        conversationContextUsed: result.conversationContextUsed,
        conversationContextRemaining: result.conversationContextRemaining,
        conversationContextPercent: result.conversationContextPercent,
        // Flag to show user when history was compressed
        historyWasCompressed: result.historyWasCompressed,
        // Follow-on signal is deterministic and used by routing/eval diagnostics
        isFollowOn,
        // Data attachments (tables for CSV download)
        attachments: result.attachments,
        dataQualityFlags: result.dataQualityFlags || [],
        dataQualityCautions: result.dataQualityCautions || [],
        executionArtifacts: result.executionArtifacts,
        research: latestResearch,
        // Research progress from actual tool calls
        checkpoints: latestCheckpoints,
      };

      this.sql.exec(
        `UPDATE messages SET content = ?, sources = ?, metadata = ? WHERE id = ?`,
        result.answer,
        JSON.stringify(result.sources),
        JSON.stringify(finalMetadata),
        messageId
      );

      // Broadcast completion
      this.broadcast({
        type: "message_update",
        messageId,
        sessionId,
        data: {
          status,
          content: result.answer,
          sources: result.sources,
          attachments: result.attachments,
          metadata: finalMetadata,
        },
      });
    } catch (error) {
      // Check if this was an abort (cancellation)
      if (error instanceof Error && error.name === "AbortError") {
        status = "cancelled";
        // Message already updated by handleCancel, just log it
        errorMsg = "Cancelled by user";
      } else {
        status = "failed";
        errorMsg = sanitizeUserFacingError(error);
        const errorMetadata = { status: "failed", error: errorMsg, research: latestResearch, checkpoints: latestCheckpoints };

        this.sql.exec(
          `UPDATE messages SET content = ?, metadata = ? WHERE id = ?`,
          partialContent ? `${partialContent}\n\n*Research interrupted: ${errorMsg}*` : `Something went wrong: ${errorMsg}`,
          JSON.stringify(errorMetadata),
          messageId
        );

        // Broadcast failure
        this.broadcast({
          type: "message_update",
          messageId,
          sessionId,
          data: {
            status: "failed",
            content: partialContent ? `${partialContent}\n\n*Research interrupted: ${errorMsg}*` : `Something went wrong: ${errorMsg}`,
            metadata: errorMetadata,
          },
        });
      }
    } finally {
      // Clean up abort controller tracking
      this.activeRequests.delete(messageId);
    }

    // Async log to D1 - fire and forget
    if (userId) {
      const durationMs = Date.now() - startTime;
      this.state.waitUntil(
        this.env.DB.prepare(
        `INSERT INTO query_logs (id, user_id, user_email, session_id, message_id, query, answer, status, iterations, duration_ms, error, scout_input_tokens, scout_output_tokens, analyst_input_tokens, analyst_output_tokens, was_steered, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        )
          .bind(
            crypto.randomUUID(),
            userId,
            userEmail || null,
            sessionId,
            messageId,
            query.slice(0, 500),
            answerText || null,
            status,
            iterations,
            durationMs,
            errorMsg || null,
            scoutInputTokens || 0,
            scoutOutputTokens || 0,
            analystInputTokens || 0,
            analystOutputTokens || 0,
            wasSteered ? 1 : 0
          )
          .run()
          .catch(() => {})
      );

      // Log steering event to user_events for analytics
      if (wasSteered) {
        this.state.waitUntil(
          this.env.DB.prepare(
            `INSERT INTO user_events (id, user_id, user_email, event_type, event_data, session_id, created_at)
             VALUES (?, ?, ?, 'scout_steered', ?, ?, datetime('now'))`
          )
            .bind(crypto.randomUUID(), userId, userEmail || null, JSON.stringify({ query: query.slice(0, 200) }), sessionId)
            .run()
            .catch(() => {})
        );
      }

      this.state.waitUntil(
        persistEngineLogs(this.env, {
          runKind: "user",
          deepseekImpl,
          query,
          chatHistory: history,
          userId,
          userEmail,
          sessionId,
          messageId,
          steerContext,
          status,
          error: errorMsg,
          durationMs,
          iterations,
          result: engineResult,
        }).catch(() => {})
      );
    }
  }

  private updateMessage(
    messageId: string,
    sessionId: string,
    updates: { status?: string; metadata?: Record<string, unknown> }
  ): void {
    const metadata: Record<string, unknown> = {
      ...updates.metadata,
      status: updates.status,
      lastHeartbeatAt: new Date().toISOString(),
    };
    this.sql.exec(
      `UPDATE messages SET metadata = ? WHERE id = ?`,
      JSON.stringify(metadata),
      messageId
    );

    // Broadcast update to WebSocket clients
    this.broadcast({
      type: "message_update",
      messageId,
      sessionId,
      data: { status: updates.status, metadata },
    });
  }

  private getChatHistory(sessionId: string): Array<{ role: string; content: string }> {
    const cursor = this.sql.exec(
      `SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 10`,
      sessionId
    );
    const rows: Array<{ role: string; content: string }> = [];
    for (const row of cursor) {
      rows.push({ role: row.role as string, content: row.content as string });
    }
    return rows.reverse(); // oldest first
  }

  private getChatHistoryBeforeMessage(sessionId: string, messageId: string): Array<{ role: string; content: string }> {
    const cursor = this.sql.exec(
      `SELECT role, content
       FROM messages
       WHERE session_id = ?
         AND rowid < (SELECT rowid FROM messages WHERE id = ?)
       ORDER BY rowid DESC
       LIMIT 10`,
      sessionId,
      messageId
    );
    const rows: Array<{ role: string; content: string }> = [];
    for (const row of cursor) {
      rows.push({ role: row.role as string, content: row.content as string });
    }
    return rows.reverse(); // oldest first
  }

  private historicalModels(): Pick<UserWorkspace, "listModels" | "getModel"> {
    const listModels = async (query?: { ticker?: string; limit?: number }): Promise<SavedModelSummary[]> => {
      const limit = Math.max(1, Math.min(50, query?.limit || 10));
      const ticker = query?.ticker?.trim().toUpperCase();
      const sql = ticker
        ? `SELECT id, session_id, ticker, template_id, title, latest_version, summary_json, updated_at
           FROM user_models WHERE ticker = ? ORDER BY updated_at DESC LIMIT ?`
        : `SELECT id, session_id, ticker, template_id, title, latest_version, summary_json, updated_at
           FROM user_models ORDER BY updated_at DESC LIMIT ?`;
      const cursor = ticker
        ? this.sql.exec(sql, ticker, limit)
        : this.sql.exec(sql, limit);
      const models: SavedModelSummary[] = [];
      for (const row of cursor) {
        const summary = parseJsonField<Record<string, unknown>>(row.summary_json) || {};
        models.push({
          id: String(row.id || ""),
          ticker: String(row.ticker || ""),
          template_id: String(row.template_id || ""),
          title: String(row.title || ""),
          latest_version: Number(row.latest_version || 1),
          summary: String(summary.summary || ""),
          session_id: row.session_id ? String(row.session_id) : undefined,
          updated_at: row.updated_at ? String(row.updated_at) : undefined,
        });
      }
      return models;
    };

    const getModel = async (modelId: string): Promise<SavedModelSnapshot | null> => {
      const cursor = this.sql.exec(
        `SELECT snapshot_json, latest_version, updated_at FROM user_models WHERE id = ? LIMIT 1`,
        modelId,
      );
      for (const row of cursor) {
        const snapshot = parseJsonField<SavedModelSnapshot>(row.snapshot_json);
        if (!snapshot) return null;
        snapshot.version = Number(row.latest_version || snapshot.version || 1);
        snapshot.updated_at = row.updated_at ? String(row.updated_at) : snapshot.updated_at;
        return snapshot;
      }
      return null;
    };

    return { listModels, getModel };
  }

  private async handleListModels(ticker?: string): Promise<Response> {
    const workspace = this.historicalModels();
    const models = await workspace.listModels({ ticker, limit: 50 });
    return Response.json({ ok: true, models });
  }

  private async handleGetModel(modelId: string): Promise<Response> {
    if (!modelId) return Response.json({ error: "model_id required" }, { status: 400 });
    const workspace = this.historicalModels();
    const model = await workspace.getModel(modelId);
    if (!model) return Response.json({ error: "model not found" }, { status: 404 });
    return Response.json({ ok: true, model });
  }

  private async handleUpdateModelAssumptions(_modelId: string, _request: Request): Promise<Response> {
    return Response.json({ error: "Saved financial models are read-only. Ask a research question using the original filings." }, { status: 410 });
  }

  private getResearchReport(sessionId: string): ResearchReport | undefined {
    for (const row of this.sql.exec('SELECT report_json FROM research_reports WHERE session_id=? ORDER BY updated_at DESC LIMIT 1', sessionId)) {
      return JSON.parse(row.report_json as string) as ResearchReport;
    }
  }

  private saveResearchReport(sessionId: string, report: ResearchReport): void {
    this.sql.exec('INSERT INTO research_reports (id,session_id,report_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET report_json=excluded.report_json', report.id,sessionId,JSON.stringify(report),Date.now());
  }

  private async handleDebugEvalQuery(request: Request): Promise<Response> {
    const body = await request.json<{
      query?: string;
      session_id?: string;
	      user_id?: string;
	      user_email?: string;
	      chat_history?: Array<{ role: string; content: string }>;
	      persist_trace?: boolean;
	    }>().catch(() => ({} as {
	      query?: string;
	      session_id?: string;
	      user_id?: string;
	      user_email?: string;
	      chat_history?: Array<{ role: string; content: string }>;
	      persist_trace?: boolean;
	    }));
    const query = body.query?.trim();
    if (!query) return Response.json({ error: "query required" }, { status: 400 });
    const sessionId = body.session_id || "debug-session";
    const userId = body.user_id || "debug-user";
    const userEmail = body.user_email || "";
    const deterministicGuardrail = !isTraceAdminEmail(userEmail) && isInternalInfoQuery(query)
      ? { name: "internal_info", answer: internalInfoResponse() }
      : isProductCapabilitiesQuery(query)
        ? { name: "product_capabilities", answer: productCapabilitiesResponse() }
        : null;
    if (deterministicGuardrail) {
      return Response.json({
        ok: true,
        duration_ms: 0,
        iterations: 0,
        answer: deterministicGuardrail.answer,
        attachment_summaries: [],
        execution_tables: [],
        model_summaries: [],
        engine_trace: {
          router: null,
          lanes: [],
          analyst: null,
          guardrail: deterministicGuardrail.name,
        },
        analyst_context: null,
        execution_artifacts: [],
        analyst_context_preview: null,
      });
    }
    const history = Array.isArray(body.chat_history)
      ? body.chat_history.filter((message) =>
        (message.role === "user" || message.role === "assistant") && typeof message.content === "string"
      )
      : this.getChatHistory(sessionId);
    const startedAt = Date.now();
    const result = await runResearch(this.env, {
      query, history,
      previousReport: this.getResearchReport(sessionId),
      saveReport: (report) => this.saveResearchReport(sessionId, report),
    });
    const durationMs = Date.now() - startedAt;
    let engineId: string | null = null;
    if (body.persist_trace) {
      engineId = await persistEngineLogs(this.env, {
        runKind: "eval",
        deepseekImpl: "v5",
        query,
        chatHistory: history,
        userId,
        userEmail,
        sessionId,
        status: result.researchReport?.sections.every(s => s.status === "failed") ? "failed" : "done",
        durationMs,
        iterations: result.iterations,
        result,
      });
    }
    return Response.json({
      ok: true,
      engine_id: engineId,
      trace_url_path: engineId ? `/trace/${engineId}` : null,
      duration_ms: durationMs,
      iterations: result.iterations,
      answer: result.answer,
      research_report: result.researchReport,
      source_count: result.sources.length,
      sources: result.sources,
      attachment_summaries: result.attachments.map((attachment) => ({
        id: attachment.id,
        title: attachment.title,
        rows: attachment.rows.length,
        columns: attachment.headers.length,
      })),
      execution_tables: result.executionArtifacts.map((artifact) => artifact.table),
      model_summaries: [],
      engine_trace: result.engineTrace,
      analyst_context: result.analystContext,
      execution_artifacts: result.executionArtifacts,
      analyst_context_preview: result.analystContext
        ? {
          table_count: result.analystContext.computedTables.length,
          source_count: result.analystContext.sources.length,
          execution_tables: result.analystContext.executions.map((execution) => execution.table),
        }
        : null,
    });
  }


  // ─────────────────────────────────────────────────────────────────────────
  // CRUD Operations
  // ─────────────────────────────────────────────────────────────────────────

  private matchSnippet(content: string, query: string): string {
    const text = content.replace(/\s+/g, " ").trim();
    if (!query) return text.slice(0, 160);
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index < 0) return text.slice(0, 160);
    const start = Math.max(0, index - 56);
    const end = Math.min(text.length, index + query.length + 96);
    return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  }

  private handleGetSessions(searchQuery: string = "", folderId: string = ""): Response {
    const trimmedQuery = searchQuery.trim();
    const trimmedFolder = folderId.trim();
    console.log("[DO] handleGetSessions called with query:", JSON.stringify(trimmedQuery), "folder:", JSON.stringify(trimmedFolder));

    // If no search query, return recent sessions
    if (!trimmedQuery) {
      const sql = trimmedFolder ? `
        SELECT
          m.session_id,
          MAX(m.created_at) as last_message_at,
          COUNT(*) as message_count,
          (SELECT content FROM messages WHERE session_id = m.session_id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_prompt,
          sfa.folder_id,
          cf.name as folder_name
        FROM messages m
        JOIN session_folder_assignments sfa ON sfa.session_id = m.session_id AND sfa.folder_id = ?
        LEFT JOIN chat_folders cf ON cf.id = sfa.folder_id
        GROUP BY m.session_id
        ORDER BY last_message_at DESC
        LIMIT 50
      ` : `
        SELECT
          m.session_id,
          MAX(m.created_at) as last_message_at,
          COUNT(*) as message_count,
          (SELECT content FROM messages WHERE session_id = m.session_id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_prompt,
          sfa.folder_id,
          cf.name as folder_name
        FROM messages m
        LEFT JOIN session_folder_assignments sfa ON sfa.session_id = m.session_id
        LEFT JOIN chat_folders cf ON cf.id = sfa.folder_id
        GROUP BY m.session_id
        ORDER BY last_message_at DESC
        LIMIT 50
      `;
      const cursor = trimmedFolder ? this.sql.exec(sql, trimmedFolder) : this.sql.exec(sql);
      const sessions = [];
      for (const row of cursor) {
        sessions.push({
          id: row.session_id,
          query: row.first_prompt || "Untitled chat",
          createdAt: row.last_message_at,
          messageCount: row.message_count,
          folderId: row.folder_id || null,
          folderName: row.folder_name || null,
        });
      }
      return Response.json(sessions);
    }

    // Search across full chat content, not only the first prompt/title.
    const searchPattern = `%${trimmedQuery}%`;
    const sql = trimmedFolder ? `
      SELECT
        ss.session_id,
        ss.last_message_at,
        ss.message_count,
        ss.first_prompt,
        sfa.folder_id,
        cf.name as folder_name,
        (SELECT role FROM messages mm WHERE mm.session_id = ss.session_id AND mm.content LIKE ? ORDER BY mm.created_at ASC LIMIT 1) as match_role,
        (SELECT content FROM messages mm WHERE mm.session_id = ss.session_id AND mm.content LIKE ? ORDER BY mm.created_at ASC LIMIT 1) as match_content
      FROM (
        SELECT
          m.session_id,
          MAX(m.created_at) as last_message_at,
          COUNT(*) as message_count,
          (SELECT content FROM messages WHERE session_id = m.session_id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_prompt
        FROM messages m
        GROUP BY m.session_id
      ) ss
      JOIN session_folder_assignments sfa ON sfa.session_id = ss.session_id AND sfa.folder_id = ?
      LEFT JOIN chat_folders cf ON cf.id = sfa.folder_id
      WHERE EXISTS (SELECT 1 FROM messages mm WHERE mm.session_id = ss.session_id AND mm.content LIKE ?)
      ORDER BY last_message_at DESC
      LIMIT 50
    ` : `
      SELECT
        ss.session_id,
        ss.last_message_at,
        ss.message_count,
        ss.first_prompt,
        sfa.folder_id,
        cf.name as folder_name,
        (SELECT role FROM messages mm WHERE mm.session_id = ss.session_id AND mm.content LIKE ? ORDER BY mm.created_at ASC LIMIT 1) as match_role,
        (SELECT content FROM messages mm WHERE mm.session_id = ss.session_id AND mm.content LIKE ? ORDER BY mm.created_at ASC LIMIT 1) as match_content
      FROM (
        SELECT
          m.session_id,
          MAX(m.created_at) as last_message_at,
          COUNT(*) as message_count,
          (SELECT content FROM messages WHERE session_id = m.session_id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_prompt
        FROM messages m
        GROUP BY m.session_id
      ) ss
      LEFT JOIN session_folder_assignments sfa ON sfa.session_id = ss.session_id
      LEFT JOIN chat_folders cf ON cf.id = sfa.folder_id
      WHERE EXISTS (SELECT 1 FROM messages mm WHERE mm.session_id = ss.session_id AND mm.content LIKE ?)
      ORDER BY last_message_at DESC
      LIMIT 50
    `;
    const cursor = trimmedFolder
      ? this.sql.exec(sql, searchPattern, searchPattern, trimmedFolder, searchPattern)
      : this.sql.exec(sql, searchPattern, searchPattern, searchPattern);

    const sessions = [];
    for (const row of cursor) {
      const matchContent = String(row.match_content || row.first_prompt || "");
      sessions.push({
        id: row.session_id,
        query: row.first_prompt || "Untitled chat",
        createdAt: row.last_message_at,
        messageCount: row.message_count,
        folderId: row.folder_id || null,
        folderName: row.folder_name || null,
        matchRole: row.match_role || null,
        matchSnippet: this.matchSnippet(matchContent, trimmedQuery),
      });
    }
    console.log("[DO] Search returning", sessions.length, "results for query:", JSON.stringify(trimmedQuery));
    return Response.json(sessions);
  }

  private handleGetFolders(): Response {
    const cursor = this.sql.exec(`
      SELECT
        f.id,
        f.name,
        f.created_at,
        f.updated_at,
        COUNT(sfa.session_id) as chat_count
      FROM chat_folders f
      LEFT JOIN session_folder_assignments sfa ON sfa.folder_id = f.id
      GROUP BY f.id
      ORDER BY lower(f.name) ASC
    `);
    const folders = [];
    for (const row of cursor) {
      folders.push({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        chatCount: row.chat_count,
      });
    }
    return Response.json(folders);
  }

  private async handleCreateFolder(request: Request): Promise<Response> {
    const body = await request.json<{ name?: string }>().catch((): { name?: string } => ({}));
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return Response.json({ error: "Folder name is required" }, { status: 400 });
    const existing = this.sql.exec(`SELECT id, name FROM chat_folders WHERE lower(name) = lower(?) LIMIT 1`, name);
    for (const row of existing) {
      return Response.json({ id: row.id, name: row.name, existing: true });
    }
    const id = crypto.randomUUID();
    this.sql.exec(`INSERT INTO chat_folders (id, name) VALUES (?, ?)`, id, name);
    return Response.json({ id, name });
  }

  private handleDeleteFolder(folderId: string): Response {
    try {
      validateSafeId(folderId, "folderId");
    } catch {
      return Response.json({ error: "Invalid folderId" }, { status: 400 });
    }
    this.sql.exec(`DELETE FROM session_folder_assignments WHERE folder_id = ?`, folderId);
    this.sql.exec(`DELETE FROM chat_folders WHERE id = ?`, folderId);
    return Response.json({ success: true, folderId });
  }

  private async handleAssignSessionFolder(sessionId: string, request: Request): Promise<Response> {
    try {
      validateSafeId(sessionId, "sessionId");
    } catch {
      return Response.json({ error: "Invalid sessionId" }, { status: 400 });
    }
    const body = await request.json<{ folderId?: string | null }>().catch((): { folderId?: string | null } => ({}));
    const folderId = typeof body.folderId === "string" && body.folderId.trim() ? body.folderId.trim() : null;
    if (!folderId) {
      this.sql.exec(`DELETE FROM session_folder_assignments WHERE session_id = ?`, sessionId);
      return Response.json({ success: true, sessionId, folderId: null });
    }
    try {
      validateSafeId(folderId, "folderId");
    } catch {
      return Response.json({ error: "Invalid folderId" }, { status: 400 });
    }
    const exists = this.sql.exec(`SELECT id FROM chat_folders WHERE id = ? LIMIT 1`, folderId);
    let found = false;
    for (const _row of exists) found = true;
    if (!found) return Response.json({ error: "Folder not found" }, { status: 404 });
    this.sql.exec(`
      INSERT INTO session_folder_assignments (session_id, folder_id, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET folder_id = excluded.folder_id, updated_at = excluded.updated_at
    `, sessionId, folderId);
    return Response.json({ success: true, sessionId, folderId });
  }

  private handleGetMessages(sessionId: string): Response {
    const cursor = this.sql.exec(
      `SELECT id, session_id, role, content, sources, metadata, created_at
       FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
      sessionId
    );
    const messages: Message[] = [];
    for (const row of cursor) {
      messages.push({
        id: row.id as string,
        session_id: row.session_id as string,
        role: row.role as "user" | "assistant",
        content: row.content as string,
        sources: row.sources ? JSON.parse(row.sources as string) : null,
        metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
        created_at: row.created_at as string,
      });
    }
    return Response.json(messages);
  }

  private handleGetMessage(messageId: string): Response {
    const cursor = this.sql.exec(
      `SELECT id, session_id, role, content, sources, metadata, created_at
       FROM messages WHERE id = ?`,
      messageId
    );
    for (const row of cursor) {
      return Response.json({
        id: row.id as string,
        session_id: row.session_id as string,
        role: row.role as "user" | "assistant",
        content: row.content as string,
        sources: row.sources ? JSON.parse(row.sources as string) : null,
        metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
        created_at: row.created_at as string,
      });
    }
    return Response.json({ error: "Message not found" }, { status: 404 });
  }

  private handleDeleteSession(sessionId: string): Response {
    this.sql.exec(`DELETE FROM messages WHERE session_id = ?`, sessionId);
    this.sql.exec(`DELETE FROM research_reports WHERE session_id = ?`, sessionId);
    this.sql.exec(`DELETE FROM session_folder_assignments WHERE session_id = ?`, sessionId);

    // Broadcast session deletion
    this.broadcast({
      type: "session_update",
      sessionId,
      data: { deleted: true },
    });

    return Response.json({ success: true, sessionId });
  }

  private async handleCancel(request: Request): Promise<Response> {
    const body = await request.json<{ message_id?: string }>().catch(() => ({ message_id: undefined }));
    const messageId = body.message_id;

    if (!messageId) {
      return Response.json({ success: false, error: "message_id required" }, { status: 400 });
    }

    const abortController = this.activeRequests.get(messageId);
    if (!abortController) {
      return Response.json({ success: false, error: "No active request for this message" });
    }

    // Abort the request
    abortController.abort();
    this.activeRequests.delete(messageId);

    // Get session ID for the message being cancelled
    const cursor = this.sql.exec(
      `SELECT session_id, content, metadata FROM messages WHERE id = ?`,
      messageId
    );
    let sessionId: string | null = null;
    let content = "";
    let metadata: Record<string, unknown> = {};
    for (const row of cursor) {
      sessionId = row.session_id as string;
      content = String(row.content || "");
      metadata = row.metadata ? JSON.parse(String(row.metadata)) : {};
    }

    // Update message status to cancelled
    const cancelMetadata = { ...metadata, status: "cancelled", cancelledAt: new Date().toISOString() };
    this.sql.exec(
      `UPDATE messages SET content = ?, metadata = ? WHERE id = ?`,
      content || "Research stopped.",
      JSON.stringify(cancelMetadata),
      messageId
    );

    // Broadcast cancellation
    if (sessionId) {
      this.broadcast({
        type: "message_update",
        messageId,
        sessionId,
        data: {
          status: "cancelled",
          content: content || "Research stopped.",
          metadata: cancelMetadata,
        },
      });
    }

    return Response.json({ success: true, messageId });
  }

  private async handleImport(request: Request): Promise<Response> {
    try {
      const { sessionId, messages } = (await request.json()) as {
        sessionId: string;
        messages: Message[];
      };

      if (!sessionId || !messages || !Array.isArray(messages)) {
        return Response.json({ error: "Invalid import payload" }, { status: 400 });
      }

      // Import each message with new IDs but preserve content, sources, and metadata
      for (const msg of messages) {
        const newId = crypto.randomUUID();
        const sources = msg.sources ? JSON.stringify(msg.sources) : null;
        // Preserve metadata but ensure status is 'done' for imported messages
        const metadata = msg.metadata
          ? JSON.stringify({ ...msg.metadata, status: "done", imported: true })
          : JSON.stringify({ status: "done", imported: true });

        this.sql.exec(
          `INSERT INTO messages (id, session_id, role, content, sources, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          newId,
          sessionId,
          msg.role,
          msg.content,
          sources,
          metadata,
          msg.created_at || new Date().toISOString()
        );
      }

      // Broadcast session update
      this.broadcast({
        type: "session_update",
        sessionId,
        data: { imported: true, messageCount: messages.length },
      });

      return Response.json({ success: true, sessionId, messageCount: messages.length });
    } catch (err) {
      console.error("Import failed:", err);
      return Response.json({ error: "Import failed" }, { status: 500 });
    }
  }

  private handleDebugDump(): Response {
    const tableInfo = [];
    for (const row of this.sql.exec("SELECT name FROM sqlite_master WHERE type='table'")) {
      tableInfo.push(row.name);
    }

    const messages: Message[] = [];
    const cursor = this.sql.exec(
      `SELECT id, session_id, role, content, sources, metadata, created_at
       FROM messages ORDER BY created_at DESC LIMIT 100`
    );
    for (const row of cursor) {
      messages.push({
        id: row.id as string,
        session_id: row.session_id as string,
        role: row.role as "user" | "assistant",
        content: (row.content as string).substring(0, 200) + ((row.content as string).length > 200 ? "..." : ""),
        sources: row.sources ? JSON.parse(row.sources as string) : null,
        metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
        created_at: row.created_at as string,
      });
    }

    const sessionCounts: Record<string, number> = {};
    for (const row of this.sql.exec(`SELECT session_id, COUNT(*) as cnt FROM messages GROUP BY session_id`)) {
      sessionCounts[row.session_id as string] = row.cnt as number;
    }

    const connectedClients = this.state.getWebSockets().length;

    return Response.json({
      tables: tableInfo,
      totalMessages: messages.length,
      sessionCounts,
      connectedClients,
      messages,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export with WebSocket routing
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route WebSocket upgrades to special handler
    if (url.pathname === "/api/ws" && request.headers.get("Upgrade") === "websocket") {
      return handleWebSocket(request, env);
    }

    // All other requests go through Hono
    return app.fetch(request, env);
  },
};
