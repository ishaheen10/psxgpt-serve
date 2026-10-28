import type { SourcePreview } from "../types";
import type { DataQualityCaution, DataQualityFlag } from "../admin/data_quality";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: ChatRole;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  extra_content?: unknown;
}

export interface ModelResponse {
  content: string;
  reasoning: string;
  inputTokens: number;
  outputTokens: number;
}

export interface StreamedResponse {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
}

export type AskTable =
  | "financial_statements"
  | "financial_documents_new"
  | "psx_announcements"
  | "macro_documents"
  | "management_comp"
  | "market_data"
  | "ratios"
  | "model_build"
  | "roic_screen"
  | "dividend_yield_screen"
  | "fcf_yield_screen";

export type EvidenceKind =
  | "structured_rows"
  | "narrative_pages"
  | "numeric_note"
  | "segment_schedule"
  | "report_inventory"
  | "market_snapshot"
  | "statement_export";

export type CoveragePolicy = "strict" | "best_effort";

export interface ResultContract {
  kind: "structured_rows" | "narrative_pages";
  require_non_empty?: boolean;
  require_analytical_value?: boolean;
  entity_coverage?: "all_requested" | "best_effort";
  publishes?: Array<"selected_tickers" | "table" | "pages">;
}

export interface RetrievalBudget {
  max_tool_calls: number;
  max_candidate_rows: number;
  max_full_pages: number;
}

export interface TableAsk {
  id?: string;
  table: AskTable;
  ask: string;
  tickers?: string[];
  industry?: string;
  statement_types?: string[];
  period_cadence?: "annual" | "quarterly";
  period_count?: number;
  period_end?: string;
  ratio_names?: string[];
  posture?: "narrative" | "numeric" | string;
  concepts?: string[];
  required_labels?: string[];
  evidence_kind?: EvidenceKind;
  coverage_policy?: CoveragePolicy;
  result_contract?: ResultContract;
  scope?: "market_wide" | "universe" | string;
  is_selector?: boolean;
  dependency?: string;
  depends_on?: string;
  _out_of_universe?: string[];
  _unresolved_tickers?: string[];
  _missing_scope?: string;
}

export type ComputeIntent =
  | "model_build"
  | "roic_screen"
  | "dividend_yield_screen"
  | "fcf_yield_screen"
  | "company_overview"
  | "report_source"
  | "conversation_arithmetic";

export interface ComputeParams {
  limit?: number;
  horizon_years?: number;
  threshold_pct?: number;
  include_earnings_yield?: boolean;
  filing_cadence?: "annual" | "quarterly";
  period_end?: string;
  operation?: "net_margin_revenue_sensitivity";
  change_rate?: number;
  change_direction?: "increase" | "decrease";
  hold_constant?: "net_profit";
}

export interface SessionScope {
  active_tickers?: string[];
  active_industry?: string;
  active_model_id?: string;
}

export type TableLineageKind = "retrieved" | "calculated";

export interface DataAttachmentLineage {
  kind: TableLineageKind;
  source?: string;
  method?: string;
  functionPath?: string[];
  summary?: string;
  notes?: string[];
}

export interface EvidencePlan {
  plan_version?: 2;
  asks: TableAsk[];
  intent?: ComputeIntent | string;
  compute_params?: ComputeParams;
  session_scope?: SessionScope;
  planning_error?: string;
  ticker?: string;
  template_id?: "bank" | "non_financial" | "holding_co" | string;
  workspace_action?: "load_model" | "update_model_assumptions" | string;
  model_id?: string;
  assumption_updates?: Record<string, number>;
  resolution_context?: {
    company_scope?: Array<{
      ticker: string;
      origin?: "explicit_ticker" | "known_alias" | "conversation" | "router";
    }>;
    unresolved_mentions?: string[];
    topic_mentions?: string[];
  };
}

export interface EntityResolutionContext {
  companyScope: Array<{
    ticker: string;
    origin: "explicit_ticker" | "known_alias" | "conversation" | "router";
    company?: string;
    industry?: string;
  }>;
  unresolvedMentions: string[];
  topicMentions: string[];
}

export type RouterRuntimeMode = "default" | "prompt_pack_only";

export interface RouterRuntimeOptions {
  mode?: RouterRuntimeMode;
  /** Internal eval hook: replay one captured LLM plan through multiple runtime modes. */
  rawPlanOverride?: EvidencePlan;
}

export interface RouterRuntimeIntervention {
  name: string;
  category: "normalization" | "validation_guard" | "routing_override" | "explicit_compute_product" | "operator_helper";
  obstructionRisk: "low" | "medium" | "high";
  changed: boolean;
  before: EvidencePlan;
  after: EvidencePlan;
  notes?: string[];
}

export type FailureBucket =
  | "prompt_pack_fact"
  | "prompt_pack_instruction"
  | "runtime_intervention"
  | "data_corpus"
  | "provider_infrastructure";

export interface RuntimeInterventionTrace {
  stage: "router" | "lane" | "orchestrator" | "analyst" | "answer";
  name: string;
  category:
    | "presentation"
    | "validation_guard"
    | "submit_veto"
    | "semantic_rewrite"
    | "fallback_evidence"
    | "citation_sanitization"
    | "operator_helper";
  obstructionRisk: "low" | "medium" | "high";
  changed: boolean;
  failureBucket: FailureBucket;
  before?: unknown;
  after?: unknown;
  notes?: string[];
}

export interface DataAttachment {
  id: string;
  type: "table";
  title: string;
  headers: string[];
  rows: (string | number | null)[][];
  csv: string;
  summary: string;
  coverage?: Record<string, unknown>;
  selected_tickers?: string[];
  lineage?: DataAttachmentLineage;
  derivedFacts?: Array<{
    metric: string;
    minimum: { entity: string; value: number };
    maximum: { entity: string; value: number };
    availableEntities: string[];
  }>;
}

export interface SavedModelSummary {
  id: string;
  ticker: string;
  template_id: string;
  title: string;
  latest_version: number;
  summary: string;
  session_id?: string;
  updated_at?: string;
}

export interface SavedModelSnapshot {
  id: string;
  ticker: string;
  template_id: string;
  title: string;
  version: number;
  summary: string;
  source_trace_id?: string;
  source_query?: string;
  source_row_count?: number;
  provenanceIds?: number[];
  actuals: Array<{ periodEnd: string; metrics: Record<string, number | null> }>;
  assumptions: Record<string, number>;
  assumption_overrides?: Record<string, number>;
  attachments: DataAttachment[];
  coverage?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface UserWorkspace {
  userId: string;
  sessionId: string;
  listModels(query?: { ticker?: string; limit?: number }): Promise<SavedModelSummary[]>;
  getModel(modelId: string): Promise<SavedModelSnapshot | null>;
  saveModel(model: SavedModelSnapshot): Promise<SavedModelSnapshot>;
  saveModelVersion(modelId: string, snapshot: SavedModelSnapshot, changeNote?: string): Promise<SavedModelSnapshot>;
}

export interface ExecutionArtifact {
  variable: string;
  table: AskTable;
  ask: string;
  askObject?: TableAsk;
  finalQueries: string[];
  resultSummary: string;
  analysisAttachment?: DataAttachment;
  provenanceIds: number[];
  provenanceSources?: SourcePreview[];
  narrativeIds: number[];
  selected_tickers?: string[];
  coverage?: Record<string, unknown>;
  _out_of_universe?: string[];
  _unresolved_tickers?: string[];
  _missing_scope?: string;
  narrativeExtractions?: Array<{
    page_id: number;
    extracted_text: string;
  }>;
}

export interface AnalystSource {
  tag: string;
  preview: SourcePreview;
  text: string;
  contentKind?: "raw_page" | "extraction";
}

export interface AnalystContext {
  query: string;
  executions: ExecutionArtifact[];
  sources: AnalystSource[];
  computedTables: DataAttachment[];
  dataQualityFlags?: DataQualityFlag[];
  resolutionContext?: EntityResolutionContext;
}

export interface UserMemory {
  content: string;
  first_name?: string | null;
  source?: "manual" | "inferred" | string;
}

export interface NarrativeCandidate {
  id: number;
  ticker: string;
  filingType: string;
  filingPeriod: string;
  filingYear: string;
  pageNumber: number;
  searchText: string;
  score: number | null;
}

export interface LaneExecution {
  artifact: ExecutionArtifact;
  structuredRows: Record<string, unknown>[];
  narrativeCandidates: NarrativeCandidate[];
  sqlQueries: string[];
  systemPrompt: string;
  messageHistory: Message[];
  reasoning: string;
  inputTokens: number;
  outputTokens: number;
  runtimeInterventions?: RuntimeInterventionTrace[];
}

export interface RouterTrace {
  model: string;
  runtimeMode?: RouterRuntimeMode;
  systemPrompt: string;
  userMessage: string;
  compressedHistory: string;
  tickerReference: string;
  rawResponse: string;
  rawPlan?: EvidencePlan;
  normalizedPlan?: EvidencePlan;
  finalPlan?: EvidencePlan;
  resolutionContext?: EntityResolutionContext;
  runtimeInterventions?: RouterRuntimeIntervention[];
  reasoning: string;
  asks: TableAsk[];
  inputTokens: number;
  outputTokens: number;
}

export interface LaneTrace {
  model: string;
  laneVariable: string;
  table: AskTable;
  ask: string;
  systemPrompt: string;
  messageHistory: Message[];
  sqlQueries: string[];
  resultSummary: string;
  artifact: ExecutionArtifact;
  candidatePreview: NarrativeCandidate[];
  reasoning: string;
  inputTokens: number;
  outputTokens: number;
  runtimeInterventions?: RuntimeInterventionTrace[];
}

export interface AnalystTrace {
  model: string;
  systemPrompt: string;
  messages: Message[];
  analystUserMessage?: string;
  modulesFired?: string[];
  memoryContext: string;
  analystContext: AnalystContext;
  answer: string;
  sources: SourcePreview[];
  attachments: DataAttachment[];
  reasoning: string;
  citationTrace?: {
    declaredSourceTags: string[];
    declaredTableTags: string[];
    acceptedSourceTags: string[];
    acceptedTableTags: string[];
    fallbackSources: boolean;
    fallbackTables: boolean;
    missingSourceSelection?: boolean;
    missingTableSelection?: boolean;
  };
  answerInterventions?: RuntimeInterventionTrace[];
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export type BoundaryStatus = "passed" | "rejected" | "blocked" | "failed";
export type BoundaryFailureClass =
  | "producer_invalid"
  | "consumer_misuse"
  | "data_sync"
  | "runtime_collision"
  | "provider_transient";

export interface ComponentBoundaryTrace {
  contractId: string;
  producer: "request" | "router" | "lane" | "pipeline_quality" | "compute" | "orchestrator" | "analyst";
  consumer: "router" | "lane" | "compute" | "orchestrator" | "analyst" | "response";
  status: BoundaryStatus;
  failureClass?: BoundaryFailureClass;
  scope?: Record<string, unknown>;
  evidenceIds?: string[];
  detail?: string;
}

export interface EngineTrace {
  router: RouterTrace;
  lanes: LaneTrace[];
  analyst: AnalystTrace;
  boundaries?: ComponentBoundaryTrace[];
}

export interface DeepSeekResult {
  researchReport?: import("../research/types").ResearchReport;
  answer: string;
  isFollowOn: boolean;
  sources: SourcePreview[];
  attachments: DataAttachment[];
  executionArtifacts: ExecutionArtifact[];
  iterations: number;
  scoutReasoning: string;
  analystReasoning: string;
  scoutSql: string;
  sourceFetchLog: string;
  scoutDurationMs: number;
  analystDurationMs: number;
  scoutInputTokens: number;
  scoutOutputTokens: number;
  analystInputTokens: number;
  analystOutputTokens: number;
  contextUsed: number;
  contextRemaining: number;
  contextPercentUsed: number;
  conversationContextUsed: number;
  conversationContextRemaining: number;
  conversationContextPercent: number;
  historyWasCompressed: boolean;
  wasSteered: boolean;
  scoutContext?: {
    query: string;
    chatHistory: Array<{ role: string; content: string }>;
    compressedHistory: string;
    tickersReference: string;
    plan: EvidencePlan;
    steerContext?: string;
  };
  analystContext?: AnalystContext;
  engineTrace?: EngineTrace;
  dataQualityFlags?: DataQualityFlag[];
  dataQualityCautions?: DataQualityCaution[];
}

export type CheckpointStatus = "pending" | "running" | "passed" | "failed";

export interface ThoughtProcessCheckpoint {
  id: string;
  label: string;
  status: CheckpointStatus;
  detail?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export type OnUpdate = (
  status: string,
  thinking?: string,
  content?: string,
  stream?: {
    research?: import("../research/types").ResearchSummary;
    sources?: SourcePreview[];
    structuredThinking?: string;
    unstructuredThinking?: string;
    laneThinking?: Record<string, string>;
    laneStatus?: Record<string, string>;
    checkpoints?: ThoughtProcessCheckpoint[];
  },
) => Promise<void>;

export type RlmEventLogger = (
  phase: "orchestrator" | "router" | "lane" | "analyst",
  eventType: string,
  payload: Record<string, unknown>,
) => Promise<void>;

export function safeJSON<T>(str: string, fallback: T): T {
  const cleaned = str.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

export function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / 4) : 0;
}

export function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
