import type { D1Database, DurableObjectNamespace } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  CHAT_DO: DurableObjectNamespace;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_ANALYST_MODEL?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  PARALLEL_API_KEY?: string;
  ADMIN_TOKEN?: string;
  EVAL_TOKEN?: string;
}

export interface SourcePreview {
  id: string;
  sourceType?: "statement" | "filing" | "announcement" | "macro" | "unstructured";
  ticker: string;
  filingType: string;
  filingPeriod: string;
  filingYear: string;
  sourceDoc?: string | null;
  docType?: string | null;
  pageNumber: number | null;
  pdfUrl: string | null;
  thumbnailUrl: string | null;
  snippet: string;
}
