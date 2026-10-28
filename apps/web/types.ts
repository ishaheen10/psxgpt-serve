import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Utility
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Stream types (previously in @psxgpt/shared)
export type StreamStatus =
  | "queued"
  | "extracting_tickers"
  | "verifying_tickers"
  | "running"
  | "verifying_intent"
  | "searching"
  | "verifying_sources"
  | "streaming"
  | "verifying_answer"
  | "done"
  | "failed"
  | "cancelled";

export type CheckpointStatus = "pending" | "running" | "passed" | "failed";

export interface ThoughtProcessCheckpoint {
  id: string;
  label: string;
  status: CheckpointStatus;
  detail?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface SourcePreview {
  id: number | string;
  sourceType?: "statement" | "filing" | "announcement" | "macro" | "unstructured";
  ticker: string;
  filingType: string;
  filingPeriod: string;
  filingYear?: string;
  sourceDoc?: string | null;
  docType?: string | null;
  sectionType?: string | null;
  pageLabel?: string | null;
  pageNumber?: number | null;
  pdfUrl: string | null;
  thumbnailUrl: string | null;
  snippet: string;
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
  lineage?: {
    kind: "retrieved" | "calculated";
    source?: string;
    method?: string;
    functionPath?: string[];
    summary?: string;
    notes?: string[];
  };
}

// App types
export type AnalysisMetadata = {
  status?: StreamStatus;
  step?: string;
  laneStatus?: Record<string, unknown>;
  checkpoints?: ThoughtProcessCheckpoint[];
} & Record<string, unknown>;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sourceCount?: number;
  sourcePreviews?: SourcePreview[];
  attachments?: DataAttachment[];
  status?: StreamStatus;
  analysisMetadata?: AnalysisMetadata;
  timestamp: Date;
}

export interface ChatHistoryItem {
  id: string;
  query: string;
  createdAt?: string;
  messageCount?: number;
  folderId?: string | null;
  folderName?: string | null;
  matchRole?: "user" | "assistant" | null;
  matchSnippet?: string | null;
}

export interface ChatFolder {
  id: string;
  name: string;
  chatCount?: number;
  createdAt?: string;
  updatedAt?: string;
}
